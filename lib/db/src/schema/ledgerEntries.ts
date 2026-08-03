import {
  pgTable,
  text,
  uuid,
  numeric,
  date,
  timestamp,
  pgEnum,
  boolean,
  type AnyPgColumn,
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
  billImage: text("bill_image"),
  dueDate: date("due_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Cross-customer transfer / adjustment fields
  isTransfer: boolean("is_transfer").notNull().default(false),
  transferPartyId: uuid("transfer_party_id").references(
    () => partiesTable.id,
    { onDelete: "set null" },
  ),
  linkedEntryId: uuid("linked_entry_id").references(
    (): AnyPgColumn => ledgerEntriesTable.id,
    { onDelete: "set null" },
  ),
});

export const insertLedgerEntrySchema = createInsertSchema(
  ledgerEntriesTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;
export type LedgerEntry = typeof ledgerEntriesTable.$inferSelect;
