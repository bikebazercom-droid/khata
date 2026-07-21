import { Router } from "express";
import { db } from "@workspace/db";
import {
  appUsersTable,
  businessesTable,
  partiesTable,
  ledgerEntriesTable,
  adminOtpConfigTable,
  userBusinessesTable,
} from "@workspace/db";
import { eq, ilike, or, count, sum, sql, and, gte, lte, desc } from "drizzle-orm";
import { requireAdmin, signAdminToken } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  throw new Error(
    "ADMIN_USERNAME and ADMIN_PASSWORD environment variables must both be set. " +
    "Set them to strong, unique values before starting the server."
  );
}

const router = Router();

// ── Auth ─────────────────────────────────────────────────────────────────────

router.post("/admin/auth/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "username and password required" });
    return;
  }
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = signAdminToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  res.json({ token, expiresAt });
});

// All routes below require admin JWT.
// IMPORTANT: use path-scoped middleware — router.use(requireAdmin) with no
// path would intercept every request forwarded to this router (including
// /parties, /ledger, etc.) and return 401 before Clerk auth can run.
router.use("/admin", requireAdmin as any);

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get("/admin/stats", async (_req, res) => {
  try {
    const [
      [{ totalUsers }],
      [{ totalBusinesses }],
      [{ totalTransactions }],
      [{ totalVolume }],
    ] = await Promise.all([
      db.select({ totalUsers: count() }).from(appUsersTable),
      db.select({ totalBusinesses: count() }).from(businessesTable),
      db.select({ totalTransactions: count() }).from(ledgerEntriesTable),
      db.select({ totalVolume: sum(ledgerEntriesTable.amount) }).from(ledgerEntriesTable),
    ]);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      [{ newUsersToday }],
      [{ newUsersThisWeek }],
      [{ activeUsersThisMonth }],
    ] = await Promise.all([
      db.select({ newUsersToday: count() }).from(appUsersTable)
        .where(gte(appUsersTable.createdAt, todayStart)),
      db.select({ newUsersThisWeek: count() }).from(appUsersTable)
        .where(gte(appUsersTable.createdAt, weekStart)),
      db.select({ activeUsersThisMonth: count() }).from(appUsersTable)
        .where(gte(appUsersTable.lastLogin, monthStart)),
    ]);

    const sourceRows = await db
      .select({ loginSource: appUsersTable.loginSource, cnt: count() })
      .from(appUsersTable)
      .groupBy(appUsersTable.loginSource);

    const usersByLoginSource: Record<string, number> = {};
    for (const row of sourceRows) {
      usersByLoginSource[row.loginSource ?? "unknown"] = Number(row.cnt);
    }

    const [clerkCount, phoneCount] = await Promise.all([
      db.select({ cnt: count() }).from(appUsersTable)
        .where(sql`${appUsersTable.clerkUserId} IS NOT NULL`),
      db.select({ cnt: count() }).from(appUsersTable)
        .where(sql`${appUsersTable.phone} IS NOT NULL AND ${appUsersTable.clerkUserId} IS NULL`),
    ]);

    res.json({
      totalUsers: Number(totalUsers),
      totalBusinesses: Number(totalBusinesses),
      totalTransactions: Number(totalTransactions),
      totalTransactionVolume: Number(totalVolume ?? 0),
      newUsersToday: Number(newUsersToday),
      newUsersThisWeek: Number(newUsersThisWeek),
      activeUsersThisMonth: Number(activeUsersThisMonth),
      usersByLoginSource,
      usersByAuthProvider: {
        gmail: Number(clerkCount[0].cnt),
        phone_otp: Number(phoneCount[0].cnt),
      },
    });
  } catch (err) {
    logger.error({ err }, "admin/stats error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────

router.get("/admin/users", async (req, res) => {
  try {
    const search = (req.query.search as string) || "";
    const loginSource = req.query.loginSource as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const conditions: any[] = [];
    if (search) {
      conditions.push(or(
        ilike(appUsersTable.displayName, `%${search}%`),
        ilike(appUsersTable.phone, `%${search}%`),
      ));
    }
    if (loginSource) {
      conditions.push(eq(appUsersTable.loginSource, loginSource as any));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [items, [{ total }]] = await Promise.all([
      db.select().from(appUsersTable)
        .where(where)
        .orderBy(desc(appUsersTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(appUsersTable).where(where),
    ]);

    // Count businesses per user
    const userIds = items.map((u) => u.id);
    let bizMap: Record<string, number> = {};
    if (userIds.length > 0) {
      const bizCounts = await db
        .select({ userId: userBusinessesTable.userId, cnt: count() })
        .from(userBusinessesTable)
        .where(sql`${userBusinessesTable.userId} = ANY(${sql.raw(`ARRAY[${userIds.map(() => "?").join(",")}]::uuid[]`)})`
          .mapWith(String))
        // fallback: use a subquery approach
        ;
      // Simpler approach: fetch all user_businesses for these users
      const ubRows = await db
        .select({ userId: userBusinessesTable.userId })
        .from(userBusinessesTable)
        .where(
          userIds.length === 1
            ? eq(userBusinessesTable.userId, userIds[0])
            : sql`${userBusinessesTable.userId} IN (${sql.join(userIds.map(id => sql`${id}::uuid`), sql`, `)})`,
        );
      for (const r of ubRows) {
        bizMap[r.userId] = (bizMap[r.userId] ?? 0) + 1;
      }
    }

    res.json({
      items: items.map((u) => ({
        id: u.id,
        name: u.displayName ?? "—",
        phone: u.phone ?? "—",
        loginSource: u.loginSource ?? "web",
        authProvider: u.clerkUserId ? "gmail" : "phone_otp",
        deviceMeta: u.deviceMeta ?? "—",
        status: u.status ?? "active",
        businessCount: bizMap[u.id] ?? 0,
        createdAt: u.createdAt.toISOString(),
        lastLogin: u.lastLogin?.toISOString() ?? null,
      })),
      total: Number(total),
      page,
      pageSize,
    });
  } catch (err) {
    logger.error({ err }, "admin/users error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const [user] = await db.select().from(appUsersTable)
      .where(eq(appUsersTable.id, userId)).limit(1);

    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const ubRows = await db
      .select({ businessId: userBusinessesTable.businessId })
      .from(userBusinessesTable)
      .where(eq(userBusinessesTable.userId, userId));

    const bizIds = ubRows.map((r) => r.businessId);
    let businesses: any[] = [];

    if (bizIds.length > 0) {
      const bizRows = await db.select().from(businessesTable)
        .where(sql`${businessesTable.id} IN (${sql.join(bizIds.map(id => sql`${id}::uuid`), sql`, `)})`);

      const [partyCounts, ledgerCounts] = await Promise.all([
        db.select({ businessId: partiesTable.businessId, cnt: count() })
          .from(partiesTable)
          .where(sql`${partiesTable.businessId} IN (${sql.join(bizIds.map(id => sql`${id}::uuid`), sql`, `)})`)
          .groupBy(partiesTable.businessId),
        db.select({
            businessId: partiesTable.businessId,
            cnt: count(),
          })
          .from(ledgerEntriesTable)
          .innerJoin(partiesTable, eq(ledgerEntriesTable.partyId, partiesTable.id))
          .where(sql`${partiesTable.businessId} IN (${sql.join(bizIds.map(id => sql`${id}::uuid`), sql`, `)})`)
          .groupBy(partiesTable.businessId),
      ]);

      const partyMap: Record<string, number> = {};
      for (const r of partyCounts) partyMap[r.businessId!] = Number(r.cnt);
      const ledgerMap: Record<string, number> = {};
      for (const r of ledgerCounts) ledgerMap[r.businessId!] = Number(r.cnt);

      businesses = bizRows.map((b) => ({
        id: b.id,
        name: b.name,
        partyCount: partyMap[b.id] ?? 0,
        ledgerCount: ledgerMap[b.id] ?? 0,
        createdAt: b.createdAt.toISOString(),
      }));
    }

    res.json({
      id: user.id,
      name: user.displayName ?? "—",
      phone: user.phone ?? "—",
      loginSource: user.loginSource ?? "web",
      authProvider: user.clerkUserId ? "gmail" : "phone_otp",
      deviceMeta: user.deviceMeta ?? "—",
      status: user.status ?? "active",
      businessCount: businesses.length,
      createdAt: user.createdAt.toISOString(),
      lastLogin: user.lastLogin?.toISOString() ?? null,
      businesses,
    });
  } catch (err) {
    logger.error({ err }, "admin/users/:id error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body as { status?: "active" | "suspended" };
    if (status !== "active" && status !== "suspended") {
      res.status(400).json({ error: "status must be 'active' or 'suspended'" });
      return;
    }
    const [updated] = await db.update(appUsersTable)
      .set({ status })
      .where(eq(appUsersTable.id, userId))
      .returning();
    if (!updated) { res.status(404).json({ error: "User not found" }); return; }
    res.json({
      id: updated.id,
      name: updated.displayName ?? "—",
      phone: updated.phone ?? "—",
      loginSource: updated.loginSource ?? "web",
      authProvider: updated.clerkUserId ? "gmail" : "phone_otp",
      deviceMeta: updated.deviceMeta ?? "—",
      status: updated.status ?? "active",
      businessCount: 0,
      createdAt: updated.createdAt.toISOString(),
      lastLogin: updated.lastLogin?.toISOString() ?? null,
      businesses: [],
    });
  } catch (err) {
    logger.error({ err }, "admin/users PATCH error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Businesses ────────────────────────────────────────────────────────────────

router.get("/admin/businesses", async (req, res) => {
  try {
    const search = (req.query.search as string) || "";
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const where = search ? ilike(businessesTable.name, `%${search}%`) : undefined;

    const [bizRows, [{ total }]] = await Promise.all([
      db.select().from(businessesTable)
        .where(where)
        .orderBy(desc(businessesTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(businessesTable).where(where),
    ]);

    const bizIds = bizRows.map((b) => b.id);
    if (bizIds.length === 0) {
      res.json({ items: [], total: Number(total), page, pageSize });
      return;
    }

    const inClause = sql`${sql.join(bizIds.map(id => sql`${id}::uuid`), sql`, `)}`;

    const [ownerRows, partyCounts, ledgerAgg] = await Promise.all([
      db.select({
          businessId: userBusinessesTable.businessId,
          displayName: appUsersTable.displayName,
          phone: appUsersTable.phone,
        })
        .from(userBusinessesTable)
        .innerJoin(appUsersTable, eq(userBusinessesTable.userId, appUsersTable.id))
        .where(sql`${userBusinessesTable.businessId} IN (${inClause})`),
      db.select({ businessId: partiesTable.businessId, cnt: count() })
        .from(partiesTable)
        .where(sql`${partiesTable.businessId} IN (${inClause})`)
        .groupBy(partiesTable.businessId),
      db.select({
          businessId: partiesTable.businessId,
          cnt: count(),
          vol: sum(ledgerEntriesTable.amount),
        })
        .from(ledgerEntriesTable)
        .innerJoin(partiesTable, eq(ledgerEntriesTable.partyId, partiesTable.id))
        .where(sql`${partiesTable.businessId} IN (${inClause})`)
        .groupBy(partiesTable.businessId),
    ]);

    const ownerMap: Record<string, { name: string; phone: string }> = {};
    for (const r of ownerRows) {
      if (!ownerMap[r.businessId]) {
        ownerMap[r.businessId] = { name: r.displayName ?? "—", phone: r.phone ?? "—" };
      }
    }
    const partyMap: Record<string, number> = {};
    for (const r of partyCounts) partyMap[r.businessId!] = Number(r.cnt);
    const ledgerMap: Record<string, { cnt: number; vol: number }> = {};
    for (const r of ledgerAgg) {
      ledgerMap[r.businessId!] = { cnt: Number(r.cnt), vol: Number(r.vol ?? 0) };
    }

    res.json({
      items: bizRows.map((b) => ({
        id: b.id,
        name: b.name,
        ownerName: ownerMap[b.id]?.name ?? "—",
        ownerPhone: ownerMap[b.id]?.phone ?? "—",
        partyCount: partyMap[b.id] ?? 0,
        ledgerCount: ledgerMap[b.id]?.cnt ?? 0,
        transactionVolume: ledgerMap[b.id]?.vol ?? 0,
        createdAt: b.createdAt.toISOString(),
      })),
      total: Number(total),
      page,
      pageSize,
    });
  } catch (err) {
    logger.error({ err }, "admin/businesses error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Transactions ──────────────────────────────────────────────────────────────

router.get("/admin/transactions", async (req, res) => {
  try {
    const search = (req.query.search as string) || "";
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const conditions: any[] = [];
    if (search) {
      conditions.push(or(
        ilike(partiesTable.name, `%${search}%`),
        ilike(ledgerEntriesTable.description, `%${search}%`),
      ));
    }
    if (startDate) conditions.push(gte(ledgerEntriesTable.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate); end.setHours(23, 59, 59, 999);
      conditions.push(lte(ledgerEntriesTable.createdAt, end));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select({
          id: ledgerEntriesTable.id,
          type: ledgerEntriesTable.type,
          amount: ledgerEntriesTable.amount,
          description: ledgerEntriesTable.description,
          createdAt: ledgerEntriesTable.createdAt,
          partyName: partiesTable.name,
          partyPhone: partiesTable.phone,
          businessName: businessesTable.name,
        })
        .from(ledgerEntriesTable)
        .innerJoin(partiesTable, eq(ledgerEntriesTable.partyId, partiesTable.id))
        .leftJoin(businessesTable, eq(partiesTable.businessId, businessesTable.id))
        .where(where)
        .orderBy(desc(ledgerEntriesTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() })
        .from(ledgerEntriesTable)
        .innerJoin(partiesTable, eq(ledgerEntriesTable.partyId, partiesTable.id))
        .where(where),
    ]);

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        businessName: r.businessName ?? "—",
        partyName: r.partyName,
        partyPhone: r.partyPhone ?? "—",
        type: r.type,
        amount: Number(r.amount),
        description: r.description ?? "—",
        createdAt: r.createdAt.toISOString(),
      })),
      total: Number(total),
      page,
      pageSize,
    });
  } catch (err) {
    logger.error({ err }, "admin/transactions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── OTP Config ────────────────────────────────────────────────────────────────

router.get("/admin/otp-config", async (_req, res) => {
  try {
    const [row] = await db.select().from(adminOtpConfigTable).limit(1);
    if (!row) {
      res.json({ gatewayUrl: "", apiKeyHint: "••••", remainingBalance: 0, updatedAt: null });
      return;
    }
    res.json({
      gatewayUrl: row.gatewayUrl,
      apiKeyHint: row.apiKey.length > 4 ? `••••${row.apiKey.slice(-4)}` : "••••",
      remainingBalance: row.remainingBalance,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error({ err }, "admin/otp-config GET error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/otp-config", async (req, res) => {
  try {
    const { gatewayUrl, apiKey, remainingBalance } = req.body as {
      gatewayUrl?: string; apiKey?: string; remainingBalance?: number;
    };
    if (!gatewayUrl || !apiKey || remainingBalance === undefined) {
      res.status(400).json({ error: "gatewayUrl, apiKey, and remainingBalance are required" });
      return;
    }
    const now = new Date();
    const [existing] = await db.select().from(adminOtpConfigTable).limit(1);
    let row;
    if (existing) {
      [row] = await db.update(adminOtpConfigTable)
        .set({ gatewayUrl, apiKey, remainingBalance, updatedAt: now })
        .where(eq(adminOtpConfigTable.id, existing.id))
        .returning();
    } else {
      [row] = await db.insert(adminOtpConfigTable)
        .values({ gatewayUrl, apiKey, remainingBalance, updatedAt: now })
        .returning();
    }
    res.json({
      gatewayUrl: row.gatewayUrl,
      apiKeyHint: row.apiKey.length > 4 ? `••••${row.apiKey.slice(-4)}` : "••••",
      remainingBalance: row.remainingBalance,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error({ err }, "admin/otp-config PUT error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
