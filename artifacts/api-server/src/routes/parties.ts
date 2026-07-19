import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, ledgerEntriesTable, partiesTable } from "@workspace/db";
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
  PatchLedgerEntryParams,
  PatchLedgerEntryBody,
  PatchLedgerEntryResponse,
  SendPaymentReminderParams,
  SendPaymentReminderResponse,
  DeletePartyParams,
  DeletePartyResponse,
} from "@workspace/api-zod";
import {
  applyPartyFilters,
  fromSignedBalance,
  getOrCreateBusinessSettings,
  toDateOnlyString,
  toSignedBalance,
} from "../lib/khatabook";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/parties", async (req, res): Promise<void> => {
  const { businessId } = req as unknown as AuthenticatedRequest;
  const parsed = ListPartiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { role, search, dueFilter } = parsed.data;
  const condition = applyPartyFilters(businessId, role, search);

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
    const { businessId } = req as unknown as AuthenticatedRequest;
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

    const { type, amount, description, billReference, billImage, dueDate } = body.data;

    const currentSigned = toSignedBalance(party);
    const delta = type === "YOU_GAVE" ? amount : -amount;
    const nextSigned = currentSigned + delta;
    const { currentBalance, balanceType } = fromSignedBalance(nextSigned);

    const now = new Date();

    const [entry] = await db
      .insert(ledgerEntriesTable)
      .values({
        partyId: party.id,
        type,
        amount: amount.toFixed(2),
        description: description ?? "",
        billReference: billReference ?? null,
        billImage: billImage ?? null,
        dueDate: toDateOnlyString(dueDate ?? null),
      })
      .returning();

    await db
      .update(partiesTable)
      .set({
        currentBalance,
        balanceType,
        lastTransactionAt: now,
        ...(dueDate ? { dueDate: toDateOnlyString(dueDate) } : {}),
      })
      .where(eq(partiesTable.id, party.id));

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

    // Reverse this entry's effect on the running balance.
    // YOU_GAVE originally added +amount; YOU_GOT added -amount.
    const currentSigned = toSignedBalance(party);
    const delta = entry.type === "YOU_GAVE" ? Number(entry.amount) : -Number(entry.amount);
    const nextSigned = currentSigned - delta;
    const { currentBalance, balanceType } = fromSignedBalance(nextSigned);

    await db
      .delete(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.id, entryId));

    await db
      .update(partiesTable)
      .set({ currentBalance, balanceType })
      .where(eq(partiesTable.id, partyId));

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

  await db
    .delete(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.partyId, party.id));

  await db.delete(partiesTable).where(eq(partiesTable.id, party.id));

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

    const senderName = settings.storeName || "আমার ব্যবসা";
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
