/**
 * User-scoped routes.
 *
 * DELETE /user/account  — Total account nuke.
 * Atomically erases every database record that belongs to the authenticated
 * user: ledger entries → parties → business settings → staff tables →
 * user_businesses → businesses. A keyed identity tombstone remains to reject
 * stale credentials and permit a verified, empty re-registration.
 *
 * After this call succeeds the user can sign back in via Clerk / phone OTP
 * and receive a freshly-provisioned empty account.
 */
import { Router, type IRouter } from "express";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  appUsersTable,
  appUserLoginSessionsTable,
  businessesTable,
  businessSettingsTable,
  partiesTable,
  ledgerEntriesTable,
  userBusinessesTable,
  userLoginEventsTable,
  userPresenceTable,
  ownerPushTokensTable,
  notificationsTable,
  workerInvitesTable,
  workerPartyAssignmentsTable,
  staffPersonnelTable,
  staffDeploymentLogsTable,
  staffDestinationsTable,
} from "@workspace/db";
import { SEED_BUSINESS_ID, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { hashDeletedAccountIdentity } from "../lib/deletedAccountIdentity";
import { z } from "zod";

const router: IRouter = Router();

// ─── GET/PATCH /user/preferences ──────────────────────────────────────────────

router.get("/user/preferences", async (req, res): Promise<void> => {
  const { userId } = req as unknown as AuthenticatedRequest;
  try {
    const [user] = await db
      .select({ language: appUsersTable.language })
      .from(appUsersTable)
      .where(eq(appUsersTable.id, userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ language: user.language });
  } catch (error) {
    console.error("[user/preferences] read failed; client may use its local preference:", error);
    res.status(503).json({
      error: "Language preference is temporarily unavailable.",
      code: "LANGUAGE_PREFERENCE_UNAVAILABLE",
    });
  }
});

router.patch("/user/preferences", async (req, res): Promise<void> => {
  const { userId } = req as unknown as AuthenticatedRequest;
  const parsed = z.object({ language: z.enum(["bn", "en"]) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "language must be bn or en." });
    return;
  }
  try {
    const [user] = await db
      .update(appUsersTable)
      .set({ language: parsed.data.language })
      .where(eq(appUsersTable.id, userId))
      .returning({ language: appUsersTable.language });
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ language: user.language });
  } catch (error) {
    console.error("[user/preferences] write failed; device preference remains available:", error);
    res.status(503).json({
      error: "Language preference could not be synchronized.",
      code: "LANGUAGE_PREFERENCE_UNAVAILABLE",
    });
  }
});

// ─── DELETE /user/account ────────────────────────────────────────────────────

router.delete(
  "/user/account",
  async (req, res): Promise<void> => {
    const { userId } = req as unknown as AuthenticatedRequest;

    try {
      const [authenticatedUser] = await db
        .select({ role: appUsersTable.role })
        .from(appUsersTable)
        .where(eq(appUsersTable.id, userId))
        .limit(1);
      if (authenticatedUser?.role !== "owner") {
        res.status(403).json({ error: "Only a business owner can delete the account." });
        return;
      }

      const parsed = z.object({ confirmation: z.string().trim().min(1).max(320) }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Account deletion confirmation is required." });
        return;
      }

      const [account] = await db
        .select({
          verifiedEmail: appUsersTable.verifiedEmail,
          phone: appUsersTable.phone,
          clerkUserId: appUsersTable.clerkUserId,
          businessId: appUsersTable.businessId,
        })
        .from(appUsersTable)
        .where(eq(appUsersTable.id, userId))
        .limit(1);
      if (!account) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      const currentIdentity = account.verifiedEmail ?? account.phone;
      const typedConfirmation = parsed.data.confirmation;
      const matchesIdentity = !!currentIdentity
        && typedConfirmation.toLowerCase() === currentIdentity.trim().toLowerCase();
      if (typedConfirmation !== "DELETE" && !matchesIdentity) {
        res.status(400).json({ error: "The confirmation text does not match your account." });
        return;
      }

      const deletedEmail = account.verifiedEmail
        ? hashDeletedAccountIdentity("email", account.verifiedEmail)
        : null;
      const deletedPhone = account.phone
        ? hashDeletedAccountIdentity("phone", account.phone)
        : null;
      const deletedClerkUserId = account.clerkUserId
        ? hashDeletedAccountIdentity("clerk", account.clerkUserId)
        : null;

      // Remove the Clerk identity before erasing app data so a provider failure
      // leaves the account and its records intact for a safe retry.
      if (account.clerkUserId) {
        const clerkSecret = process.env.CLERK_SECRET_KEY;
        if (!clerkSecret) {
          res.status(503).json({ error: "Account deletion is temporarily unavailable." });
          return;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        let clerkResponse: Response;
        try {
          clerkResponse = await fetch(
            `https://api.clerk.com/v1/users/${encodeURIComponent(account.clerkUserId)}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${clerkSecret}` },
              signal: controller.signal,
            },
          );
        } catch (error) {
          console.error("[account-delete] Clerk identity deletion failed:", error);
          res.status(502).json({ error: "Could not delete the sign-in account. Please try again." });
          return;
        } finally {
          clearTimeout(timeout);
        }
        if (!clerkResponse.ok && clerkResponse.status !== 404) {
          console.error(`[account-delete] Clerk identity deletion returned ${clerkResponse.status}.`);
          res.status(502).json({ error: "Could not delete the sign-in account. Please try again." });
          return;
        }
      }

      await db.transaction(async (tx) => {
        // 1. Collect all business IDs owned by this user.
        const userBizRows = await tx
          .select({ businessId: userBusinessesTable.businessId })
          .from(userBusinessesTable)
          .where(eq(userBusinessesTable.userId, userId));

        const bizIds = [...new Set([
          ...userBizRows.map((r) => r.businessId),
          account.businessId,
        ])];

        if (bizIds.length > 0) {
          // 2. Collect all party IDs across those businesses.
          const partyRows = await tx
            .select({ id: partiesTable.id })
            .from(partiesTable)
            .where(inArray(partiesTable.businessId, bizIds));

          const partyIds = partyRows.map((r) => r.id);

          // 3. Wipe ledger entries first (references parties).
          if (partyIds.length > 0) {
            await tx
              .delete(ledgerEntriesTable)
              .where(inArray(ledgerEntriesTable.partyId, partyIds));
          }

          // 4. Wipe parties.
          await tx
            .delete(partiesTable)
            .where(inArray(partiesTable.businessId, bizIds));

          // 5. Wipe business settings.
          await tx
            .delete(businessSettingsTable)
            .where(inArray(businessSettingsTable.businessId, bizIds));

          // 6. Wipe staff tables (deployment logs reference personnel, so logs first).
          await tx
            .delete(staffDeploymentLogsTable)
            .where(inArray(staffDeploymentLogsTable.businessId, bizIds));

          await tx
            .delete(staffPersonnelTable)
            .where(inArray(staffPersonnelTable.businessId, bizIds));

          await tx
            .delete(staffDestinationsTable)
            .where(inArray(staffDestinationsTable.businessId, bizIds));

          // Preserve the reserved row for the next owner, and move the minimal
          // identity tombstone before deleting the account's old business.
          await tx.insert(businessesTable)
            .values({ id: SEED_BUSINESS_ID, name: "আমার খাতা" })
            .onConflictDoNothing({ target: businessesTable.id });

          await tx
            .delete(userBusinessesTable)
            .where(inArray(userBusinessesTable.businessId, bizIds));

          await tx.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, userId));
          await tx.delete(appUserLoginSessionsTable).where(eq(appUserLoginSessionsTable.userId, userId));
          await tx.delete(userLoginEventsTable).where(eq(userLoginEventsTable.userId, userId));
          await tx.delete(userPresenceTable).where(eq(userPresenceTable.userId, userId));
          await tx.delete(ownerPushTokensTable).where(eq(ownerPushTokensTable.userId, userId));
          await tx.delete(notificationsTable).where(eq(notificationsTable.recipientUserId, userId));
          await tx.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, userId));
          await tx.update(workerInvitesTable).set({ claimedUserId: null })
            .where(eq(workerInvitesTable.claimedUserId, userId));

          // phone is unique in app_users. Retire an older re-entry marker for
          // this same verified number before storing the new marker.
          if (deletedPhone) {
            await tx.delete(appUsersTable).where(and(
              eq(appUsersTable.phone, deletedPhone),
              ne(appUsersTable.id, userId),
              eq(appUsersTable.role, "owner"),
            ));
          }

          await tx.update(appUsersTable).set({
            businessId: SEED_BUSINESS_ID,
            phone: deletedPhone,
            clerkUserId: deletedClerkUserId,
            verifiedEmail: deletedEmail,
            displayName: null,
            language: null,
            adjustmentPartyIds: [],
            status: "suspended",
            workerAccessDeletedAt: new Date(),
            lastLogin: null,
            lastLogout: null,
            deviceMeta: null,
          }).where(eq(appUsersTable.id, userId));

          await tx
            .delete(appUsersTable)
            .where(and(
              inArray(appUsersTable.businessId, bizIds),
              ne(appUsersTable.id, userId),
            ));

          // Keep the reserved seed business row. The next account created after
          // its owner deletes their account reuses this empty row for onboarding.
          const businessIdsToDelete = bizIds.filter((id) => id !== SEED_BUSINESS_ID);
          if (businessIdsToDelete.length) {
            await tx.delete(businessesTable)
              .where(inArray(businessesTable.id, businessIdsToDelete));
          }
          if (bizIds.includes(SEED_BUSINESS_ID)) {
            await tx.update(businessesTable).set({ name: "আমার খাতা" })
              .where(eq(businessesTable.id, SEED_BUSINESS_ID));
          }
        }

      });

      res.status(200).json({ success: true });
    } catch (error) {
      console.error("[account-nuke] transaction failed:", error);
      res.status(500).json({ error: "Failed to delete account. Please try again." });
    }
  },
);

export default router;
