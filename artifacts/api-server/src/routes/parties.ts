import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  db,
  appUsersTable,
  ledgerEntriesTable,
  ledgerRequestReceiptsTable,
  partiesTable,
  userBusinessesTable,
  workerInvitesTable,
  workerPartyAssignmentsTable,
} from "@workspace/db";
import { broadcast } from "../lib/eventBus";
import {
  createOwnerEntryNotificationsBestEffort,
  publishOwnerEntryNotifications,
} from "../lib/ownerNotifications";
import {
  ListPartiesQueryParams,
  ListPartiesResponse,
  CreatePartyBody,
  CreatePartyResponse,
  GetPartyParams,
  GetPartyResponse,
  UpdatePartyBody,
  UpdatePartyParams,
  ListLedgerEntriesParams,
  ListLedgerEntriesResponse,
  CreateLedgerEntryParams,
  CreateLedgerEntryBody,
  CreateLedgerEntryResponse,
  SendPaymentReminderParams,
  SendPaymentReminderResponse,
  DeletePartyParams,
  DeletePartyResponse,
  PatchLedgerEntryParams,
  PatchLedgerEntryBody,
  PatchLedgerEntryResponse,
} from "@workspace/api-zod";
import { apiValidationErrorMessage } from "../lib/apiValidation";

// Owner grant edits/deletion lock the same user row. A staff write either
// commits before revocation or sees the revoked grants; it cannot race past it.
async function staffCanWrite(tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string, businessId: string, sourceId: string, destinationId?: string): Promise<boolean> {
  const [user] = await tx.select().from(appUsersTable).where(eq(appUsersTable.id, userId)).for("update").limit(1);
  if (!user || user.role !== "staff" || user.status !== "active" || user.workerAccessDeletedAt ||
      user.businessId !== businessId) return false;
  if (destinationId && (!user.adjustmentPartyIds.includes(sourceId) ||
      !user.adjustmentPartyIds.includes(destinationId))) return false;
  const assigned = await tx.select({ id: partiesTable.id }).from(workerPartyAssignmentsTable)
    .innerJoin(partiesTable, eq(partiesTable.id, workerPartyAssignmentsTable.partyId))
    .where(and(eq(workerPartyAssignmentsTable.userId, userId),
      eq(partiesTable.businessId, businessId), eq(partiesTable.id, sourceId)));
  return assigned.length === 1;
}

type EntryTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ReceiptEntry = typeof ledgerEntriesTable.$inferSelect;
const DELETED_RECEIPT_SOURCE = { __deletedEntry: true };

async function redactDeletedEntryReceipts(
  tx: EntryTransaction,
  businessId: string,
  entryIds: string[],
): Promise<void> {
  if (!entryIds.length) return;
  await tx.update(ledgerRequestReceiptsTable)
    .set({ sourceEntry: DELETED_RECEIPT_SOURCE })
    .where(and(
      eq(ledgerRequestReceiptsTable.businessId, businessId),
      inArray(sql`${ledgerRequestReceiptsTable.sourceEntry}->>'id'`, entryIds),
    ));
}

async function actorCanWrite(tx: EntryTransaction, role: string, userId: string,
  businessId: string, sourceId: string, destinationId?: string) {
  if (role === "staff") return staffCanWrite(tx, userId, businessId, sourceId, destinationId);
  if (role !== "owner") return false;
  // All real users have database UUIDs. Test/dev request shims can use a
  // synthetic principal; real owner membership must be rechecked in the same
  // transaction as the receipt lookup and ledger writes.
  if (!isUuid(userId)) return true;
  const [user] = await tx.select({ role: appUsersTable.role, status: appUsersTable.status })
    .from(appUsersTable).where(eq(appUsersTable.id, userId)).for("share").limit(1);
  if (!user || user.role !== "owner" || user.status !== "active") return false;
  const [membership] = await tx.select({ businessId: userBusinessesTable.businessId })
    .from(userBusinessesTable).where(and(eq(userBusinessesTable.userId, userId),
      eq(userBusinessesTable.businessId, businessId))).for("share").limit(1);
  return !!membership;
}

// Advisory lock serializes two simultaneous attempts with the same key,
// including response-loss retries. The unique index remains the backstop.
async function existingRequest(tx: EntryTransaction, businessId: string, userId: string,
  requestId: string | undefined, fingerprint: string): Promise<
  { status: "new" } | { status: "replayed"; entry: ReceiptEntry } |
  { status: "conflict" } | { status: "deleted" }
> {
  if (!requestId) return { status: "new" };
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${businessId + ":" + userId}), hashtext(${requestId}))`);
  const [receipt] = await tx.select().from(ledgerRequestReceiptsTable).where(and(
    eq(ledgerRequestReceiptsTable.businessId, businessId),
    eq(ledgerRequestReceiptsTable.actorId, userId),
    eq(ledgerRequestReceiptsTable.clientRequestId, requestId),
  )).limit(1);
  if (!receipt) return { status: "new" };
  if (receipt.fingerprint !== fingerprint) return { status: "conflict" };
  if ((receipt.sourceEntry as { __deletedEntry?: unknown } | null)?.__deletedEntry === true) {
    return { status: "deleted" };
  }
  return { status: "replayed", entry: receipt.sourceEntry as ReceiptEntry };
}

async function saveRequest(tx: EntryTransaction, businessId: string, userId: string,
  requestId: string | undefined, fingerprint: string, entry: ReceiptEntry) {
  if (!requestId) return;
  await tx.insert(ledgerRequestReceiptsTable).values({
    businessId, actorId: userId, clientRequestId: requestId, fingerprint, sourceEntry: entry,
  });
}
import {
  applyPartyFilters,
  fromSignedBalance,
  getOrCreateBusinessSettings,
  toDateOnlyString,
  toSignedBalance,
} from "../lib/khatabook";
import { ObjectStorageService } from "../lib/objectStorage";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function ledgerDelta(type: "YOU_GAVE" | "YOU_GOT", amount: number): number {
  return type === "YOU_GAVE" ? amount : -amount;
}

function removeAdjustmentSuffix(description: string, partyName: string): string {
  const suffix = ` — অ্যাডজাস্ট করা হয়েছে ${partyName}-এর সাথে`;
  if (description.endsWith(suffix)) return description.slice(0, -suffix.length).trim();
  const bareSuffix = `অ্যাডজাস্ট করা হয়েছে ${partyName}-এর সাথে`;
  return description === bareSuffix ? "" : description;
}

function withAdjustmentSuffix(description: string, partyName: string): string {
  const suffix = `অ্যাডজাস্ট করা হয়েছে ${partyName}-এর সাথে`;
  const normalized = description.trim();
  if (normalized === suffix || normalized.endsWith(` — ${suffix}`)) return normalized;
  return normalized ? `${normalized} — ${suffix}` : suffix;
}

function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Grants authorize choosing a counterparty, never reading its ledger or balance.
router.get("/adjustment-targets", async (req, res): Promise<void> => {
  const { businessId, role, userId } = req as unknown as AuthenticatedRequest;
  const partyRoleRaw = typeof req.query.partyRole === "string" ? req.query.partyRole : undefined;
  if (req.query.partyRole !== undefined &&
      partyRoleRaw !== "CUSTOMER" && partyRoleRaw !== "SUPPLIER") {
    res.status(400).json({ error: "partyRole must be CUSTOMER or SUPPLIER" });
    return;
  }
  const partyRole = partyRoleRaw as "CUSTOMER" | "SUPPLIER" | undefined;
  const [user] = role === "staff"
    ? await db.select({ adjustmentPartyIds: appUsersTable.adjustmentPartyIds }).from(appUsersTable)
      .where(and(eq(appUsersTable.id, userId), eq(appUsersTable.businessId, businessId))).limit(1)
    : [];
  if (role === "staff" && (!user || !user.adjustmentPartyIds.length)) {
    res.json([]);
    return;
  }
  const rows = await db.select({ id: partiesTable.id, name: partiesTable.name, role: partiesTable.role })
    .from(partiesTable).where(and(eq(partiesTable.businessId, businessId),
      partyRole ? eq(partiesTable.role, partyRole) : undefined,
      role === "staff" ? inArray(partiesTable.id, user!.adjustmentPartyIds) : undefined));
  res.json(rows);
});

router.get("/parties", async (req, res): Promise<void> => {
  const { businessId, userId, role: userRole } = req as unknown as AuthenticatedRequest;
  const parsed = ListPartiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { role: partyRole, search, dueFilter } = parsed.data;
  let condition = applyPartyFilters(businessId, partyRole, search);
  if (userRole === "staff") {
    const assignments = await db.select({ partyId: workerPartyAssignmentsTable.partyId })
      .from(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, userId));
    if (!assignments.length) {
      res.json([]);
      return;
    }
    condition = and(condition, inArray(partiesTable.id, assignments.map(({ partyId }) => partyId)))!;
  }

  const rows = await db
    .select()
    .from(partiesTable)
    .where(condition)
    .orderBy(desc(partiesTable.lastTransactionAt), desc(partiesTable.createdAt));

  const today = toDateOnlyString(new Date())!;

  const filtered = rows.filter((party) => {
    if (!dueFilter || dueFilter === "ALL") {
      return true;
    }
    if (dueFilter === "NO_DUE_DATE") {
      return party.dueDate == null;
    }
    if (party.dueDate == null) {
      return false;
    }
    if (dueFilter === "DUE_TODAY") {
      return party.dueDate === today;
    }
    if (dueFilter === "UPCOMING") {
      return party.dueDate > today;
    }
    return true;
  });

  res.json(
    ListPartiesResponse.parse(
      filtered.map((party) => ({
        ...party,
        currentBalance: Number(party.currentBalance),
      })),
    ),
  );
});

router.post("/parties", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  const parsed = CreatePartyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: apiValidationErrorMessage(parsed.error) });
    return;
  }

  const { id: requestedId, name, phone, role, openingBalance, openingBalanceType, dueDate } =
    parsed.data;
  if (requestedId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId)) {
    res.status(400).json({ error: "id must be a UUID" });
    return;
  }

  const signedOpening =
    openingBalance && openingBalance > 0
      ? openingBalanceType === "YOU_WILL_GIVE"
        ? -openingBalance
        : openingBalance
      : 0;
  const { currentBalance, balanceType } = fromSignedBalance(signedOpening);

  const [createdParty] = await db
    .insert(partiesTable)
    .values({
      ...(requestedId ? { id: requestedId } : {}),
      businessId,
      name,
      phone: phone || "",
      role,
      currentBalance,
      balanceType,
      dueDate: toDateOnlyString(dueDate ?? null),
      lastTransactionAt: signedOpening !== 0 ? new Date() : null,
    })
    .onConflictDoNothing({ target: partiesTable.id })
    .returning();

  let party = createdParty;
  if (!party && requestedId) {
    const [existing] = await db.select().from(partiesTable).where(and(
      eq(partiesTable.id, requestedId),
      eq(partiesTable.businessId, businessId),
    )).limit(1);
    if (!existing) {
      res.status(409).json({ error: "Party ID is already in use" });
      return;
    }
    party = existing;
    res.setHeader("X-Idempotent-Replay", "true");
  }
  if (!party) {
    res.status(500).json({ error: "Could not create party" });
    return;
  }

  if (createdParty) {
    broadcast(businessId, { type: 'party.created', payload: { partyId: party.id } });
  }

  res.status(createdParty ? 201 : 200).json(
    CreatePartyResponse.parse({
      ...party,
      currentBalance: Number(party.currentBalance),
    }),
  );
});

router.get("/parties/:partyId", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  const parsed = GetPartyParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [party] = await db
    .select()
    .from(partiesTable)
    .where(
      and(
        eq(partiesTable.id, parsed.data.partyId),
        eq(partiesTable.businessId, businessId),
      ),
    );

  if (!party) {
    res.status(404).json({ error: "Party not found" });
    return;
  }

  res.json(
    GetPartyResponse.parse({
      ...party,
      currentBalance: Number(party.currentBalance),
    }),
  );
});

router.patch("/parties/:partyId", async (req, res): Promise<void> => {
  const { businessId, userId, role } = req as unknown as AuthenticatedRequest;
  const params = UpdatePartyParams.safeParse(req.params);
  const body = UpdatePartyBody.safeParse(req.body);
  if (!params.success || !body.success) {
    const message = !params.success
      ? params.error.message
      : !body.success
        ? body.error.message
        : "Invalid party update";
    res.status(400).json({ error: message });
    return;
  }

  const { name, phone, dueDate } = body.data;
  if (name === undefined && phone === undefined && dueDate === undefined) {
    res.status(400).json({ error: "At least one party field must be provided" });
    return;
  }
  if (name !== undefined && !name.trim()) {
    res.status(400).json({ error: "Party name cannot be blank" });
    return;
  }
  if (dueDate !== undefined && dueDate !== null && !isValidDateOnly(dueDate)) {
    res.status(400).json({ error: "dueDate must be a valid YYYY-MM-DD date or null" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    if (!(await actorCanWrite(tx, role, userId, businessId, params.data.partyId))) {
      return { status: 'denied' } as const;
    }
    const [party] = await tx.update(partiesTable).set({
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(phone !== undefined ? { phone: phone.trim() } : {}),
      ...(dueDate !== undefined ? { dueDate: toDateOnlyString(dueDate) } : {}),
    }).where(and(
      eq(partiesTable.id, params.data.partyId),
      eq(partiesTable.businessId, businessId),
    )).returning();
    return party ? { status: 'updated', party } as const : { status: 'missing' } as const;
  });

  if (result.status === 'denied') {
    res.status(403).json({ error: "Party access was revoked" });
    return;
  }
  if (result.status === 'missing') {
    res.status(404).json({ error: "Party not found" });
    return;
  }

  const { party } = result;
  broadcast(businessId, { type: 'party.updated', payload: { partyId: party.id } });
  res.json(GetPartyResponse.parse({
    ...party,
    currentBalance: Number(party.currentBalance),
  }));
});

router.get(
  "/parties/:partyId/ledger-entries",
  async (req, res): Promise<void> => {
    const { businessId, role } = req as unknown as AuthenticatedRequest;
    const parsed = ListLedgerEntriesParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [party] = await db
      .select({ id: partiesTable.id })
      .from(partiesTable)
      .where(
        and(
          eq(partiesTable.id, parsed.data.partyId),
          eq(partiesTable.businessId, businessId),
        ),
      );

    if (!party) {
      res.status(404).json({ error: "Party not found" });
      return;
    }

    const entries = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.partyId, parsed.data.partyId))
      .orderBy(desc(ledgerEntriesTable.createdAt));

    res.json(
      ListLedgerEntriesResponse.parse(
        entries.map((entry) => ({
          ...entry,
          linkedEntryId: role === "staff" && entry.isTransfer ? null : entry.linkedEntryId,
          amount: Number(entry.amount),
        })),
      ),
    );
  },
);

router.post(
  "/parties/:partyId/ledger-entries",
  async (req, res): Promise<void> => {
    const { businessId, userId, role } = req as unknown as AuthenticatedRequest;
    const params = CreateLedgerEntryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const rawBody = req.body as Record<string, unknown> | null;
    for (const field of ["entryDate", "dueDate"] as const) {
      if (rawBody?.[field] !== undefined && rawBody[field] !== null && !isValidDateOnly(rawBody[field])) {
        res.status(400).json({ error: `${field} must be a valid ISO date` });
        return;
      }
    }
    const body = CreateLedgerEntryBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: apiValidationErrorMessage(body.error) });
      return;
    }

    // Validate that billImage, when provided, always carries the /objects/ prefix
    // so that the cleanup path (which checks for this prefix) is guaranteed to fire.
    if (body.data.billImage != null && !body.data.billImage.startsWith("/objects/")) {
      res.status(400).json({ error: "billImage must start with /objects/" });
      return;
    }

    const [party] = await db
      .select()
      .from(partiesTable)
      .where(
        and(
          eq(partiesTable.id, params.data.partyId),
          eq(partiesTable.businessId, businessId),
        ),
      );

    if (!party) {
      res.status(404).json({ error: "Party not found" });
      return;
    }

    const { type, amount, description, billReference, billImage, entryDate, dueDate, isTransfer, transferPartyId, clientRequestId } = body.data;
    const entryDateValue = toDateOnlyString(entryDate ?? null);
    const fingerprint = createHash("sha256").update(JSON.stringify({
      partyId: party.id, type, amount: amount.toFixed(2),
      description: description ?? "", billReference: billReference ?? null,
      billImage: billImage ?? null, dueDate: toDateOnlyString(dueDate ?? null),
      entryDate: entryDateValue,
      isTransfer: !!isTransfer, transferPartyId: transferPartyId ?? null,
    })).digest("hex");
    if ((isTransfer && (!transferPartyId || transferPartyId === party.id)) ||
        (!isTransfer && transferPartyId)) {
      res.status(400).json({ error: "An adjustment requires a different destination party" }); return;
    }

    // ── TRANSFER MODE: atomic double-entry across two parties ─────────────────
    if (isTransfer && transferPartyId) {
      const [transferParty] = await db
        .select()
        .from(partiesTable)
        .where(
          and(
            eq(partiesTable.id, transferPartyId),
            eq(partiesTable.businessId, businessId),
          ),
        );

      if (!transferParty) {
        res.status(403).json({ error: "Adjustment is not permitted" });
        return;
      }

      const counterType: "YOU_GAVE" | "YOU_GOT" = type === "YOU_GAVE" ? "YOU_GOT" : "YOU_GAVE";
      const primaryDesc = description?.trim()
        ? `${description.trim()} — অ্যাডজাস্ট করা হয়েছে ${transferParty.name}-এর সাথে`
        : `অ্যাডজাস্ট করা হয়েছে ${transferParty.name}-এর সাথে`;
      const counterDesc = `অ্যাডজাস্ট করা হয়েছে ${party.name}-এর সাথে`;

      // eslint-disable-next-line prefer-const
      let primaryEntry!: typeof ledgerEntriesTable.$inferSelect;
      // eslint-disable-next-line prefer-const
      let counterEntry!: typeof ledgerEntriesTable.$inferSelect;

      const now = new Date();

      const result = await db.transaction(async (tx) => {
        if (!(await actorCanWrite(tx, role, userId, businessId, party.id, transferPartyId))) return { status: "denied" } as const;
        const receipt = await existingRequest(tx, businessId, userId, clientRequestId, fingerprint);
        if (receipt.status !== "new") return receipt;
        // Lock in stable order and use current balances for concurrent transfers.
        const locked = await tx.select().from(partiesTable).where(and(
          eq(partiesTable.businessId, businessId), inArray(partiesTable.id, [party.id, transferPartyId]),
        )).orderBy(partiesTable.id).for("update");
        const source = locked.find((p) => p.id === party.id);
        const destination = locked.find((p) => p.id === transferPartyId);
        if (!source || !destination) return { status: "denied" } as const;
        if (source.role !== destination.role) return { status: "role_mismatch" } as const;
        // Insert both entries first (without linkedEntryId — we don't know the
        // counter ID yet when inserting the primary entry).
        [primaryEntry] = await tx
          .insert(ledgerEntriesTable)
          .values({
            partyId: party.id,
            createdByUserId: isUuid(userId) ? userId : null,
            type,
            amount: amount.toFixed(2),
            description: primaryDesc,
            billReference: billReference ?? null,
            billImage: billImage ?? null,
            ...(entryDateValue ? { createdAt: new Date(`${entryDateValue}T00:00:00.000Z`) } : {}),
            dueDate: toDateOnlyString(dueDate ?? null),
            isTransfer: true,
            transferPartyId,
          })
          .returning();

        [counterEntry] = await tx
          .insert(ledgerEntriesTable)
          .values({
            partyId: transferPartyId,
            createdByUserId: isUuid(userId) ? userId : null,
            type: counterType,
            amount: amount.toFixed(2),
            description: counterDesc,
            ...(entryDateValue ? { createdAt: new Date(`${entryDateValue}T00:00:00.000Z`) } : {}),
            dueDate: toDateOnlyString(dueDate ?? null),
            isTransfer: true,
            transferPartyId: party.id,
          })
          .returning();

        // Cross-link both entries now that both IDs are known.
        await tx
          .update(ledgerEntriesTable)
          .set({ linkedEntryId: counterEntry!.id })
          .where(eq(ledgerEntriesTable.id, primaryEntry!.id));
        await tx
          .update(ledgerEntriesTable)
          .set({ linkedEntryId: primaryEntry!.id })
          .where(eq(ledgerEntriesTable.id, counterEntry!.id));

        // Update party A balance
        const partyASigned = toSignedBalance(source);
        const partyADelta = type === "YOU_GAVE" ? amount : -amount;
        const partyABalance = fromSignedBalance(partyASigned + partyADelta);
        await tx
          .update(partiesTable)
          .set({ ...partyABalance, lastTransactionAt: now })
          .where(eq(partiesTable.id, party.id));

        // Update party B balance
        const partyBSigned = toSignedBalance(destination);
        const partyBDelta = counterType === "YOU_GAVE" ? amount : -amount;
        const partyBBalance = fromSignedBalance(partyBSigned + partyBDelta);
        await tx
          .update(partiesTable)
          .set({ ...partyBBalance, lastTransactionAt: now })
          .where(eq(partiesTable.id, transferPartyId));
        await saveRequest(tx, businessId, userId, clientRequestId, fingerprint,
          { ...primaryEntry!, linkedEntryId: counterEntry!.id });
        return { status: "created" } as const;
      });
      if (result.status === "denied") { res.status(403).json({ error: "Adjustment is not permitted" }); return; }
      if (result.status === "role_mismatch") {
        res.status(400).json({ error: "Adjustment parties must have the same role" });
        return;
      }
      if (result.status === "conflict") { res.status(409).json({ error: "Request ID was already used for different entry data" }); return; }
      if (result.status === "deleted") {
        res.status(409).json({ error: "This transaction was deleted and cannot be restored by an offline retry" });
        return;
      }
      if (result.status === "replayed") {
        res.setHeader("X-Idempotent-Replay", "true");
        res.status(200).json(CreateLedgerEntryResponse.parse({
          ...result.entry, linkedEntryId: role === "staff" ? null : result.entry.linkedEntryId,
          amount: Number(result.entry.amount),
        }));
        return;
      }

      // Reflect the linked IDs in the in-memory objects (update queries don't
      // return rows without .returning(), so we patch them manually here).
      const primaryEntryFinal = { ...primaryEntry!, linkedEntryId: counterEntry!.id };

      const notifications = role === "staff"
        ? await createOwnerEntryNotificationsBestEffort({
          businessId,
          actorUserId: userId,
          entries: [{ entryId: primaryEntry!.id, partyId: party.id, partyName: party.name }],
        })
        : [];
      publishOwnerEntryNotifications(notifications);
      broadcast(businessId, { type: "ledger.created", payload: { partyId: party.id, entryId: primaryEntry!.id } });
      broadcast(businessId, { type: "ledger.created", payload: { partyId: transferPartyId, entryId: counterEntry!.id } });

      res.status(201).json(
        CreateLedgerEntryResponse.parse({
          ...primaryEntryFinal,
          linkedEntryId: role === "staff" ? null : primaryEntryFinal.linkedEntryId,
          amount: Number(primaryEntryFinal.amount),
        }),
      );
      return;
    }

    // ── NORMAL MODE ───────────────────────────────────────────────────────────
    const result = await db.transaction(async (tx) => {
    if (!(await actorCanWrite(tx, role, userId, businessId, party.id))) return { status: "denied" } as const;
    const receipt = await existingRequest(tx, businessId, userId, clientRequestId, fingerprint);
    if (receipt.status !== "new") return receipt;
    const [currentParty] = await tx.select().from(partiesTable).where(and(
      eq(partiesTable.id, party.id), eq(partiesTable.businessId, businessId),
    )).for("update").limit(1);
    if (!currentParty) return { status: "denied" } as const;
    const currentSigned = toSignedBalance(currentParty);
    const delta = type === "YOU_GAVE" ? amount : -amount;
    const nextSigned = currentSigned + delta;
    const { currentBalance, balanceType } = fromSignedBalance(nextSigned);

    const now = new Date();

    const [saved] = await tx
      .insert(ledgerEntriesTable)
      .values({
        partyId: party.id,
        createdByUserId: isUuid(userId) ? userId : null,
        type,
        amount: amount.toFixed(2),
        description: description ?? "",
        billReference: billReference ?? null,
        billImage: billImage ?? null,
        ...(entryDateValue ? { createdAt: new Date(`${entryDateValue}T00:00:00.000Z`) } : {}),
        dueDate: toDateOnlyString(dueDate ?? null),
      })
      .returning();

    await tx
      .update(partiesTable)
      .set({
        currentBalance,
        balanceType,
        lastTransactionAt: now,
        ...(dueDate ? { dueDate: toDateOnlyString(dueDate) } : {}),
      })
      .where(eq(partiesTable.id, party.id));
    await saveRequest(tx, businessId, userId, clientRequestId, fingerprint, saved!);
    return { status: "created", entry: saved! } as const;
    });
    if (result.status === "denied") { res.status(403).json({ error: "Party access was revoked" }); return; }
    if (result.status === "conflict") { res.status(409).json({ error: "Request ID was already used for different entry data" }); return; }
    if (result.status === "deleted") {
      res.status(409).json({ error: "This transaction was deleted and cannot be restored by an offline retry" });
      return;
    }
    if (result.status === "replayed") {
      res.setHeader("X-Idempotent-Replay", "true");
      res.status(200).json(CreateLedgerEntryResponse.parse({
        ...result.entry, amount: Number(result.entry.amount),
      }));
      return;
    }
    const entry = result.entry;

    const notifications = role === "staff"
      ? await createOwnerEntryNotificationsBestEffort({
        businessId,
        actorUserId: userId,
        entries: [{ entryId: entry!.id, partyId: party.id, partyName: party.name }],
      })
      : [];
    publishOwnerEntryNotifications(notifications);
    broadcast(businessId, { type: 'ledger.created', payload: { partyId: party.id, entryId: entry!.id } });

    res.status(201).json(
      CreateLedgerEntryResponse.parse({
        ...entry,
        amount: Number(entry!.amount),
      }),
    );
  },
);

router.patch(
  "/parties/:partyId/ledger-entries/:entryId",
  async (req, res): Promise<void> => {
    const { businessId, userId, role } = req as unknown as AuthenticatedRequest;
    const params = PatchLedgerEntryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const body = PatchLedgerEntryBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: apiValidationErrorMessage(body.error) });
      return;
    }
    const rawBody = req.body as Record<string, unknown>;
    const hasTransferMode = Object.prototype.hasOwnProperty.call(rawBody, "isTransfer");
    const hasTransferParty = Object.prototype.hasOwnProperty.call(rawBody, "transferPartyId");
    if (hasTransferMode !== hasTransferParty) {
      res.status(400).json({ error: "isTransfer and transferPartyId must be provided together" });
      return;
    }
    if (body.data.billImage != null && !body.data.billImage.startsWith("/objects/")) {
      res.status(400).json({ error: "billImage must start with /objects/" });
      return;
    }
    if (hasTransferMode) {
      const targetId = body.data.transferPartyId ?? null;
      if (body.data.isTransfer === true && (!targetId || !isUuid(targetId))) {
        res.status(400).json({ error: "A valid transferPartyId is required for an adjustment" });
        return;
      }
      if (body.data.isTransfer === false && targetId !== null) {
        res.status(400).json({ error: "transferPartyId must be null when isTransfer is false" });
        return;
      }
    }

    // Fetch the full party row — needed for balance recalculation when the
    // amount or direction changes, and for ownership verification.
    const [party] = await db
      .select()
      .from(partiesTable)
      .where(
        and(
          eq(partiesTable.id, params.data.partyId),
          eq(partiesTable.businessId, businessId),
        ),
      );

    if (!party) {
      res.status(404).json({ error: "Party not found" });
      return;
    }

    const [entry] = await db
      .select()
      .from(ledgerEntriesTable)
      .where(
        and(
          eq(ledgerEntriesTable.id, params.data.entryId),
          eq(ledgerEntriesTable.partyId, params.data.partyId),
        ),
      );

    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    const hasTransferState = hasTransferMode && hasTransferParty;
    const desiredIsTransfer = hasTransferState ? body.data.isTransfer! : entry.isTransfer;
    const desiredTransferPartyId = hasTransferState
      ? (body.data.isTransfer ? body.data.transferPartyId ?? null : null)
      : (entry.isTransfer ? entry.transferPartyId : null);
    if (hasTransferState && desiredIsTransfer && desiredTransferPartyId === party.id) {
      res.status(400).json({ error: "An adjustment must link to a different party" });
      return;
    }

    const partyIdsToLock = Array.from(new Set([
      party.id,
      ...(entry.isTransfer && entry.transferPartyId ? [entry.transferPartyId] : []),
      ...(desiredIsTransfer && desiredTransferPartyId ? [desiredTransferPartyId] : []),
    ]));

    // A linked adjustment is one financial operation. Create, retarget, edit,
    // or remove both sides and all affected balances inside the same transaction.
    const mutation = await db.transaction(async (tx) => {
      const oldTargetId = entry.isTransfer ? entry.transferPartyId ?? undefined : undefined;
      if (!(await actorCanWrite(tx, role, userId, businessId, party.id, oldTargetId))) {
        return { status: "denied" } as const;
      }
      if (desiredIsTransfer && desiredTransferPartyId &&
          desiredTransferPartyId !== oldTargetId &&
          !(await actorCanWrite(tx, role, userId, businessId, party.id, desiredTransferPartyId))) {
        return { status: "denied" } as const;
      }

      const lockedParties = await tx.select().from(partiesTable).where(and(
        eq(partiesTable.businessId, businessId),
        inArray(partiesTable.id, partyIdsToLock),
      )).orderBy(partiesTable.id).for("update");
      if (lockedParties.length !== partyIdsToLock.length) {
        return { status: "party_missing" } as const;
      }
      const currentParty = lockedParties.find((row) => row.id === party.id);
      if (!currentParty) return { status: "missing" } as const;

      const [currentEntry] = await tx.select().from(ledgerEntriesTable).where(and(
        eq(ledgerEntriesTable.id, params.data.entryId),
        eq(ledgerEntriesTable.partyId, party.id),
      )).for("update").limit(1);
      if (!currentEntry) return { status: "missing" } as const;
      if (currentEntry.isTransfer !== entry.isTransfer ||
          currentEntry.transferPartyId !== entry.transferPartyId ||
          currentEntry.linkedEntryId !== entry.linkedEntryId) {
        return { status: "conflict" } as const;
      }

      const currentTargetId = currentEntry.isTransfer ? currentEntry.transferPartyId : null;
      const currentTarget = currentTargetId
        ? lockedParties.find((row) => row.id === currentTargetId)
        : undefined;
      const nextTarget = desiredIsTransfer && desiredTransferPartyId
        ? lockedParties.find((row) => row.id === desiredTransferPartyId)
        : undefined;
      if (currentEntry.isTransfer && (!currentTargetId || !currentEntry.linkedEntryId || !currentTarget)) {
        return { status: "broken_link" } as const;
      }
      if (currentTarget && currentTarget.role !== currentParty.role) {
        return { status: "broken_link" } as const;
      }
      if (desiredIsTransfer && (!desiredTransferPartyId || !nextTarget)) {
        return { status: "party_missing" } as const;
      }
      if (nextTarget && nextTarget.role !== currentParty.role) {
        return { status: "role_mismatch" } as const;
      }

      let currentCounter: typeof ledgerEntriesTable.$inferSelect | undefined;
      if (currentEntry.isTransfer) {
        const [counter] = await tx.select().from(ledgerEntriesTable).where(and(
          eq(ledgerEntriesTable.id, currentEntry.linkedEntryId!),
          eq(ledgerEntriesTable.partyId, currentTargetId!),
        )).for("update").limit(1);
        const oppositeType = currentEntry.type === "YOU_GAVE" ? "YOU_GOT" : "YOU_GAVE";
        if (!counter || !counter.isTransfer ||
            counter.transferPartyId !== currentParty.id ||
            counter.linkedEntryId !== currentEntry.id ||
            counter.type !== oppositeType ||
            Number(counter.amount) !== Number(currentEntry.amount)) {
          return { status: "broken_link" } as const;
        }
        currentCounter = counter;
      }

      const amount = Number((body.data.amount ?? Number(currentEntry.amount)).toFixed(2));
      const amountText = amount.toFixed(2);
      const type = body.data.type ?? currentEntry.type;
      const counterType = type === "YOU_GAVE" ? "YOU_GOT" : "YOU_GAVE";
      const transferStateChanged = desiredIsTransfer !== currentEntry.isTransfer ||
        desiredTransferPartyId !== currentTargetId;
      const submittedDescription = body.data.description ?? currentEntry.description;
      let description = submittedDescription;
      if (desiredIsTransfer && nextTarget && (transferStateChanged || body.data.description !== undefined)) {
        const baseDescription = currentTarget
          ? removeAdjustmentSuffix(submittedDescription, currentTarget.name)
          : submittedDescription;
        description = withAdjustmentSuffix(baseDescription, nextTarget.name);
      } else if (!desiredIsTransfer && currentTarget) {
        description = removeAdjustmentSuffix(submittedDescription, currentTarget.name);
      }

      const createdAt = body.data.entryDate
        ? new Date(`${body.data.entryDate.toISOString().slice(0, 10)}T00:00:00.000Z`)
        : currentEntry.createdAt;
      const dueDate = body.data.dueDate === undefined
        ? currentEntry.dueDate
        : body.data.dueDate === null
          ? null
          : body.data.dueDate.toISOString().slice(0, 10);
      const nextBillImage = body.data.billImage !== undefined
        ? body.data.billImage
        : currentEntry.billImage;
      const nextBillReference = body.data.billReference !== undefined
        ? body.data.billReference
        : currentEntry.billReference;

      let counterId = currentCounter?.id ?? null;
      if (desiredIsTransfer && !currentEntry.isTransfer && nextTarget && desiredTransferPartyId) {
        const [createdCounter] = await tx.insert(ledgerEntriesTable).values({
          partyId: desiredTransferPartyId,
          createdByUserId: isUuid(userId) ? userId : null,
          type: counterType,
          amount: amountText,
          description: `অ্যাডজাস্ট করা হয়েছে ${currentParty.name}-এর সাথে`,
          createdAt,
          dueDate,
          isTransfer: true,
          transferPartyId: currentParty.id,
          linkedEntryId: currentEntry.id,
        }).returning();
        if (!createdCounter) return { status: "missing" } as const;
        counterId = createdCounter.id;
      } else if (desiredIsTransfer && currentCounter && nextTarget && desiredTransferPartyId) {
        await tx.update(ledgerEntriesTable).set({
          partyId: desiredTransferPartyId,
          type: counterType,
          amount: amountText,
          description: `অ্যাডজাস্ট করা হয়েছে ${currentParty.name}-এর সাথে`,
          createdAt,
          dueDate,
          isTransfer: true,
          transferPartyId: currentParty.id,
          linkedEntryId: currentEntry.id,
        }).where(eq(ledgerEntriesTable.id, currentCounter.id));
      }

      const [saved] = await tx.update(ledgerEntriesTable).set({
        amount: amountText,
        type,
        description,
        billImage: nextBillImage,
        billReference: nextBillReference,
        createdAt,
        dueDate,
        isTransfer: desiredIsTransfer,
        transferPartyId: desiredIsTransfer ? desiredTransferPartyId : null,
        linkedEntryId: desiredIsTransfer ? counterId : null,
      }).where(and(
        eq(ledgerEntriesTable.id, currentEntry.id),
        eq(ledgerEntriesTable.partyId, currentParty.id),
      )).returning();
      if (!saved) return { status: "missing" } as const;

      if (currentCounter && !desiredIsTransfer) {
        await redactDeletedEntryReceipts(tx, businessId, [currentCounter.id]);
        await tx.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, currentCounter.id));
      }

      const balanceDeltas = new Map<string, number>();
      const addBalanceDelta = (partyId: string, delta: number) => {
        balanceDeltas.set(partyId, (balanceDeltas.get(partyId) ?? 0) + delta);
      };
      addBalanceDelta(
        currentParty.id,
        -ledgerDelta(currentEntry.type, Number(currentEntry.amount)) + ledgerDelta(type, amount),
      );
      if (currentCounter && currentTargetId) {
        addBalanceDelta(currentTargetId, -ledgerDelta(currentCounter.type, Number(currentCounter.amount)));
      }
      if (desiredIsTransfer && desiredTransferPartyId) {
        addBalanceDelta(desiredTransferPartyId, ledgerDelta(counterType, amount));
      }
      const now = new Date();
      for (const lockedParty of lockedParties) {
        const delta = balanceDeltas.get(lockedParty.id) ?? 0;
        if (delta !== 0) {
          await tx.update(partiesTable).set({
            ...fromSignedBalance(toSignedBalance(lockedParty) + delta),
            lastTransactionAt: now,
          }).where(eq(partiesTable.id, lockedParty.id));
        }
      }

      return {
        status: "updated",
        saved,
        oldBillImage: currentEntry.billImage,
        removedCounterBillImage: currentCounter && !desiredIsTransfer ? currentCounter.billImage : null,
        oldTargetId: currentTargetId,
        newTargetId: desiredIsTransfer ? desiredTransferPartyId : null,
        counterId,
        counterCreated: desiredIsTransfer && !currentEntry.isTransfer,
        counterRemoved: Boolean(currentCounter && !desiredIsTransfer),
        counterMoved: Boolean(currentCounter && desiredIsTransfer && currentTargetId !== desiredTransferPartyId),
      } as const;
    });

    if (mutation.status === "denied") {
      res.status(403).json({ error: "Adjustment access was revoked or is not permitted" });
      return;
    }
    if (mutation.status === "missing") {
      res.status(404).json({ error: "Entry or party not found" });
      return;
    }
    if (mutation.status === "party_missing") {
      res.status(403).json({ error: "Adjustment party is unavailable" });
      return;
    }
    if (mutation.status === "role_mismatch") {
      res.status(400).json({ error: "Adjustment parties must have the same role" });
      return;
    }
    if (mutation.status === "broken_link") {
      res.status(409).json({ error: "Linked adjustment is unavailable or inconsistent" });
      return;
    }
    if (mutation.status === "conflict") {
      res.status(409).json({ error: "This entry changed while it was being edited; reload and try again" });
      return;
    }

    const storageService = new ObjectStorageService();
    const imagesToDelete = new Set<string>();
    if (body.data.billImage !== undefined && mutation.oldBillImage &&
        mutation.oldBillImage !== body.data.billImage && mutation.oldBillImage.startsWith("/objects/")) {
      imagesToDelete.add(mutation.oldBillImage);
    }
    if (mutation.removedCounterBillImage?.startsWith("/objects/")) {
      imagesToDelete.add(mutation.removedCounterBillImage);
    }
    for (const objectPath of imagesToDelete) {
      storageService.deleteObjectEntity(objectPath).catch((err: unknown) => {
        req.log?.error({ err, objectPath }, "Failed to delete superseded bill photo during entry patch");
      });
    }

    broadcast(businessId, {
      type: "ledger.updated",
      payload: { partyId: party.id, entryId: params.data.entryId },
    });
    if (mutation.oldTargetId && mutation.counterId) {
      if (mutation.counterRemoved || mutation.counterMoved) {
        broadcast(businessId, {
          type: "ledger.deleted",
          payload: { partyId: mutation.oldTargetId, entryId: mutation.counterId },
        });
      } else {
        broadcast(businessId, {
          type: "ledger.updated",
          payload: { partyId: mutation.oldTargetId, entryId: mutation.counterId },
        });
      }
    }
    if (mutation.newTargetId && mutation.counterId && (mutation.counterCreated || mutation.counterMoved)) {
      broadcast(businessId, {
        type: "ledger.created",
        payload: { partyId: mutation.newTargetId, entryId: mutation.counterId },
      });
    }

    res.json(PatchLedgerEntryResponse.parse({
      ...mutation.saved,
      amount: Number(mutation.saved.amount),
      ...(role === "staff" ? { linkedEntryId: null } : {}),
    }));
  },
);

router.delete(
  "/parties/:partyId/entries/:entryId",
  async (req, res): Promise<void> => {
    const { businessId } = req as unknown as AuthenticatedRequest;
    const partyId = req.params.partyId as string;
    const entryId = req.params.entryId as string;

    const [party] = await db
      .select()
      .from(partiesTable)
      .where(
        and(
          eq(partiesTable.id, partyId),
          eq(partiesTable.businessId, businessId),
        ),
      );

    if (!party) {
      res.status(404).json({ error: "Party not found" });
      return;
    }

    const [entry] = await db
      .select()
      .from(ledgerEntriesTable)
      .where(
        and(
          eq(ledgerEntriesTable.id, entryId),
          eq(ledgerEntriesTable.partyId, partyId),
        ),
      );

    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    // ── TRANSFER: also delete the linked counter-entry atomically ────────────
    if (entry.isTransfer && entry.linkedEntryId) {
      const linkedEntryId = entry.linkedEntryId;

      const [linkedEntry] = await db
        .select()
        .from(ledgerEntriesTable)
        .where(eq(ledgerEntriesTable.id, linkedEntryId));

      const linkedPartyId = linkedEntry?.partyId ?? null;

      const [linkedParty] = linkedPartyId
        ? await db
            .select()
            .from(partiesTable)
            .where(
              and(
                eq(partiesTable.id, linkedPartyId),
                eq(partiesTable.businessId, businessId),
              ),
            )
        : [];

      await db.transaction(async (tx) => {
        // Serialize paired deletes with edits/transfers, while preserving the
        // legacy orphan cleanup path if the counter-entry is already missing.
        const locked = linkedPartyId && linkedParty ? await tx.select().from(partiesTable).where(and(
          eq(partiesTable.businessId, businessId), inArray(partiesTable.id, [partyId, linkedPartyId]),
        )).orderBy(partiesTable.id).for("update") : [];
        const currentParty = locked.find((p) => p.id === partyId) ?? party;
        const currentLinkedParty = locked.find((p) => p.id === linkedPartyId) ?? linkedParty;
        const [currentEntry] = await tx.select().from(ledgerEntriesTable)
          .where(and(eq(ledgerEntriesTable.id, entryId), eq(ledgerEntriesTable.partyId, partyId)))
          .for("update").limit(1);
        if (!currentEntry) return;
        const [currentCounter] = linkedEntry ? await tx.select().from(ledgerEntriesTable)
          .where(and(eq(ledgerEntriesTable.id, linkedEntryId), eq(ledgerEntriesTable.partyId, linkedEntry.partyId)))
          .for("update").limit(1) : [];
        const deletedEntryIds = [entryId];
        // Reverse primary party's balance.
        const primarySigned = toSignedBalance(currentParty);
        const primaryDelta = currentEntry.type === "YOU_GAVE" ? Number(currentEntry.amount) : -Number(currentEntry.amount);
        const primaryBalance = fromSignedBalance(primarySigned - primaryDelta);
        await tx
          .update(partiesTable)
          .set(primaryBalance)
          .where(eq(partiesTable.id, partyId));

        // Delete primary entry.
        await tx
          .delete(ledgerEntriesTable)
          .where(eq(ledgerEntriesTable.id, entryId));

        // Reverse linked party's balance and delete its entry (if it exists).
        if (currentCounter && currentLinkedParty) {
          const linkedSigned = toSignedBalance(currentLinkedParty);
          const linkedDelta =
            currentCounter.type === "YOU_GAVE"
              ? Number(currentCounter.amount)
              : -Number(currentCounter.amount);
          const linkedBalance = fromSignedBalance(linkedSigned - linkedDelta);
          await tx
            .update(partiesTable)
            .set(linkedBalance)
            .where(eq(partiesTable.id, linkedPartyId!));

          await tx
            .delete(ledgerEntriesTable)
            .where(eq(ledgerEntriesTable.id, linkedEntryId));
          deletedEntryIds.push(linkedEntryId);
        }
        await redactDeletedEntryReceipts(tx, businessId, deletedEntryIds);
      });

      // DB transaction committed — delete any bill photos from storage.
      // Done post-commit so a storage failure cannot leave the DB inconsistent.
      const transferBillImagePaths = [entry.billImage, linkedEntry?.billImage ?? null]
        .filter((p): p is string => typeof p === "string" && p.startsWith("/objects/"));

      if (transferBillImagePaths.length > 0) {
        const storageService = new ObjectStorageService();
        const results = await Promise.allSettled(
          transferBillImagePaths.map((p) => storageService.deleteObjectEntity(p)),
        );
        results.forEach((result, i) => {
          if (result.status === "rejected") {
            req.log?.error(
              { err: result.reason, objectPath: transferBillImagePaths[i] },
              "Failed to delete bill photo from storage during transfer entry delete",
            );
          }
        });
      }

      broadcast(businessId, { type: "ledger.deleted", payload: { partyId, entryId } });
      if (linkedEntry && linkedPartyId) {
        broadcast(businessId, {
          type: "ledger.deleted",
          payload: { partyId: linkedPartyId, entryId: linkedEntryId },
        });
      }

      res.json({ success: true });
      return;
    }

    // ── NORMAL (non-transfer) entry ───────────────────────────────────────────
    // Reverse this entry's effect on the running balance.
    // YOU_GAVE originally added +amount; YOU_GOT added -amount.
    const currentSigned = toSignedBalance(party);
    const delta = entry.type === "YOU_GAVE" ? Number(entry.amount) : -Number(entry.amount);
    const nextSigned = currentSigned - delta;
    const { currentBalance, balanceType } = fromSignedBalance(nextSigned);

    await db.transaction(async (tx) => {
      await tx
        .delete(ledgerEntriesTable)
        .where(eq(ledgerEntriesTable.id, entryId));
      await redactDeletedEntryReceipts(tx, businessId, [entryId]);

      await tx
        .update(partiesTable)
        .set({ currentBalance, balanceType })
        .where(eq(partiesTable.id, partyId));
    });

    // DB transaction committed — delete any attached bill photo from storage.
    // Done post-commit so a storage failure cannot leave the DB inconsistent.
    if (entry.billImage && entry.billImage.startsWith("/objects/")) {
      const storageService = new ObjectStorageService();
      const [result] = await Promise.allSettled([storageService.deleteObjectEntity(entry.billImage)]);
      if (result?.status === "rejected") {
        req.log?.error(
          { err: result.reason, objectPath: entry.billImage },
          "Failed to delete bill photo from storage during entry delete",
        );
      }
    }

    broadcast(businessId, { type: "ledger.deleted", payload: { partyId, entryId } });

    res.json({ success: true });
  },
);

router.delete("/parties/:partyId", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  const parsed = DeletePartyParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const deletion = await db.transaction(async (tx) => {
    const [party] = await tx.select().from(partiesTable).where(and(
      eq(partiesTable.id, parsed.data.partyId),
      eq(partiesTable.businessId, businessId),
    )).for("update").limit(1);
    if (!party) return null;

    const partyEntries = await tx.select().from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.partyId, party.id)).for("update");
    const possibleCounterEntries = await tx.select().from(ledgerEntriesTable).where(and(
      eq(ledgerEntriesTable.transferPartyId, party.id),
      eq(ledgerEntriesTable.isTransfer, true),
    )).for("update");
    const candidatePartyIds = [...new Set(possibleCounterEntries
      .map((entry) => entry.partyId)
      .filter((id) => id !== party.id))];
    const counterparties = candidatePartyIds.length
      ? await tx.select().from(partiesTable).where(and(
        eq(partiesTable.businessId, businessId),
        inArray(partiesTable.id, candidatePartyIds),
      )).orderBy(partiesTable.id).for("update")
      : [];
    const counterpartPartyIds = new Set(counterparties.map((counterparty) => counterparty.id));
    const counterEntries = possibleCounterEntries.filter((entry) =>
      entry.partyId !== party.id && counterpartPartyIds.has(entry.partyId),
    );
    const entriesToDelete = [...partyEntries, ...counterEntries];
    const deletedEntryIds = [...new Set(entriesToDelete.map((entry) => entry.id))];
    const billImagePaths = [...new Set(entriesToDelete
      .map((entry) => entry.billImage)
      .filter((path): path is string => typeof path === "string" && path.startsWith("/objects/")))];

    const balanceDeltas = new Map<string, number>();
    for (const entry of counterEntries) {
      const delta = entry.type === "YOU_GAVE" ? Number(entry.amount) : -Number(entry.amount);
      balanceDeltas.set(entry.partyId, (balanceDeltas.get(entry.partyId) ?? 0) + delta);
    }

    if (deletedEntryIds.length) {
      await tx.delete(ledgerEntriesTable).where(inArray(ledgerEntriesTable.id, deletedEntryIds));
      await redactDeletedEntryReceipts(tx, businessId, deletedEntryIds);
    }

    // Remove stale party references from staff scopes and outstanding invites.
    const affectedUsers = await tx.select({
      id: appUsersTable.id,
      adjustmentPartyIds: appUsersTable.adjustmentPartyIds,
    }).from(appUsersTable).where(
      sql`${appUsersTable.adjustmentPartyIds} @> ${JSON.stringify([party.id])}::jsonb`,
    );
    for (const user of affectedUsers) {
      await tx.update(appUsersTable).set({
        adjustmentPartyIds: user.adjustmentPartyIds.filter((id) => id !== party.id),
      }).where(eq(appUsersTable.id, user.id));
    }

    const affectedInvites = await tx.select().from(workerInvitesTable).where(or(
      sql`${workerInvitesTable.partyIds} @> ${JSON.stringify([party.id])}::jsonb`,
      sql`${workerInvitesTable.adjustmentPartyIds} @> ${JSON.stringify([party.id])}::jsonb`,
    ));
    for (const invite of affectedInvites) {
      await tx.update(workerInvitesTable).set({
        partyIds: invite.partyIds.filter((id) => id !== party.id),
        adjustmentPartyIds: invite.adjustmentPartyIds.filter((id) => id !== party.id),
      }).where(eq(workerInvitesTable.id, invite.id));
    }

    for (const counterparty of counterparties) {
      const delta = balanceDeltas.get(counterparty.id);
      if (delta === undefined) continue;
      const balance = fromSignedBalance(toSignedBalance(counterparty) - delta);
      const [latestEntry] = await tx.select({ createdAt: ledgerEntriesTable.createdAt })
        .from(ledgerEntriesTable)
        .where(eq(ledgerEntriesTable.partyId, counterparty.id))
        .orderBy(desc(ledgerEntriesTable.createdAt))
        .limit(1);
      await tx.update(partiesTable).set({
        ...balance,
        lastTransactionAt: latestEntry?.createdAt ?? null,
      }).where(and(
        eq(partiesTable.id, counterparty.id),
        eq(partiesTable.businessId, businessId),
      ));
    }

    await tx.delete(partiesTable).where(and(
      eq(partiesTable.id, party.id),
      eq(partiesTable.businessId, businessId),
    ));

    return {
      id: party.id,
      billImagePaths,
      deletedCounterEntries: counterEntries.map(({ id, partyId }) => ({ id, partyId })),
    };
  });

  if (!deletion) {
    res.status(404).json({ error: "Party not found" });
    return;
  }

  // DB transaction committed — now delete the associated bill photos from
  // object storage.  We do this post-commit so a storage failure cannot leave
  // the database in a partially-deleted state.  Each deletion is attempted
  // independently so a single failure doesn't block the rest.
  if (deletion.billImagePaths.length > 0) {
    const storageService = new ObjectStorageService();
    const results = await Promise.allSettled(
      deletion.billImagePaths.map((p) => storageService.deleteObjectEntity(p)),
    );
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        req.log?.error(
          { err: result.reason, objectPath: deletion.billImagePaths[i] },
          "Failed to delete bill photo from storage during party delete",
        );
      }
    });
  }

  broadcast(businessId, { type: 'party.deleted', payload: { partyId: deletion.id } });
  for (const entry of deletion.deletedCounterEntries) {
    broadcast(businessId, {
      type: "ledger.deleted",
      payload: { partyId: entry.partyId, entryId: entry.id },
    });
  }

  res.json(DeletePartyResponse.parse({ success: true, id: deletion.id }));
});

router.post(
  "/parties/:partyId/reminder",
  async (req, res): Promise<void> => {
    const { businessId } = req as unknown as AuthenticatedRequest;
    const parsed = SendPaymentReminderParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [party] = await db
      .select()
      .from(partiesTable)
      .where(
        and(
          eq(partiesTable.id, parsed.data.partyId),
          eq(partiesTable.businessId, businessId),
        ),
      );

    if (!party) {
      res.status(404).json({ error: "Party not found" });
      return;
    }

    const settings = await getOrCreateBusinessSettings(businessId);
    const amount = Number(party.currentBalance);
    // minimumFractionDigits:0  → whole numbers stay clean (no trailing ".00")
    // maximumFractionDigits:2  → decimal balances are shown exactly (2332.82, not 2333)
    const formattedAmount = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);

    const senderName = settings.storeName || "আমার খাতা";
    const message = `বকেয়া তাগাদা: ${senderName}-এর পক্ষ থেকে ${party.name}-কে ৳${formattedAmount} টাকা বকেয়া পরিশোধের জন্য অনুরোধ করা হচ্ছে।`;

    res.json(
      SendPaymentReminderResponse.parse({
        message,
        partyName: party.name,
        amount,
      }),
    );
  },
);

export default router;
