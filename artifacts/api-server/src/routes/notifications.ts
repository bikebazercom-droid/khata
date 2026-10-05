import { and, desc, eq, isNull } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, notificationsTable, ownerPushTokensTable } from "@workspace/db";
import {
  ListNotificationsResponse,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
  RegisterOwnerPushTokenBody,
  RemoveOwnerPushTokenBody,
} from "@workspace/api-zod";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";
import { broadcast } from "../lib/eventBus";

const router: IRouter = Router();

function requireOwner(req: Request, res: Response): AuthenticatedRequest | null {
  const auth = req as unknown as AuthenticatedRequest;
  if (auth.role !== "owner") {
    res.status(403).json({ error: "Owner access required" });
    return null;
  }
  return auth;
}

router.get("/notifications", async (req, res): Promise<void> => {
  const auth = requireOwner(req, res);
  if (!auth) return;

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.businessId, auth.businessId),
      eq(notificationsTable.recipientUserId, auth.userId),
    ))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(40);

  res.json(ListNotificationsResponse.parse(notifications));
});

router.post("/notifications/:notificationId/read", async (req, res): Promise<void> => {
  const auth = requireOwner(req, res);
  if (!auth) return;

  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [notification] = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(and(
      eq(notificationsTable.id, params.data.notificationId),
      eq(notificationsTable.businessId, auth.businessId),
      eq(notificationsTable.recipientUserId, auth.userId),
    ))
    .returning();
  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  broadcast(auth.businessId, {
    type: "notification.updated",
    payload: { recipientUserId: auth.userId },
  });
  res.json(MarkNotificationReadResponse.parse(notification));
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const auth = requireOwner(req, res);
  if (!auth) return;

  const updated = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(and(
      eq(notificationsTable.businessId, auth.businessId),
      eq(notificationsTable.recipientUserId, auth.userId),
      isNull(notificationsTable.readAt),
    ))
    .returning({ id: notificationsTable.id });
  if (updated.length > 0) {
    broadcast(auth.businessId, {
      type: "notification.updated",
      payload: { recipientUserId: auth.userId },
    });
  }
  res.json(MarkAllNotificationsReadResponse.parse({ updatedCount: updated.length }));
});

router.post("/notifications/push-token", async (req, res): Promise<void> => {
  const auth = requireOwner(req, res);
  if (!auth) return;

  const parsed = RegisterOwnerPushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!/^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(parsed.data.token)) {
    res.status(400).json({ error: "Invalid Expo push token" });
    return;
  }

  await db
    .insert(ownerPushTokensTable)
    .values({
      userId: auth.userId,
      token: parsed.data.token,
      platform: parsed.data.platform,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: ownerPushTokensTable.token,
      set: {
        userId: auth.userId,
        platform: parsed.data.platform,
        updatedAt: new Date(),
      },
    });
  res.status(204).end();
});

router.delete("/notifications/push-token", async (req, res): Promise<void> => {
  const auth = requireOwner(req, res);
  if (!auth) return;

  const parsed = RemoveOwnerPushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.delete(ownerPushTokensTable).where(and(
    eq(ownerPushTokensTable.userId, auth.userId),
    eq(ownerPushTokensTable.token, parsed.data.token),
  ));
  res.status(204).end();
});

export default router;
