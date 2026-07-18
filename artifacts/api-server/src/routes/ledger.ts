import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { db, ledgerEntriesTable, partiesTable } from "@workspace/db";
import { ListGlobalLedgerEntriesResponse } from "@workspace/api-zod";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseQuery(query: Record<string, unknown>) {
  const startDate = typeof query["startDate"] === "string" ? query["startDate"] : undefined;
  const endDate = typeof query["endDate"] === "string" ? query["endDate"] : undefined;
  const search = typeof query["search"] === "string" ? query["search"] : undefined;
  const partyRoleRaw = typeof query["partyRole"] === "string" ? query["partyRole"] : undefined;
  const partyRole = partyRoleRaw === "CUSTOMER" || partyRoleRaw === "SUPPLIER" ? partyRoleRaw : undefined;

  if (startDate !== undefined && !DATE_ONLY_PATTERN.test(startDate)) {
    return { error: "startDate must be a yyyy-MM-dd date string" } as const;
  }
  if (endDate !== undefined && !DATE_ONLY_PATTERN.test(endDate)) {
    return { error: "endDate must be a yyyy-MM-dd date string" } as const;
  }

  return { data: { startDate, endDate, search, partyRole } } as const;
}

router.get("/ledger-entries", async (req, res): Promise<void> => {
  const { businessId } = req as AuthenticatedRequest;
  const parsed = parseQuery(req.query as Record<string, unknown>);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { startDate, endDate, search, partyRole } = parsed.data;
  const conditions = [eq(partiesTable.businessId, businessId)];

  if (partyRole) {
    conditions.push(eq(partiesTable.role, partyRole) as any);
  }
  if (startDate) {
    conditions.push(gte(ledgerEntriesTable.createdAt, new Date(`${startDate}T00:00:00.000Z`)) as any);
  }
  if (endDate) {
    conditions.push(lte(ledgerEntriesTable.createdAt, new Date(`${endDate}T23:59:59.999Z`)) as any);
  }
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(
        sql`${partiesTable.name} ilike ${term}`,
        sql`${partiesTable.phone} ilike ${term}`,
        sql`${ledgerEntriesTable.description} ilike ${term}`,
      ) as any,
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
    .innerJoin(partiesTable, eq(ledgerEntriesTable.partyId, partiesTable.id))
    .where(and(...conditions))
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
