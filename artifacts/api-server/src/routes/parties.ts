import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, appUsersTable, ledgerEntriesTable, partiesTable, workerPartyAssignmentsTable } from "@workspace/db";
import { broadcast } from "../lib/eventBus";
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
  billImage?: string | null;
  dueDate?: string | null;
};

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
    if (x.amount !== undefined && (typeof x.amount !== "number" || x.amount <= 0)) {
      return { success: false, error: { message: "amount must be a positive number" } };
    }
    if (x.type !== undefined && x.type !== "YOU_GAVE" && x.type !== "YOU_GOT") {
      return { success: false, error: { message: "type must be YOU_GAVE or YOU_GOT" } };
    }
    if (x.billImage !== undefined && x.billImage !== null) {
      if (typeof x.billImage !== "string" || !x.billImage.startsWith("/objects/")) {
        return { success: false, error: { message: "billImage must start with /objects/" } };
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
  const ids = destinationId ? [sourceId, destinationId] : [sourceId];
  if (destinationId && (!user.adjustmentPartyIds.includes(sourceId) ||
      !user.adjustmentPartyIds.includes(destinationId))) return false;
  const assigned = await tx.select({ id: partiesTable.id }).from(workerPartyAssignmentsTable)
    .innerJoin(partiesTable, eq(partiesTable.id, workerPartyAssignmentsTable.partyId))
    .where(and(eq(workerPartyAssignmentsTable.userId, userId),
      eq(partiesTable.businessId, businessId), inArray(partiesTable.id, ids)));
  return assigned.length === ids.length;
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
    const { businessId } = req as unknown as AuthenticatedRequest;
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

    const { type, amount, description, billReference, billImage, dueDate, isTransfer, transferPartyId } = body.data;
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
        res.status(404).json({ error: "Transfer party not found" });
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

      const permitted = await db.transaction(async (tx) => {
        if (role === "staff" && !(await staffCanWrite(tx, userId, businessId, party.id, transferPartyId))) return false;
        // Lock in stable order and use current balances for concurrent transfers.
        const locked = await tx.select().from(partiesTable).where(and(
          eq(partiesTable.businessId, businessId), inArray(partiesTable.id, [party.id, transferPartyId]),
        )).orderBy(partiesTable.id).for("update");
        const source = locked.find((p) => p.id === party.id);
        const destination = locked.find((p) => p.id === transferPartyId);
        if (!source || !destination) return false;
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
        return true;
      });
      if (!permitted) { res.status(403).json({ error: "Adjustment permission is required for both parties" }); return; }

      // Reflect the linked IDs in the in-memory objects (update queries don't
      // return rows without .returning(), so we patch them manually here).
      const primaryEntryFinal = { ...primaryEntry!, linkedEntryId: counterEntry!.id };

      broadcast(businessId, { type: "ledger.created", payload: { partyId: party.id, entryId: primaryEntry!.id } });
      broadcast(businessId, { type: "ledger.created", payload: { partyId: transferPartyId, entryId: counterEntry!.id } });

      res.status(201).json(
        CreateLedgerEntryResponse.parse({
          ...primaryEntryFinal,
          amount: Number(primaryEntryFinal.amount),
        }),
      );
      return;
    }

    // ── NORMAL MODE ───────────────────────────────────────────────────────────
    const entry = await db.transaction(async (tx) => {
    if (role === "staff" && !(await staffCanWrite(tx, userId, businessId, party.id))) return null;
    const [currentParty] = await tx.select().from(partiesTable).where(and(
      eq(partiesTable.id, party.id), eq(partiesTable.businessId, businessId),
    )).for("update").limit(1);
    if (!currentParty) return null;
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
    return saved!;
    });
    if (!entry) { res.status(403).json({ error: "Party access was revoked" }); return; }

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
    const { businessId } = req as unknown as AuthenticatedRequest;
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

    // Build the update set from only the fields provided in the body.
    // Fields omitted by the caller are left untouched in the database.
    const updateSet: Partial<{
      billImage: string | null;
      amount: string;
      type: "YOU_GAVE" | "YOU_GOT";
      description: string;
      dueDate: string | null;
    }> = {};

    if (body.data.billImage !== undefined) updateSet.billImage = body.data.billImage;
    if (body.data.amount    !== undefined) updateSet.amount    = body.data.amount.toFixed(2);
    if (body.data.type      !== undefined) updateSet.type      = body.data.type;
    if (body.data.description !== undefined) updateSet.description = body.data.description;
    if (body.data.dueDate   !== undefined) updateSet.dueDate   = body.data.dueDate || null;

    const [updated] = await db
      .update(ledgerEntriesTable)
      .set(updateSet)
      .where(eq(ledgerEntriesTable.id, params.data.entryId))
      .returning();

    // If billImage was replaced or nulled out, delete the superseded object
    // from storage.  We do this after the DB update so a storage failure cannot
    // leave the database in an inconsistent state.  The deletion is attempted
    // fire-and-forget so a storage error never blocks the PATCH response.
    const billImageReplaced =
      body.data.billImage !== undefined &&          // caller sent billImage
      entry.billImage !== null &&                    // entry previously had a photo
      entry.billImage !== body.data.billImage &&    // the value actually changed
      entry.billImage.startsWith("/objects/");       // it is a managed object path

    if (billImageReplaced) {
      const storageService = new ObjectStorageService();
      storageService.deleteObjectEntity(entry.billImage!).catch((err: unknown) => {
        req.log?.error(
          { err, objectPath: entry.billImage },
          "Failed to delete superseded bill photo from storage during entry patch",
        );
      });
    }

    // If the amount or direction changed we must recompute the party's
    // running balance: reverse the old entry's effect, apply the new one.
    const amountChanged = body.data.amount !== undefined;
    const typeChanged   = body.data.type   !== undefined;

    if (amountChanged || typeChanged) {
      const oldAmount = Number(entry.amount);
      const newAmount = body.data.amount ?? oldAmount;
      const oldType   = entry.type as "YOU_GAVE" | "YOU_GOT";
      const newType   = body.data.type   ?? oldType;

      const currentSigned = toSignedBalance(party);
      const oldDelta = oldType === "YOU_GAVE" ?  oldAmount : -oldAmount;
      const newDelta = newType === "YOU_GAVE" ?  newAmount : -newAmount;
      const nextSigned = currentSigned - oldDelta + newDelta;
      const { currentBalance, balanceType } = fromSignedBalance(nextSigned);

      await db
        .update(partiesTable)
        .set({ currentBalance, balanceType })
        .where(eq(partiesTable.id, params.data.partyId));
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
        // Reverse primary party's balance.
        const primarySigned = toSignedBalance(party);
        const primaryDelta = entry.type === "YOU_GAVE" ? Number(entry.amount) : -Number(entry.amount);
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
        if (linkedEntry && linkedParty) {
          const linkedSigned = toSignedBalance(linkedParty);
          const linkedDelta =
            linkedEntry.type === "YOU_GAVE"
              ? Number(linkedEntry.amount)
              : -Number(linkedEntry.amount);
          const linkedBalance = fromSignedBalance(linkedSigned - linkedDelta);
          await tx
            .update(partiesTable)
            .set(linkedBalance)
            .where(eq(partiesTable.id, linkedPartyId!));

          await tx
            .delete(ledgerEntriesTable)
            .where(eq(ledgerEntriesTable.id, linkedEntryId));
        }
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

      await tx
        .update(partiesTable)
        .set({ currentBalance, balanceType })
        .where(eq(partiesTable.id, partyId));
    });

    // DB transaction committed — delete any attached bill photo from storage.
    // Done post-commit so a storage failure cannot leave the DB inconsistent.
    if (entry.billImage && entry.billImage.startsWith("/objects/")) {
      const storageService = new ObjectStorageService();
      storageService.deleteObjectEntity(entry.billImage).catch((err: unknown) => {
        req.log?.error(
          { err, objectPath: entry.billImage },
          "Failed to delete bill photo from storage during entry delete",
        );
      });
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

  // Collect bill image paths BEFORE deleting entries so we know what to clean
  // up from object storage after the DB transaction succeeds.
  const entriesWithImages = await db
    .select({ billImage: ledgerEntriesTable.billImage })
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.partyId, party.id));

  const billImagePaths = entriesWithImages
    .map((e) => e.billImage)
    .filter((p): p is string => typeof p === "string" && p.startsWith("/objects/"));

  await db.transaction(async (tx) => {
    await tx
      .delete(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.partyId, party.id));

    await tx.delete(partiesTable).where(eq(partiesTable.id, party.id));
  });

  // DB transaction committed — now delete the associated bill photos from
  // object storage.  We do this post-commit so a storage failure cannot leave
  // the database in a partially-deleted state.  Each deletion is attempted
  // independently so a single failure doesn't block the rest.
  if (billImagePaths.length > 0) {
    const storageService = new ObjectStorageService();
    const results = await Promise.allSettled(
      billImagePaths.map((p) => storageService.deleteObjectEntity(p)),
    );
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        req.log?.error(
          { err: result.reason, objectPath: billImagePaths[i] },
          "Failed to delete bill photo from storage during party delete",
        );
      }
    });
  }

  broadcast(businessId, { type: 'party.deleted', payload: { partyId: party.id } });

  res.json(DeletePartyResponse.parse({ success: true, id: party.id }));
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
