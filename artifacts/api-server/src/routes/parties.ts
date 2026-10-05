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
  ListLedgerEntriesParams,
  ListLedgerEntriesResponse,
  CreateLedgerEntryParams,
  CreateLedgerEntryBody,
  CreateLedgerEntryResponse,
  SendPaymentReminderParams,
  SendPaymentReminderResponse,
  DeletePartyParams,
  DeletePartyResponse,
} from "@workspace/api-zod";
// Inline validators for the PATCH ledger-entry route (not in OpenAPI spec).
type PatchLedgerEntryParamsData = { partyId: string; entryId: string };
type PatchLedgerEntryBodyData = {
  amount?: number;
  type?: "YOU_GAVE" | "YOU_GOT";
  description?: string;
  billReference?: string | null;
  billImage?: string | null;
  entryDate?: string | null;
  dueDate?: string | null;
};

function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const PatchLedgerEntryParams = {
  safeParse(v: unknown): { success: true; data: PatchLedgerEntryParamsData } | { success: false; error: { message: string } } {
    const x = v as Record<string, unknown>;
    if (typeof x?.partyId === "string" && typeof x?.entryId === "string") {
      return { success: true, data: { partyId: x.partyId, entryId: x.entryId } };
    }
    return { success: false, error: { message: "partyId and entryId must be strings" } };
  },
};

const PatchLedgerEntryBody = {
  safeParse(v: unknown): { success: true; data: PatchLedgerEntryBodyData } | { success: false; error: { message: string } } {
    const x = v as Record<string, unknown>;
    if (typeof x !== "object" || x === null) return { success: false, error: { message: "body must be an object" } };
    const allowed = new Set(["amount", "type", "description", "billReference", "billImage", "entryDate", "dueDate"]);
    if (Object.keys(x).some((key) => !allowed.has(key))) {
      return { success: false, error: { message: "body contains an unsupported field" } };
    }
    if (x.amount !== undefined && (typeof x.amount !== "number" || !Number.isFinite(x.amount) || x.amount <= 0)) {
      return { success: false, error: { message: "amount must be a positive number" } };
    }
    if (x.type !== undefined && x.type !== "YOU_GAVE" && x.type !== "YOU_GOT") {
      return { success: false, error: { message: "type must be YOU_GAVE or YOU_GOT" } };
    }
    if (x.description !== undefined && typeof x.description !== "string") {
      return { success: false, error: { message: "description must be a string" } };
    }
    if (x.billReference !== undefined && x.billReference !== null && typeof x.billReference !== "string") {
      return { success: false, error: { message: "billReference must be a string or null" } };
    }
    if (x.billImage !== undefined && x.billImage !== null) {
      if (typeof x.billImage !== "string" || !x.billImage.startsWith("/objects/")) {
        return { success: false, error: { message: "billImage must start with /objects/" } };
      }
    }
    for (const field of ["entryDate", "dueDate"] as const) {
      if (x[field] !== undefined && x[field] !== null && !isValidDateOnly(x[field])) {
        return { success: false, error: { message: `${field} must be a valid ISO date` } };
      }
    }
    return { success: true, data: x as PatchLedgerEntryBodyData };
  },
};

const PatchLedgerEntryResponse = {
  parse(v: unknown) { return v; },
};

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
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, phone, role, openingBalance, openingBalanceType, dueDate } =
    parsed.data;

  const signedOpening =
    openingBalance && openingBalance > 0
      ? openingBalanceType === "YOU_WILL_GIVE"
        ? -openingBalance
        : openingBalance
      : 0;
  const { currentBalance, balanceType } = fromSignedBalance(signedOpening);

  const [party] = await db
    .insert(partiesTable)
    .values({
      businessId,
      name,
      phone: phone || "",
      role,
      currentBalance,
      balanceType,
      dueDate: toDateOnlyString(dueDate ?? null),
      lastTransactionAt: signedOpening !== 0 ? new Date() : null,
    })
    .returning();

  broadcast(businessId, { type: 'party.created', payload: { partyId: party!.id } });

  res.status(201).json(
    CreatePartyResponse.parse({
      ...party,
      currentBalance: Number(party!.currentBalance),
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
      res.status(400).json({ error: body.error.message });
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
      res.status(400).json({ error: body.error.message });
      return;
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

    // A transfer's two ledger rows must change together. Never update only one
    // amount/direction or its counterparty balance would diverge permanently.
    if (entry.isTransfer && (
      body.data.amount !== undefined ||
      body.data.type !== undefined ||
      body.data.entryDate !== undefined
    )) {
      const updatedPair = await db.transaction(async (tx) => {
        if (!entry.transferPartyId || !entry.linkedEntryId) return null;
        if (!(await actorCanWrite(tx, role, userId, businessId, party.id, entry.transferPartyId))) {
          return { denied: true } as const;
        }
        const locked = await tx.select().from(partiesTable).where(and(
          eq(partiesTable.businessId, businessId),
          inArray(partiesTable.id, [party.id, entry.transferPartyId]),
        )).orderBy(partiesTable.id).for("update");
        if (locked.length !== 2) return null;
        const [current] = await tx.select().from(ledgerEntriesTable)
          .where(and(eq(ledgerEntriesTable.id, entry.id), eq(ledgerEntriesTable.partyId, party.id)))
          .for("update").limit(1);
        const [counter] = await tx.select().from(ledgerEntriesTable)
          .where(and(eq(ledgerEntriesTable.id, entry.linkedEntryId), eq(ledgerEntriesTable.partyId, entry.transferPartyId)))
          .for("update").limit(1);
        if (!current || !counter || !current.isTransfer || !counter.isTransfer ||
            current.linkedEntryId !== counter.id || counter.linkedEntryId !== current.id) return null;
        const amount = body.data.amount ?? Number(current.amount);
        const type = body.data.type ?? current.type;
        const counterType = type === "YOU_GAVE" ? "YOU_GOT" : "YOU_GAVE";
        const changed = {
          ...(body.data.amount !== undefined ? { amount: amount.toFixed(2) } : {}),
          ...(body.data.type !== undefined ? { type } : {}),
          ...(body.data.description !== undefined ? { description: body.data.description } : {}),
          ...(body.data.billReference !== undefined ? { billReference: body.data.billReference || null } : {}),
          ...(body.data.billImage !== undefined ? { billImage: body.data.billImage } : {}),
          ...(body.data.entryDate ? { createdAt: new Date(`${body.data.entryDate}T00:00:00.000Z`) } : {}),
          ...(body.data.dueDate !== undefined ? { dueDate: body.data.dueDate || null } : {}),
        };
        const [saved] = await tx.update(ledgerEntriesTable).set(changed)
          .where(eq(ledgerEntriesTable.id, current.id)).returning();
        await tx.update(ledgerEntriesTable).set({
          amount: amount.toFixed(2),
          type: counterType,
          ...(body.data.entryDate ? { createdAt: new Date(`${body.data.entryDate}T00:00:00.000Z`) } : {}),
        })
          .where(eq(ledgerEntriesTable.id, counter.id));
        for (const row of locked) {
          const oldEntry = row.id === party.id ? current : counter;
          const nextType = row.id === party.id ? type : counterType;
          const previousDelta = oldEntry.type === "YOU_GAVE" ? Number(oldEntry.amount) : -Number(oldEntry.amount);
          const nextDelta = nextType === "YOU_GAVE" ? amount : -amount;
          await tx.update(partiesTable).set(fromSignedBalance(
            toSignedBalance(row) - previousDelta + nextDelta,
          )).where(eq(partiesTable.id, row.id));
        }
        return { saved: saved!, counterId: counter.id, counterPartyId: counter.partyId,
          oldBillImage: current.billImage };
      });
      if (!updatedPair) { res.status(409).json({ error: "Linked adjustment is unavailable" }); return; }
      if ("denied" in updatedPair) { res.status(403).json({ error: "Adjustment access was revoked" }); return; }
      if (body.data.billImage !== undefined && updatedPair.oldBillImage &&
          updatedPair.oldBillImage !== body.data.billImage && updatedPair.oldBillImage.startsWith("/objects/")) {
        new ObjectStorageService().deleteObjectEntity(updatedPair.oldBillImage).catch((err: unknown) =>
          req.log?.error({ err }, "Failed to delete replaced adjustment bill photo"));
      }
      broadcast(businessId, { type: "ledger.updated", payload: { partyId: party.id, entryId: entry.id } });
      broadcast(businessId, { type: "ledger.updated",
        payload: { partyId: updatedPair.counterPartyId, entryId: updatedPair.counterId } });
      res.json(PatchLedgerEntryResponse.parse({ ...updatedPair.saved, amount: Number(updatedPair.saved.amount) }));
      return;
    }

    // Build the update set from only the fields provided in the body.
    // Fields omitted by the caller are left untouched in the database.
    const updateSet: Partial<{
      billImage: string | null;
      billReference: string | null;
      createdAt: Date;
      amount: string;
      type: "YOU_GAVE" | "YOU_GOT";
      description: string;
      dueDate: string | null;
    }> = {};

    if (body.data.billImage !== undefined) updateSet.billImage = body.data.billImage;
    if (body.data.billReference !== undefined) updateSet.billReference = body.data.billReference;
    if (body.data.amount    !== undefined) updateSet.amount    = body.data.amount.toFixed(2);
    if (body.data.type      !== undefined) updateSet.type      = body.data.type;
    if (body.data.description !== undefined) updateSet.description = body.data.description;
    if (body.data.dueDate   !== undefined) updateSet.dueDate   = body.data.dueDate || null;
    if (body.data.entryDate) updateSet.createdAt = new Date(`${body.data.entryDate}T00:00:00.000Z`);

    const mutation = await db.transaction(async (tx) => {
      if (!(await actorCanWrite(tx, role, userId, businessId, party.id))) {
        return { status: "denied" } as const;
      }

      const [currentParty] = await tx.select().from(partiesTable).where(and(
        eq(partiesTable.id, party.id),
        eq(partiesTable.businessId, businessId),
      )).for("update").limit(1);
      const [currentEntry] = await tx.select().from(ledgerEntriesTable).where(and(
        eq(ledgerEntriesTable.id, params.data.entryId),
        eq(ledgerEntriesTable.partyId, party.id),
      )).for("update").limit(1);
      if (!currentParty || !currentEntry) return { status: "missing" } as const;

      const [saved] = await tx.update(ledgerEntriesTable)
        .set(updateSet)
        .where(and(
          eq(ledgerEntriesTable.id, params.data.entryId),
          eq(ledgerEntriesTable.partyId, party.id),
        ))
        .returning();
      if (!saved) return { status: "missing" } as const;

      if (body.data.amount !== undefined || body.data.type !== undefined) {
        const oldAmount = Number(currentEntry.amount);
        const newAmount = body.data.amount ?? oldAmount;
        const oldType = currentEntry.type as "YOU_GAVE" | "YOU_GOT";
        const newType = body.data.type ?? oldType;
        const oldDelta = oldType === "YOU_GAVE" ? oldAmount : -oldAmount;
        const newDelta = newType === "YOU_GAVE" ? newAmount : -newAmount;
        const nextSigned = toSignedBalance(currentParty) - oldDelta + newDelta;
        await tx.update(partiesTable)
          .set(fromSignedBalance(nextSigned))
          .where(eq(partiesTable.id, party.id));
      }

      return { status: "updated", updated: saved, oldBillImage: currentEntry.billImage } as const;
    });
    if (mutation.status === "denied") {
      res.status(403).json({ error: "Party access was revoked" });
      return;
    }
    if (mutation.status === "missing") {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    const updated = mutation.updated;

    // If billImage was replaced or nulled out, delete the superseded object
    // from storage.  We do this after the DB update so a storage failure cannot
    // leave the database in an inconsistent state.  The deletion is attempted
    // fire-and-forget so a storage error never blocks the PATCH response.
    const billImageReplaced =
      body.data.billImage !== undefined &&          // caller sent billImage
      mutation.oldBillImage !== null &&              // entry previously had a photo
      mutation.oldBillImage !== body.data.billImage && // the value actually changed
      mutation.oldBillImage.startsWith("/objects/"); // it is a managed object path

    if (billImageReplaced) {
      const storageService = new ObjectStorageService();
      storageService.deleteObjectEntity(mutation.oldBillImage!).catch((err: unknown) => {
        req.log?.error(
          { err, objectPath: mutation.oldBillImage },
          "Failed to delete superseded bill photo from storage during entry patch",
        );
      });
    }

    broadcast(businessId, {
      type: "ledger.updated",
      payload: { partyId: params.data.partyId, entryId: params.data.entryId },
    });

    res.json(
      PatchLedgerEntryResponse.parse({
        ...updated,
        amount: Number(updated!.amount),
      }),
    );
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
