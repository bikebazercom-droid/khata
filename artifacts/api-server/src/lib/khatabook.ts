import { and, eq, sql } from "drizzle-orm";
import {
  db,
  businessSettingsTable,
  partiesTable,
  type Party,
} from "@workspace/db";

/**
 * Ensures a single BusinessSettings row exists and returns it.
 */
export async function getOrCreateBusinessSettings() {
  const [existing] = await db.select().from(businessSettingsTable).limit(1);
  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(businessSettingsTable)
    .values({})
    .returning();

  return created;
}

/**
 * A party's balance is tracked as an unsigned amount + a direction
 * (balanceType). This converts that pair into one signed number where
 * positive means "you will get" and negative means "you will give".
 */
export function toSignedBalance(party: Pick<Party, "currentBalance" | "balanceType">): number {
  const magnitude = Number(party.currentBalance);
  return party.balanceType === "YOU_WILL_GIVE" ? -magnitude : magnitude;
}

/**
 * Converts a signed balance back into the unsigned amount + direction pair
 * stored on the party row.
 */
export function fromSignedBalance(signed: number): {
  currentBalance: string;
  balanceType: "YOU_WILL_GIVE" | "YOU_WILL_GET";
} {
  const balanceType = signed < 0 ? "YOU_WILL_GIVE" : "YOU_WILL_GET";
  const currentBalance = Math.abs(signed).toFixed(2);
  return { currentBalance, balanceType };
}

export function toDateOnlyString(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

export async function getDashboardTotals() {
  const [row] = await db
    .select({
      youWillGet: sql<string>`coalesce(sum(case when ${partiesTable.balanceType} = 'YOU_WILL_GET' then ${partiesTable.currentBalance} else 0 end), 0)`,
      youWillGive: sql<string>`coalesce(sum(case when ${partiesTable.balanceType} = 'YOU_WILL_GIVE' then ${partiesTable.currentBalance} else 0 end), 0)`,
      customerCount: sql<string>`coalesce(sum(case when ${partiesTable.role} = 'CUSTOMER' then 1 else 0 end), 0)`,
      supplierCount: sql<string>`coalesce(sum(case when ${partiesTable.role} = 'SUPPLIER' then 1 else 0 end), 0)`,
    })
    .from(partiesTable);

  return {
    youWillGet: Number(row?.youWillGet ?? 0),
    youWillGive: Number(row?.youWillGive ?? 0),
    customerCount: Number(row?.customerCount ?? 0),
    supplierCount: Number(row?.supplierCount ?? 0),
  };
}

export function applyPartyFilters(
  role?: "CUSTOMER" | "SUPPLIER",
  search?: string,
) {
  const conditions = [];
  if (role) {
    conditions.push(eq(partiesTable.role, role));
  }
  if (search) {
    conditions.push(sql`${partiesTable.name} ilike ${"%" + search + "%"}`);
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}
