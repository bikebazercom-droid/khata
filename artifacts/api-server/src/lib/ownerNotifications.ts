import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, appUsersTable, notificationsTable, ownerPushTokensTable, userBusinessesTable } from "@workspace/db";
import type { Notification } from "@workspace/db";
import { broadcast } from "./eventBus";
import { logger } from "./logger";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface StaffLedgerEntryReference {
  entryId: string;
  partyId: string;
  partyName: string;
}

export async function createOwnerEntryNotifications(
  tx: DbTransaction,
  input: {
    businessId: string;
    actorUserId: string;
    entries: StaffLedgerEntryReference[];
  },
): Promise<Notification[]> {
  if (input.entries.length === 0) return [];

  const [actor] = await tx
    .select({ displayName: appUsersTable.displayName })
    .from(appUsersTable)
    .where(and(
      eq(appUsersTable.id, input.actorUserId),
      eq(appUsersTable.role, "staff"),
      eq(appUsersTable.status, "active"),
      isNull(appUsersTable.workerAccessDeletedAt),
    ))
    .limit(1);
  if (!actor) return [];

  const owners = await tx
    .select({ userId: appUsersTable.id })
    .from(userBusinessesTable)
    .innerJoin(appUsersTable, eq(appUsersTable.id, userBusinessesTable.userId))
    .where(and(
      eq(userBusinessesTable.businessId, input.businessId),
      eq(appUsersTable.role, "owner"),
      eq(appUsersTable.status, "active"),
      isNull(appUsersTable.workerAccessDeletedAt),
    ));
  if (owners.length === 0) return [];

  const uniqueParties = new Map<string, string>();
  for (const entry of input.entries) uniqueParties.set(entry.partyId, entry.partyName);
  const singleParty = uniqueParties.size === 1
    ? { partyId: input.entries[0]!.partyId, partyName: input.entries[0]!.partyName }
    : { partyId: null, partyName: null };
  const actorName = actor.displayName?.trim() || "একজন কর্মী";
  const createdAt = new Date();

  return tx
    .insert(notificationsTable)
    .values(owners.map(({ userId }) => ({
      businessId: input.businessId,
      recipientUserId: userId,
      actorUserId: input.actorUserId,
      actorName,
      ...singleParty,
      entryId: input.entries.length === 1 ? input.entries[0]!.entryId : null,
      entryCount: input.entries.length,
      createdAt,
    })))
    .returning();
}

/**
 * Owner alerts are secondary to the ledger write. Persist them in a separate
 * transaction so an unavailable notification table cannot roll back a saved
 * entry or balance update.
 */
export async function createOwnerEntryNotificationsBestEffort(
  input: {
    businessId: string;
    actorUserId: string;
    entries: StaffLedgerEntryReference[];
  },
  createNotifications: typeof createOwnerEntryNotifications = createOwnerEntryNotifications,
): Promise<Notification[]> {
  if (input.entries.length === 0) return [];
  try {
    return await db.transaction((tx) => createNotifications(tx, input));
  } catch (error) {
    logger.warn(
      { businessId: input.businessId, error },
      "Staff ledger entry was saved, but owner notification persistence failed",
    );
    return [];
  }
}

export function publishOwnerEntryNotifications(notifications: Notification[]): void {
  if (notifications.length === 0) return;

  for (const notification of notifications) {
    broadcast(notification.businessId, {
      type: "notification.created",
      payload: {
        recipientUserId: notification.recipientUserId,
        notificationId: notification.id,
      },
    });
  }

  void deliverExpoPushNotifications(notifications).catch((error: unknown) => {
    logger.error({ error }, "Owner push notifications could not be delivered");
  });
}

async function deliverExpoPushNotifications(notifications: Notification[]): Promise<void> {
  const recipientIds = [...new Set(notifications.map((item) => item.recipientUserId))];
  if (recipientIds.length === 0) return;

  const tokens = await db
    .select()
    .from(ownerPushTokensTable)
    .innerJoin(appUsersTable, eq(appUsersTable.id, ownerPushTokensTable.userId))
    .where(and(
      inArray(ownerPushTokensTable.userId, recipientIds),
      eq(appUsersTable.status, "active"),
      isNull(appUsersTable.workerAccessDeletedAt),
    ));
  if (tokens.length === 0) return;

  const messages = tokens.flatMap(({ owner_push_tokens: token }) =>
    notifications
      .filter((notification) => notification.recipientUserId === token.userId)
      .map((notification) => ({
        to: token.token,
        sound: "default",
        title: "বাংলাখাতা",
        body: notification.entryCount > 1
          ? `${notification.actorName} ${notification.entryCount}টি নতুন হিসাব যোগ করেছেন`
          : `${notification.actorName} ${notification.partyName ? `${notification.partyName} পাটিতে ` : ""}নতুন হিসাব যোগ করেছেন`,
        data: {
          type: "staff-ledger-entry",
          notificationId: notification.id,
          businessId: notification.businessId,
          partyId: notification.partyId,
          entryId: notification.entryId,
        },
        channelId: "ledger-alerts",
      })),
  );

  for (let offset = 0; offset < messages.length; offset += 100) {
    const batch = messages.slice(offset, offset + 100);
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(8_000),
    });
    const responseText = await response.text();
    if (!response.ok) {
      logger.warn({ status: response.status }, "Expo push service returned an error");
      continue;
    }

    let tickets: Array<{ status?: string; details?: { error?: string } }> = [];
    try {
      const body = JSON.parse(responseText) as { data?: typeof tickets };
      tickets = body.data ?? [];
    } catch {
      logger.warn("Expo push service returned an unreadable response");
      continue;
    }

    const invalidTokens = batch.flatMap((message, index) =>
      tickets[index]?.details?.error === "DeviceNotRegistered" ? [message.to] : [],
    );
    if (invalidTokens.length > 0) {
      await db.delete(ownerPushTokensTable).where(inArray(ownerPushTokensTable.token, invalidTokens));
    }
    const failedTickets = tickets.filter((ticket) => ticket.status === "error").length;
    if (failedTickets > 0) {
      logger.warn({ failedTickets }, "Some Expo push notifications were rejected");
    }
  }
}
