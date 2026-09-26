import { pgTable, uuid, text, timestamp, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

// Deliberately no FK to the ledger entry: deletion must not erase the receipt,
// or a delayed offline retry could recreate an already-deleted transaction.
export const ledgerRequestReceiptsTable = pgTable("ledger_request_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businessesTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  clientRequestId: uuid("client_request_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  sourceEntry: jsonb("source_entry").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ledger_request_actor_business_unique").on(table.businessId, table.actorId, table.clientRequestId),
]);