import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const staffDestinationsTable = pgTable('staff_destinations', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: text('business_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
