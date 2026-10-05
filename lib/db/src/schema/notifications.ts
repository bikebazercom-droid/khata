import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appUsersTable } from "./appUsers";
import { businessesTable } from "./businesses";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    partyId: uuid("party_id"),
    partyName: text("party_name"),
    entryId: uuid("entry_id"),
    entryCount: integer("entry_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    index("notifications_recipient_business_created_idx").on(
      table.recipientUserId,
      table.businessId,
      table.createdAt,
    ),
  ],
);

export const ownerPushTokensTable = pgTable(
  "owner_push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("owner_push_tokens_token_unique").on(table.token),
    index("owner_push_tokens_user_id_idx").on(table.userId),
  ],
);

export type Notification = typeof notificationsTable.$inferSelect;
export type OwnerPushToken = typeof ownerPushTokensTable.$inferSelect;
