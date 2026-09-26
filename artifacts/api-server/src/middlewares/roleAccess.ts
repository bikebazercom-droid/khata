import { and, eq } from "drizzle-orm";
import { db, workerPartyAssignmentsTable } from "@workspace/db";
import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./requireAuth";

const STAFF_ALLOWED = [
  /^GET \/parties$/,
  /^GET \/parties\/[^/]+$/,
  /^GET \/parties\/[^/]+\/ledger-entries$/,
  /^POST \/parties\/[^/]+\/ledger-entries$/,
];

export async function enforceRoleAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req as AuthenticatedRequest;
  if (auth.status !== "active" || (auth.role !== "owner" && auth.role !== "staff")) {
    res.status(403).json({ error: "A valid active business role is required" });
    return;
  }
  if (auth.role === "owner") {
    next();
    return;
  }
  const path = req.path;
  const methodAndPath = `${req.method} ${path}`;
  if (!STAFF_ALLOWED.some((pattern) => pattern.test(methodAndPath))) {
    res.status(403).json({ error: "Staff access is limited to assigned party ledgers" });
    return;
  }

  if (req.method === "POST") {
    const body = req.body;
    const allowed = new Set(["type", "amount", "description", "billReference", "dueDate", "isTransfer", "transferPartyId"]);
    const validTransfer = body?.isTransfer === true && typeof body.transferPartyId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.transferPartyId);
    const normal = (body?.isTransfer === undefined || body.isTransfer === false) && body?.transferPartyId == null;
    if (!body || typeof body !== "object" ||
        Object.keys(body).some((key) => !allowed.has(key)) ||
        "billImage" in body || (!validTransfer && !normal)) {
      res.status(403).json({ error: "Staff may create normal entries or authorized adjustments, without bill images" });
      return;
    }
  }

  const partyMatch = path.match(/^\/parties\/([^/]+)(?:\/|$)/);
  if (partyMatch) {
    const [assignment] = await db.select({ userId: workerPartyAssignmentsTable.userId })
      .from(workerPartyAssignmentsTable)
      .where(and(
        eq(workerPartyAssignmentsTable.userId, auth.userId),
        eq(workerPartyAssignmentsTable.partyId, partyMatch[1]!),
      )).limit(1);
    if (!assignment) {
      res.status(404).json({ error: "Party not found" });
      return;
    }
  }
  next();
}