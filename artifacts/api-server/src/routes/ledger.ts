import { Router, type IRouter } from "express";
import { and, desc, gte, lte, or, sql } from "drizzle-orm";
import { db, ledgerEntriesTable, partiesTable } from "@workspace/db";
import { ListGlobalLedgerEntriesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The orval-generated ListGlobalLedgerEntriesQueryParams schema types
// startDate/endDate as `zod.date()` (no `.coerce`) even though the OpenAPI
// `format: date` param arrives over the wire as a plain "yyyy-MM-dd" query
// string, so it always fails validation. Validate the raw query manually
// instead of using the generated schema.
function parseQuery(query: Record<string, unknown>) {
  const startDate = typeof query["startDate"] === "string" ? query["startDate"] : undefined;
  const endDate = typeof query["endDate"] === "string" ? query["endDate"] : undefined;
  const search = typeof query["search"] === "string" ? query["search"] : undefined;

  if (startDate !== undefined && !DATE_ONLY_PATTERN.test(startDate)) {
    return { error: "startDate must be a yyyy-MM-dd date string" } as const;
  }
  if (endDate !== undefined && !DATE_ONLY_PATTERN.test(endDate)) {
    return { error: "endDate must be a yyyy-MM-dd date string" } as const;
  }

  return { data: { startDate, endDate, search } } as const;
}

// Global ledger feed across every party — powers the standalone Transaction
// Report screen (as opposed to /parties/:partyId/ledger-entries, which is
// scoped to a single customer/supplier).
router.get("/ledger-entries", async (req, res): Promise<void> => {
  const parsed = parseQuery(req.query as Record<string, unknown>);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { startDate, endDate, search } = parsed.data;
  const conditions = [];

  if (startDate) {
    conditions.push(gte(ledgerEntriesTable.createdAt, new Date(`${startDate}T00:00:00.000Z`)));
  }
  if (endDate) {
    conditions.push(lte(ledgerEntriesTable.createdAt, new Date(`${endDate}T23:59:59.999Z`)));
  }
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(
        sql`${partiesTable.name} ilike ${term}`,
        sql`${partiesTable.phone} ilike ${term}`,
        sql`${ledgerEntriesTable.description} ilike ${term}`,
      ),
    );
  }

  const rows = await db
    .select({
      id: ledgerEntriesTable.id,
      partyId: ledgerEntriesTable.partyId,
      partyName: partiesTable.name,
      partyPhone: partiesTable.phone,
      type: ledgerEntriesTable.type,
      amount: ledgerEntriesTable.amount,
      description: ledgerEntriesTable.description,
      billReference: ledgerEntriesTable.billReference,
      billImage: ledgerEntriesTable.billImage,
      dueDate: ledgerEntriesTable.dueDate,
      createdAt: ledgerEntriesTable.createdAt,
    })
    .from(ledgerEntriesTable)
    .innerJoin(partiesTable, sql`${ledgerEntriesTable.partyId} = ${partiesTable.id}`)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ledgerEntriesTable.createdAt));

  res.json(
    ListGlobalLedgerEntriesResponse.parse(
      rows.map((row) => ({
        ...row,
        amount: Number(row.amount),
      })),
    ),
  );
});

export default router;
