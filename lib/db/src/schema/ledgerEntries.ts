import {
  pgTable,
  text,
  uuid,
  numeric,
  date,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partiesTable } from "./parties";

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "YOU_GAVE",
  "YOU_GOT",
]);

export const ledgerEntriesTable = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  partyId: uuid("party_id")
    .notNull()
    .references(() => partiesTable.id, { onDelete: "cascade" }),
  type: ledgerEntryTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description").notNull().default(""),
  billReference: text("bill_reference"),
  dueDate: date("due_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertLedgerEntrySchema = createInsertSchema(
  ledgerEntriesTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;
export type LedgerEntry = typeof ledgerEntriesTable.$inferSelect;
