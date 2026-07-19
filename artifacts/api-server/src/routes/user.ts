/**
 * User-scoped routes.
 *
 * DELETE /user/account  — Total account nuke.
 * Atomically erases every database record that belongs to the authenticated
 * user: ledger entries → parties → business settings → staff tables →
 * user_businesses → businesses → app_users row.
 *
 * After this call succeeds the user can sign back in via Clerk / phone OTP
 * and receive a brand-new, freshly-provisioned empty account.
 */
import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  appUsersTable,
  businessesTable,
  businessSettingsTable,
  partiesTable,
  ledgerEntriesTable,
  userBusinessesTable,
  staffPersonnelTable,
  staffDeploymentLogsTable,
  staffDestinationsTable,
} from "@workspace/db";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ─── DELETE /user/account ────────────────────────────────────────────────────

router.delete(
  "/user/account",
  async (req, res): Promise<void> => {
    const { userId } = req as unknown as AuthenticatedRequest;

    try {
      await db.transaction(async (tx) => {
        // 1. Collect all business IDs owned by this user.
        const userBizRows = await tx
          .select({ businessId: userBusinessesTable.businessId })
          .from(userBusinessesTable)
          .where(eq(userBusinessesTable.userId, userId));

        const bizIds = userBizRows.map((r) => r.businessId);

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

          // 7. Wipe the join table, then the business rows.
          await tx
            .delete(userBusinessesTable)
            .where(inArray(userBusinessesTable.businessId, bizIds));

          await tx
            .delete(businessesTable)
            .where(inArray(businessesTable.id, bizIds));
        }

        // 8. Finally, delete the user identity row itself.
        await tx
          .delete(appUsersTable)
          .where(eq(appUsersTable.id, userId));
      });

      res.status(200).json({ success: true });
    } catch (error) {
      console.error("[account-nuke] transaction failed:", error);
      res.status(500).json({ error: "Failed to delete account. Please try again." });
    }
  },
);

export default router;
