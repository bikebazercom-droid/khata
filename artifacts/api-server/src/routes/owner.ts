import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  appUsersTable, appUserLoginSessionsTable, businessesTable, db, ledgerEntriesTable, partiesTable, workerInvitesTable,
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

router.get("/owner/workers", async (req, res): Promise<void> => {
  const { businessId } = req as AuthenticatedRequest;
  const users = await db.select().from(appUsersTable).where(and(
    eq(appUsersTable.businessId, businessId),
    eq(appUsersTable.role, "staff"),
    isNull(appUsersTable.workerAccessDeletedAt),
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
      adjustmentPartyIds: user.adjustmentPartyIds.filter((id) => assignments.some((item) => item.partyId === id)),
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
      adjustmentPartyIds: invite.adjustmentPartyIds.filter((id) => invite.partyIds.includes(id) && ownedPendingPartyIds.has(id)),
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
  const adjustmentPartyIds = body?.adjustmentPartyIds ?? [];
  if ((email ? 1 : 0) + (body?.phone !== undefined ? 1 : 0) !== 1 ||
      (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
      (body?.phone !== undefined && !phone) ||
      !validIds(partyIds) ||
      !validIds(adjustmentPartyIds) ||
      !adjustmentPartyIds.every((id) => Array.isArray(partyIds) && partyIds.includes(id)) ||
      Object.keys(body ?? {}).some((key) => !["email", "phone", "partyIds", "adjustmentPartyIds"].includes(key))) {
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
  const result = await db.transaction(async (tx) => {
  await tx.select({ id: businessesTable.id }).from(businessesTable).where(eq(businessesTable.id, businessId)).for("update");
  const [existingWorker] = await tx.select().from(appUsersTable).where(and(
    email ? eq(appUsersTable.verifiedEmail, email) : eq(appUsersTable.phone, phone!),
  )).limit(1);
  if (existingWorker && !(existingWorker.role === "staff" && existingWorker.workerAccessDeletedAt &&
      existingWorker.businessId === businessId)) {
    return { status: 409, body: { error: "This identity cannot be invited" } };
  }
  const duplicate = await tx.select({ id: workerInvitesTable.id }).from(workerInvitesTable).where(and(
    eq(workerInvitesTable.status, "pending"),
    email ? eq(workerInvitesTable.email, email) : eq(workerInvitesTable.phone, phone!),
  )).limit(1);
  if (duplicate.length) {
    return { status: 409, body: { error: "This identity cannot be invited" } };
  }
  const [invite] = await tx.insert(workerInvitesTable).values({
      businessId, email: email ?? null, phone: phone ?? null, partyIds, adjustmentPartyIds,
    }).onConflictDoNothing().returning();
  if (!invite) return { status: 409, body: { error: "This identity cannot be invited" } };
  return { status: 201, body: {
    id: invite!.id, identity: email ?? phone, status: invite!.status, partyIds: invite!.partyIds,
    adjustmentPartyIds: invite!.adjustmentPartyIds,
  } };
  });
  res.status(result.status).json(result.body);
});

function validIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && UUID_PATTERN.test(id)) &&
    new Set(value).size === value.length;
}

router.patch("/owner/workers/:id", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  const body = req.body as Record<string, unknown>;
  const hasPartyIds = body?.partyIds !== undefined;
  const hasStatus = body?.status !== undefined;
  const hasAdjustmentIds = body?.adjustmentPartyIds !== undefined;
  if (!UUID_PATTERN.test(req.params.id)) { res.status(400).json({ error: "Invalid worker id" }); return; }
  if (!body || typeof body !== "object" || (!hasPartyIds && !hasStatus && !hasAdjustmentIds) ||
      Object.keys(body).some((key) => !["partyIds", "status", "adjustmentPartyIds"].includes(key)) ||
      (hasAdjustmentIds && !validIds(body.adjustmentPartyIds)) ||
      (hasPartyIds && (!Array.isArray(body.partyIds) || !body.partyIds.every((id) => typeof id === "string"))) ||
      (hasPartyIds && (body.partyIds as string[]).some((id) => !UUID_PATTERN.test(id))) ||
      (hasStatus && body.status !== "active" && body.status !== "suspended")) {
    res.status(400).json({ error: "Expected partyIds and/or status (active|suspended)" });
    return;
  }
  const result = await db.transaction(async (tx) => {
  await tx.select({ id: businessesTable.id }).from(businessesTable).where(eq(businessesTable.id, businessId)).for("update");
  const inviteResult = await (async () => {
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

    const effectiveIds = partyIds ?? invite.partyIds;
    const adjustmentIds = hasAdjustmentIds ? body.adjustmentPartyIds as string[] :
      invite.adjustmentPartyIds.filter((id) => effectiveIds.includes(id));
    if (!adjustmentIds.every((id) => effectiveIds.includes(id))) return { kind: "foreign-party" as const };
    const adjustmentParties = adjustmentIds.length ? await tx.select({ id: partiesTable.id }).from(partiesTable)
      .where(and(eq(partiesTable.businessId, businessId), inArray(partiesTable.id, adjustmentIds))) : [];
    if (adjustmentParties.length !== adjustmentIds.length) return { kind: "foreign-party" as const };
    const updateSet: { partyIds?: string[]; status?: "revoked"; adjustmentPartyIds: string[] } = { adjustmentPartyIds: adjustmentIds };
    if (partyIds) updateSet.partyIds = partyIds;
    if (body.status === "suspended") updateSet.status = "revoked";
    const [updated] = await tx.update(workerInvitesTable).set(updateSet).where(and(
      eq(workerInvitesTable.id, invite.id),
      eq(workerInvitesTable.status, "pending"),
    )).returning({ id: workerInvitesTable.id, status: workerInvitesTable.status });
    if (!updated) return { kind: "conflict" as const, workerId: invite.claimedUserId };
    return { kind: "updated" as const, id: updated.id, status: updated.status, partyIds: effectiveIds, adjustmentPartyIds: adjustmentIds };
  })();
  if (inviteResult.kind === "claimed" || inviteResult.kind === "conflict") {
    return { status: 409, body: {
      error: "Invitation was already claimed",
      workerId: inviteResult.workerId,
    } };
  }
  if (inviteResult.kind === "revoked") {
    return { status: 404, body: { error: "Worker not found" } };
  }
  if (inviteResult.kind === "invalid-status") {
    return { status: 400, body: { error: "Pending invitations can only be revoked, not activated" } };
  }
  if (inviteResult.kind === "duplicate-parties") {
    return { status: 400, body: { error: "partyIds must not contain duplicates" } };
  }
  if (inviteResult.kind === "foreign-party") {
    return { status: 400, body: { error: "partyIds must belong to this business; adjustmentPartyIds must be a subset" } };
  }
  if (inviteResult.kind === "updated") {
    return { status: 200, body: { id: inviteResult.id, status: inviteResult.status, partyIds: inviteResult.partyIds, adjustmentPartyIds: inviteResult.adjustmentPartyIds } };
  }
  const [worker] = await tx.select().from(appUsersTable).where(and(
    eq(appUsersTable.id, req.params.id),
    eq(appUsersTable.businessId, businessId),
    eq(appUsersTable.role, "staff"),
    isNull(appUsersTable.workerAccessDeletedAt),
  )).for("update").limit(1);
  if (!worker) {
    return { status: 404, body: { error: "Worker not found" } };
  }
  const partyIds = body.partyIds as string[] | undefined;
  const assignments = await tx.select({ partyId: workerPartyAssignmentsTable.partyId }).from(workerPartyAssignmentsTable)
    .where(eq(workerPartyAssignmentsTable.userId, worker.id));
  const effectiveIds = partyIds ?? assignments.map((a) => a.partyId);
  const adjustmentIds = hasAdjustmentIds ? body.adjustmentPartyIds as string[] :
    worker.adjustmentPartyIds.filter((id) => effectiveIds.includes(id));
  const allowedParties = effectiveIds.length ? await tx.select({ id: partiesTable.id }).from(partiesTable)
    .where(and(eq(partiesTable.businessId, businessId), inArray(partiesTable.id, effectiveIds))) : [];
  if (!adjustmentIds.every((id) => effectiveIds.includes(id) && allowedParties.some((p) => p.id === id))) {
    return { status: 400, body: { error: "adjustmentPartyIds must be assigned parties in this business" } };
  }
  if (partyIds) {
    if (new Set(partyIds).size !== partyIds.length) {
      return { status: 400, body: { error: "partyIds must not contain duplicates" } };
    }
    const parties = partyIds.length ? await tx.select({ id: partiesTable.id }).from(partiesTable).where(and(
      eq(partiesTable.businessId, businessId), inArray(partiesTable.id, partyIds),
    )) : [];
    if (parties.length !== new Set(partyIds).size || parties.some((party) => !partyIds.includes(party.id))) {
      return { status: 400, body: { error: "partyIds must belong to this business" } };
    }
    await tx.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, worker.id));
    if (partyIds.length) await tx.insert(workerPartyAssignmentsTable).values(partyIds.map((partyId) => ({ userId: worker.id, partyId }))).onConflictDoNothing();
  }
  await tx.update(appUsersTable).set({ adjustmentPartyIds: adjustmentIds,
    ...(hasStatus ? { status: body.status as "active" | "suspended" } : {}),
  }).where(eq(appUsersTable.id, worker.id));
  return { status: 200, body: { id: worker.id, status: hasStatus ? body.status : worker.status, partyIds: effectiveIds, adjustmentPartyIds: adjustmentIds } };
  });
  res.status(result.status).json(result.body);
});

router.delete("/owner/workers/:id", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  if (!UUID_PATTERN.test(req.params.id)) { res.status(400).json({ error: "Invalid worker id" }); return; }
  const deleted = await db.transaction(async (tx) => {
    await tx.select({ id: businessesTable.id }).from(businessesTable).where(eq(businessesTable.id, businessId)).for("update");
    const [invite] = await tx.select().from(workerInvitesTable).where(and(
      eq(workerInvitesTable.id, req.params.id), eq(workerInvitesTable.businessId, businessId),
    )).for("update").limit(1);
    if (invite && invite.status !== "claimed") {
      await tx.update(workerInvitesTable).set({ status: "revoked", partyIds: [], adjustmentPartyIds: [] })
        .where(eq(workerInvitesTable.id, invite.id));
      return true;
    }
    const workerId = invite?.claimedUserId ?? req.params.id;
    const [worker] = await tx.select().from(appUsersTable).where(and(
      eq(appUsersTable.id, workerId), eq(appUsersTable.businessId, businessId), eq(appUsersTable.role, "staff"),
    )).for("update").limit(1);
    if (!worker) return false;
    await tx.update(appUsersTable).set({ workerAccessDeletedAt: new Date(), status: "suspended",
      adjustmentPartyIds: [], phoneSessionVersion: sql`${appUsersTable.phoneSessionVersion} + 1`,
    }).where(eq(appUsersTable.id, worker.id));
    await tx.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, worker.id));
    await tx.update(appUserLoginSessionsTable).set({ revokedAt: new Date() })
      .where(eq(appUserLoginSessionsTable.userId, worker.id));
    // Revoke any outstanding re-invitation too; old invitations never restore access.
    if (worker.verifiedEmail || worker.phone) {
      await tx.update(workerInvitesTable).set({ status: "revoked", partyIds: [], adjustmentPartyIds: [] }).where(and(
        eq(workerInvitesTable.businessId, businessId), eq(workerInvitesTable.status, "pending"),
        worker.verifiedEmail ? eq(workerInvitesTable.email, worker.verifiedEmail) : eq(workerInvitesTable.phone, worker.phone!),
      ));
    }
    return true;
  });
  if (!deleted) { res.status(404).json({ error: "Worker not found" }); return; }
  res.status(204).end();
});

router.get("/owner/parties", async (req, res): Promise<void> => {
  const { businessId } = req as AuthenticatedRequest;
  const parties = await db.select({ id: partiesTable.id, name: partiesTable.name, role: partiesTable.role })
    .from(partiesTable).where(eq(partiesTable.businessId, businessId));
  res.json(parties);
});

export default router;