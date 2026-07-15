import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, ledgerEntriesTable, partiesTable } from "@workspace/db";
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
} from "@workspace/api-zod";
import {
  applyPartyFilters,
  fromSignedBalance,
  getOrCreateBusinessSettings,
  toDateOnlyString,
  toSignedBalance,
} from "../lib/khatabook";

const router: IRouter = Router();

router.get("/parties", async (req, res): Promise<void> => {
  const parsed = ListPartiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { role, search, dueFilter } = parsed.data;
  const condition = applyPartyFilters(role, search);

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
      name,
      phone,
      role,
      currentBalance,
      balanceType,
      dueDate: toDateOnlyString(dueDate ?? null),
      lastTransactionAt: signedOpening !== 0 ? new Date() : null,
    })
    .returning();

  res.status(201).json(
    CreatePartyResponse.parse({
      ...party,
      currentBalance: Number(party!.currentBalance),
    }),
  );
});

router.get("/parties/:partyId", async (req, res): Promise<void> => {
  const parsed = GetPartyParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [party] = await db
    .select()
    .from(partiesTable)
    .where(eq(partiesTable.id, parsed.data.partyId));

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
    const parsed = ListLedgerEntriesParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [party] = await db
      .select({ id: partiesTable.id })
      .from(partiesTable)
      .where(eq(partiesTable.id, parsed.data.partyId));

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
      .where(eq(partiesTable.id, params.data.partyId));

    if (!party) {
      res.status(404).json({ error: "Party not found" });
      return;
    }

    const { type, amount, description, billReference, dueDate } = body.data;

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

    res.status(201).json(
      CreateLedgerEntryResponse.parse({
        ...entry,
        amount: Number(entry!.amount),
      }),
    );
  },
);

router.post(
  "/parties/:partyId/reminder",
  async (req, res): Promise<void> => {
    const parsed = SendPaymentReminderParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [party] = await db
      .select()
      .from(partiesTable)
      .where(eq(partiesTable.id, parsed.data.partyId));

    if (!party) {
      res.status(404).json({ error: "Party not found" });
      return;
    }

    await getOrCreateBusinessSettings();
    const amount = Number(party.currentBalance);
    const formattedAmount = new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: 0,
    }).format(amount);

    const message = `বকেয়া তাগাদা: হাজারী খাতাবুক-এর পক্ষ থেকে ${party.name}-কে ৳${formattedAmount} টাকা বকেয়া পরিশোধের জন্য অনুরোধ করা হচ্ছে।`;

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
