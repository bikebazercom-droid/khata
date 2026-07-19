import { Router } from "express";
import { eq, and, count, inArray } from "drizzle-orm";
import {
  db,
  businessesTable,
  businessSettingsTable,
  partiesTable,
  ledgerEntriesTable,
  userBusinessesTable,
  staffPersonnelTable,
  staffDeploymentLogsTable,
  staffDestinationsTable,
} from "@workspace/db";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";

const router = Router();

/**
 * GET /api/businesses
 * Returns all businesses the current user has access to, with party counts.
 */
router.get("/businesses", async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  try {
    // Join user_businesses → businesses, count parties per business
    const memberships = await db
      .select({ businessId: userBusinessesTable.businessId })
      .from(userBusinessesTable)
      .where(eq(userBusinessesTable.userId, userId));

    const businessIds = memberships.map((m) => m.businessId);
    if (!businessIds.length) {
      res.json([]);
      return;
    }

    const results = await Promise.all(
      businessIds.map(async (bizId) => {
        const [biz] = await db
          .select()
          .from(businessesTable)
          .where(eq(businessesTable.id, bizId));
        if (!biz) return null;

        const [row] = await db
          .select({ total: count() })
          .from(partiesTable)
          .where(eq(partiesTable.businessId, bizId));

        return {
          id: biz.id,
          name: biz.name,
          createdAt: biz.createdAt,
          partyCount: Number(row?.total ?? 0),
        };
      }),
    );

    res.json(results.filter(Boolean));
  } catch (err) {
    console.error("GET /api/businesses error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/businesses
 * Creates a new business and links it to the current user.
 */
router.post("/businesses", async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const { name } = req.body as { name?: string };

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const [biz] = await db
      .insert(businessesTable)
      .values({ name: name.trim() })
      .returning();

    // Ensure default settings row exists
    await db
      .insert(businessSettingsTable)
      .values({ businessId: biz!.id })
      .onConflictDoNothing();

    // Link to user
    await db
      .insert(userBusinessesTable)
      .values({ userId, businessId: biz!.id })
      .onConflictDoNothing();

    res.status(201).json({
      id: biz!.id,
      name: biz!.name,
      createdAt: biz!.createdAt,
      partyCount: 0,
    });
  } catch (err) {
    console.error("POST /api/businesses error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/businesses/:id
 * Completely wipes a business the user owns — all ledger entries, parties,
 * settings, and the business record itself are deleted in one transaction.
 */
router.delete("/businesses/:id", async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const { id: businessId } = req.params;

  try {
    // 1. Verify ownership
    const [ownership] = await db
      .select()
      .from(userBusinessesTable)
      .where(
        and(
          eq(userBusinessesTable.userId, userId),
          eq(userBusinessesTable.businessId, businessId),
        ),
      )
      .limit(1);

    if (!ownership) {
      res.status(403).json({ error: "You do not own this business khata" });
      return;
    }

    // 2. Cascade delete inside a transaction
    await db.transaction(async (tx) => {
      // Ledger entries only have a partyId FK, so resolve party IDs first
      const partyRows = await tx
        .select({ id: partiesTable.id })
        .from(partiesTable)
        .where(eq(partiesTable.businessId, businessId));

      if (partyRows.length > 0) {
        const partyIds = partyRows.map((p) => p.id);
        await tx
          .delete(ledgerEntriesTable)
          .where(inArray(ledgerEntriesTable.partyId, partyIds));
      }

      await tx
        .delete(partiesTable)
        .where(eq(partiesTable.businessId, businessId));

      await tx
        .delete(businessSettingsTable)
        .where(eq(businessSettingsTable.businessId, businessId));

      // Staff tables also hold business_id FKs — must be cleared before
      // deleting the business row or Postgres throws a constraint violation.
      await tx
        .delete(staffDeploymentLogsTable)
        .where(eq(staffDeploymentLogsTable.businessId, businessId));

      await tx
        .delete(staffPersonnelTable)
        .where(eq(staffPersonnelTable.businessId, businessId));

      await tx
        .delete(staffDestinationsTable)
        .where(eq(staffDestinationsTable.businessId, businessId));

      await tx
        .delete(userBusinessesTable)
        .where(eq(userBusinessesTable.businessId, businessId));

      await tx
        .delete(businessesTable)
        .where(eq(businessesTable.id, businessId));
    });

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/businesses/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
