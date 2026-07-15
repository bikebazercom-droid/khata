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

export const partyRoleEnum = pgEnum("party_role", ["CUSTOMER", "SUPPLIER"]);
export const balanceTypeEnum = pgEnum("balance_type", [
  "YOU_WILL_GIVE",
  "YOU_WILL_GET",
]);

export const partiesTable = pgTable("parties", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Optional at the product level (a customer can be added with just a name);
  // stored as an empty string rather than NULL so the column stays simple to
  // query, but the ADD PARTY form and API never require a value here.
  phone: text("phone").notNull().default(""),
  role: partyRoleEnum("role").notNull(),
  currentBalance: numeric("current_balance", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  balanceType: balanceTypeEnum("balance_type").notNull().default("YOU_WILL_GET"),
  dueDate: date("due_date", { mode: "string" }),
  lastTransactionAt: timestamp("last_transaction_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertPartySchema = createInsertSchema(partiesTable).omit({
  id: true,
  currentBalance: true,
  balanceType: true,
  lastTransactionAt: true,
  createdAt: true,
});
export type InsertParty = z.infer<typeof insertPartySchema>;
export type Party = typeof partiesTable.$inferSelect;
