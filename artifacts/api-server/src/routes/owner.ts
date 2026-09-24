import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  appUsersTable, db, ledgerEntriesTable, partiesTable, workerInvitesTable,
  workerPartyAssignmentsTable,
} from "@workspace/db";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";
import { ensureSmsReady } from "../services/sms";

const router: IRouter = Router();

function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const auth = req as AuthenticatedRequest;
  if (auth.status !== "active" || auth.role !== "owner") {
    res.status(403).json({ error: "Owner access required" });
    return;
  }
  next();
}

router.use("/owner", requireOwner);

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (/^01[3-9]\d{8}$/.test(digits)) return `+88${digits}`;
  if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isPendingInviteUniqueViolation(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  return pgError?.code === "23505" && (
    pgError.constraint === "worker_invites_pending_email_unique" ||
    pgError.constraint === "worker_invites_pending_phone_unique"
  );
}

router.get("/owner/workers", async (req, res): Promise<void> => {
  const { businessId } = req as AuthenticatedRequest;
  const users = await db.select().from(appUsersTable).where(and(
    eq(appUsersTable.businessId, businessId),
    eq(appUsersTable.role, "staff"),
  ));
  const pending = await db.select().from(workerInvitesTable).where(and(
    eq(workerInvitesTable.businessId, businessId),
    eq(workerInvitesTable.status, "pending"),
  ));
  const pendingPartyIds = [...new Set(pending.flatMap((invite) => invite.partyIds))];
  const ownedPendingParties = pendingPartyIds.length
    ? await db.select({ id: partiesTable.id }).from(partiesTable).where(and(
      eq(partiesTable.businessId, businessId),
      inArray(partiesTable.id, pendingPartyIds),
    ))
    : [];
  const ownedPendingPartyIds = new Set(ownedPendingParties.map((party) => party.id));
  const workers = await Promise.all(users.map(async (user) => {
    const assignments = await db.select({ partyId: workerPartyAssignmentsTable.partyId })
      .from(workerPartyAssignmentsTable)
      .innerJoin(partiesTable, eq(workerPartyAssignmentsTable.partyId, partiesTable.id))
      .where(and(
        eq(workerPartyAssignmentsTable.userId, user.id),
        eq(partiesTable.businessId, businessId),
      ));
    return {
      id: user.id,
      identity: user.verifiedEmail ?? user.phone ?? "unknown",
      status: user.status,
      partyIds: assignments.map((item) => item.partyId),
      lastLogin: user.lastLogin?.toISOString() ?? null,
      lastLogout: user.lastLogout?.toISOString() ?? null,
    };
  }));
  res.json({ workers: [
    ...workers,
    ...pending.map((invite) => ({
      id: invite.id,
      identity: invite.email ?? invite.phone,
      status: "pending" as const,
      partyIds: invite.partyIds.filter((partyId) => ownedPendingPartyIds.has(partyId)),
      invitedAt: invite.createdAt.toISOString(),
    })),
  ] });
});

router.get("/owner/activity", async (req, res): Promise<void> => {
  const { businessId } = req as AuthenticatedRequest;
  const entries = await db.select({
    id: ledgerEntriesTable.id,
    partyId: partiesTable.id,
    partyName: partiesTable.name,
    partyRole: partiesTable.role,
    actorId: appUsersTable.id,
    actorIdentity: appUsersTable.verifiedEmail,
    actorPhone: appUsersTable.phone,
    type: ledgerEntriesTable.type,
    amount: ledgerEntriesTable.amount,
    description: ledgerEntriesTable.description,
    createdAt: ledgerEntriesTable.createdAt,
  }).from(ledgerEntriesTable)
    .innerJoin(partiesTable, eq(ledgerEntriesTable.partyId, partiesTable.id))
    .innerJoin(appUsersTable, eq(ledgerEntriesTable.createdByUserId, appUsersTable.id))
    .where(and(
      eq(partiesTable.businessId, businessId),
      eq(appUsersTable.businessId, businessId),
      eq(appUsersTable.role, "staff"),
      eq(ledgerEntriesTable.isTransfer, false),
    ))
    .orderBy(desc(ledgerEntriesTable.createdAt), desc(ledgerEntriesTable.id))
    .limit(50);
  res.json({ entries: entries.map((entry) => ({
    id: entry.id,
    partyId: entry.partyId,
    partyName: entry.partyName,
    partyRole: entry.partyRole,
    actorId: entry.actorId,
    actorIdentity: entry.actorIdentity ?? entry.actorPhone ?? "unknown",
    type: entry.type,
    amount: Number(entry.amount),
    description: entry.description,
    createdAt: entry.createdAt.toISOString(),
  })) });
});

router.post("/owner/workers", async (req, res): Promise<void> => {
  const { businessId } = req as AuthenticatedRequest;
  const body = req.body as Record<string, unknown>;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const phone = typeof body?.phone === "string" ? normalizePhone(body.phone.trim()) : undefined;
  const partyIds = body?.partyIds;
  if ((email ? 1 : 0) + (body?.phone !== undefined ? 1 : 0) !== 1 ||
      (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
      (body?.phone !== undefined && !phone) ||
      !Array.isArray(partyIds) || !partyIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id)) ||
      Object.keys(body ?? {}).some((key) => !["email", "phone", "partyIds"].includes(key))) {
    res.status(400).json({ error: "Provide one valid email or phone and a partyIds string array" });
    return;
  }
  if (phone) {
    try {
      await ensureSmsReady();
    } catch {
      res.status(503).json({ error: "Phone invitations are unavailable because SMS delivery is not ready" });
      return;
    }
  }
  const parties = partyIds.length
    ? await db.select({ id: partiesTable.id }).from(partiesTable).where(and(
      eq(partiesTable.businessId, businessId),
      inArray(partiesTable.id, partyIds),
    ))
    : [];
  if (parties.length !== new Set(partyIds).size ||
      parties.some((party) => !partyIds.includes(party.id))) {
    res.status(400).json({ error: "partyIds must belong to this business" });
    return;
  }
  const [existingWorker] = await db.select({ id: appUsersTable.id }).from(appUsersTable).where(and(
    email ? eq(appUsersTable.verifiedEmail, email) : eq(appUsersTable.phone, phone!),
  )).limit(1);
  if (existingWorker) {
    res.status(409).json({ error: "This identity cannot be invited" });
    return;
  }
  const duplicate = await db.select({ id: workerInvitesTable.id }).from(workerInvitesTable).where(and(
    eq(workerInvitesTable.status, "pending"),
    email ? eq(workerInvitesTable.email, email) : eq(workerInvitesTable.phone, phone!),
  )).limit(1);
  if (duplicate.length) {
    res.status(409).json({ error: "This identity cannot be invited" });
    return;
  }
  let invite;
  try {
    [invite] = await db.insert(workerInvitesTable).values({
      businessId, email: email ?? null, phone: phone ?? null, partyIds,
    }).returning();
  } catch (error) {
    if (isPendingInviteUniqueViolation(error)) {
      res.status(409).json({ error: "This identity cannot be invited" });
      return;
    }
    throw error;
  }
  res.status(201).json({
    id: invite!.id, identity: email ?? phone, status: invite!.status, partyIds: invite!.partyIds,
  });
});

router.patch("/owner/workers/:id", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  const body = req.body as Record<string, unknown>;
  const hasPartyIds = body?.partyIds !== undefined;
  const hasStatus = body?.status !== undefined;
  if (!body || typeof body !== "object" || (!hasPartyIds && !hasStatus) ||
      Object.keys(body).some((key) => key !== "partyIds" && key !== "status") ||
      (hasPartyIds && (!Array.isArray(body.partyIds) || !body.partyIds.every((id) => typeof id === "string"))) ||
      (hasPartyIds && (body.partyIds as string[]).some((id) => !UUID_PATTERN.test(id))) ||
      (hasStatus && body.status !== "active" && body.status !== "suspended")) {
    res.status(400).json({ error: "Expected partyIds and/or status (active|suspended)" });
    return;
  }
  const inviteResult = await db.transaction(async (tx) => {
    const [invite] = await tx.select().from(workerInvitesTable).where(and(
      eq(workerInvitesTable.id, req.params.id),
      eq(workerInvitesTable.businessId, businessId),
    )).for("update").limit(1);
    if (!invite) return { kind: "not-found" as const };
    if (invite.status === "claimed") {
      return { kind: "claimed" as const, workerId: invite.claimedUserId };
    }
    if (invite.status !== "pending") return { kind: "revoked" as const };
    if (body.status === "active") return { kind: "invalid-status" as const };

    const partyIds = body.partyIds as string[] | undefined;
    if (partyIds && new Set(partyIds).size !== partyIds.length) {
      return { kind: "duplicate-parties" as const };
    }
    if (partyIds) {
      const parties = partyIds.length ? await tx.select({ id: partiesTable.id }).from(partiesTable).where(and(
        eq(partiesTable.businessId, businessId),
        inArray(partiesTable.id, partyIds),
      )) : [];
      if (parties.length !== partyIds.length) return { kind: "foreign-party" as const };
    }

    const updateSet: { partyIds?: string[]; status?: "revoked" } = {};
    if (partyIds) updateSet.partyIds = partyIds;
    if (body.status === "suspended") updateSet.status = "revoked";
    const [updated] = await tx.update(workerInvitesTable).set(updateSet).where(and(
      eq(workerInvitesTable.id, invite.id),
      eq(workerInvitesTable.status, "pending"),
    )).returning({ id: workerInvitesTable.id, status: workerInvitesTable.status });
    if (!updated) return { kind: "conflict" as const, workerId: invite.claimedUserId };
    return { kind: "updated" as const, id: updated.id, status: updated.status };
  });
  if (inviteResult.kind === "claimed" || inviteResult.kind === "conflict") {
    res.status(409).json({
      error: "Invitation was already claimed",
      workerId: inviteResult.workerId,
    });
    return;
  }
  if (inviteResult.kind === "revoked") {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  if (inviteResult.kind === "invalid-status") {
    res.status(400).json({ error: "Pending invitations can only be revoked, not activated" });
    return;
  }
  if (inviteResult.kind === "duplicate-parties") {
    res.status(400).json({ error: "partyIds must not contain duplicates" });
    return;
  }
  if (inviteResult.kind === "foreign-party") {
    res.status(400).json({ error: "partyIds must belong to this business" });
    return;
  }
  if (inviteResult.kind === "updated") {
    res.json({ id: inviteResult.id, status: inviteResult.status });
    return;
  }
  const [worker] = await db.select().from(appUsersTable).where(and(
    eq(appUsersTable.id, req.params.id),
    eq(appUsersTable.businessId, businessId),
    eq(appUsersTable.role, "staff"),
  )).limit(1);
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  const partyIds = body.partyIds as string[] | undefined;
  if (partyIds) {
    if (new Set(partyIds).size !== partyIds.length) {
      res.status(400).json({ error: "partyIds must not contain duplicates" });
      return;
    }
    const parties = partyIds.length ? await db.select({ id: partiesTable.id }).from(partiesTable).where(and(
      eq(partiesTable.businessId, businessId), inArray(partiesTable.id, partyIds),
    )) : [];
    if (parties.length !== new Set(partyIds).size || parties.some((party) => !partyIds.includes(party.id))) {
      res.status(400).json({ error: "partyIds must belong to this business" });
      return;
    }
    await db.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, worker.id));
    if (partyIds.length) await db.insert(workerPartyAssignmentsTable).values(partyIds.map((partyId) => ({ userId: worker.id, partyId }))).onConflictDoNothing();
  }
  if (hasStatus) await db.update(appUsersTable).set({ status: body.status as "active" | "suspended" }).where(eq(appUsersTable.id, worker.id));
  res.json({ id: worker.id, status: hasStatus ? body.status : worker.status, partyIds: partyIds ?? undefined });
});

router.get("/owner/parties", async (req, res): Promise<void> => {
  const { businessId } = req as AuthenticatedRequest;
  const parties = await db.select({ id: partiesTable.id, name: partiesTable.name, role: partiesTable.role })
    .from(partiesTable).where(eq(partiesTable.businessId, businessId));
  res.json(parties);
});

export default router;