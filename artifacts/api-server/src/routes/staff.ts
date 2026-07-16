/**
 * Staff Duty Deployment & Rotation — isolated API module.
 *
 * No imports from parties / ledger / dashboard — zero coupling to the
 * customer-accounting domain.
 */

import { Router, type IRouter } from "express";
import { asc, desc, eq, and, gte, lte, max } from "drizzle-orm";
import {
  db,
  staffPersonnelTable,
  staffDeploymentLogsTable,
} from "@workspace/db";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ─── validation helpers ───────────────────────────────────────────────────────

const VALID_DESTINATIONS = new Set(["ঢাকা", "চিটাগং", "বরিশাল", "খুলনা", "সিলেট", "রাজশাহী"]);
const MONTH_RE = /^\d{4}-\d{2}$/;

// ─── GET /staff/personnel ─────────────────────────────────────────────────────

router.get("/staff/personnel", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;

  const rows = await db
    .select()
    .from(staffPersonnelTable)
    .where(eq(staffPersonnelTable.businessId, businessId))
    .orderBy(asc(staffPersonnelTable.queueOrder), asc(staffPersonnelTable.createdAt));

  res.json(rows);
});

// ─── POST /staff/personnel ────────────────────────────────────────────────────

router.post("/staff/personnel", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 120) {
    res.status(400).json({ error: "name must be 1-120 characters" });
    return;
  }

  // Append to the absolute back of the queue
  const [{ maxOrder }] = await db
    .select({ maxOrder: max(staffPersonnelTable.queueOrder) })
    .from(staffPersonnelTable)
    .where(eq(staffPersonnelTable.businessId, businessId));

  const nextOrder = (maxOrder ?? -1) + 1;

  const [row] = await db
    .insert(staffPersonnelTable)
    .values({ businessId, name, queueOrder: nextOrder })
    .returning();

  res.status(201).json(row);
});

// ─── DELETE /staff/personnel/:id ─────────────────────────────────────────────

router.delete("/staff/personnel/:id", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;

  await db
    .delete(staffPersonnelTable)
    .where(
      and(
        eq(staffPersonnelTable.id, req.params.id),
        eq(staffPersonnelTable.businessId, businessId),
      ),
    );

  res.json({ ok: true });
});

// ─── POST /staff/personnel/:id/deploy ────────────────────────────────────────

router.post("/staff/personnel/:id/deploy", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  const destination = typeof req.body?.destination === "string" ? req.body.destination.trim() : "";
  if (!destination || destination.length > 200) {
    res.status(400).json({ error: "destination must be 1-200 characters" });
    return;
  }

  // 1. Fetch the staff member (must belong to this business)
  const [staffMember] = await db
    .select()
    .from(staffPersonnelTable)
    .where(
      and(
        eq(staffPersonnelTable.id, req.params.id),
        eq(staffPersonnelTable.businessId, businessId),
      ),
    )
    .limit(1);

  if (!staffMember) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }

  // 2. Get current max queueOrder for rotation
  const [{ maxOrder }] = await db
    .select({ maxOrder: max(staffPersonnelTable.queueOrder) })
    .from(staffPersonnelTable)
    .where(eq(staffPersonnelTable.businessId, businessId));

  // 3. Write immutable deployment log
  await db.insert(staffDeploymentLogsTable).values({
    businessId,
    staffId: staffMember.id,
    staffName: staffMember.name,
    destination,
  });

  // 4. Move staff member to the back of the queue
  await db
    .update(staffPersonnelTable)
    .set({ queueOrder: (maxOrder ?? 0) + 1 })
    .where(eq(staffPersonnelTable.id, staffMember.id));

  res.json({ ok: true });
});

// ─── PATCH /staff/logs/:id ────────────────────────────────────────────────────
// Allows correcting the destination of any existing log entry.

router.patch("/staff/logs/:id", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  const destination = typeof req.body?.destination === "string" ? req.body.destination.trim() : "";
  if (!destination || destination.length > 200) {
    res.status(400).json({ error: "destination must be 1-200 characters" });
    return;
  }

  const [updated] = await db
    .update(staffDeploymentLogsTable)
    .set({ destination })
    .where(
      and(
        eq(staffDeploymentLogsTable.id, req.params.id),
        eq(staffDeploymentLogsTable.businessId, businessId),
      ),
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Log entry not found" });
    return;
  }

  res.json(updated);
});

// ─── GET /staff/logs ─────────────────────────────────────────────────────────

router.get("/staff/logs", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  const monthParam = req.query.month;
  const month = typeof monthParam === "string" && MONTH_RE.test(monthParam) ? monthParam : null;

  let conditions = eq(staffDeploymentLogsTable.businessId, businessId);

  if (month) {
    const [year, mon] = month.split("-").map(Number);
    const startDate = new Date(year, mon - 1, 1);
    const endDate   = new Date(year, mon, 0, 23, 59, 59, 999);
    conditions = and(
      conditions,
      gte(staffDeploymentLogsTable.deployedAt, startDate),
      lte(staffDeploymentLogsTable.deployedAt, endDate),
    ) as typeof conditions;
  }

  const rows = await db
    .select()
    .from(staffDeploymentLogsTable)
    .where(conditions)
    .orderBy(desc(staffDeploymentLogsTable.deployedAt));

  res.json(rows);
});

export default router;
