import { Router } from "express";
import { isIP } from "node:net";
import rateLimit from "express-rate-limit";
import { and, count, countDistinct, desc, eq, gte, ilike, or, sql, isNotNull } from "drizzle-orm";
import {
  db, appUsersTable, adminOtpConfigTable, userLoginEventsTable,
  userPresenceTable, blockedIpsTable,
} from "@workspace/db";
import { requireAdmin, signAdminToken } from "../middlewares/requireAdmin";
import { ensureSmsReady, getSmsGatewayStatus } from "../services/sms";
import { logger } from "../lib/logger";
import { clientIp, ipPolicy } from "../middlewares/ipBlock";

const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;
if (!username || !password) throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be configured");
const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10,
  standardHeaders: "draft-7", legacyHeaders: false });

router.post("/admin/auth/login", loginLimiter, (req, res) => {
  if (req.body?.username !== username || req.body?.password !== password) {
    res.status(401).json({ error: "Invalid credentials" }); return;
  }
  res.json({ token: signAdminToken(), expiresAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString() });
});
router.use("/admin", requireAdmin as any);

const fiveMinutesAgo = () => new Date(Date.now() - 5 * 60_000);
const registered = () => or(isNotNull(appUsersTable.clerkUserId), isNotNull(appUsersTable.phone));
const active = () => sql<boolean>`EXISTS (
  SELECT 1 FROM user_presence p WHERE p.user_id = ${appUsersTable.id}
  AND p.last_seen_at >= ${fiveMinutesAgo()} AND ${appUsersTable.status} = 'active'
)`;

router.get("/admin/stats", async (_req, res) => {
  try {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
    const week = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
    const [total, online, today, recent, signups, logins] = await Promise.all([
      db.select({ n: count() }).from(appUsersTable).where(registered()),
      db.select({ n: countDistinct(userPresenceTable.userId) }).from(userPresenceTable)
        .innerJoin(appUsersTable, eq(appUsersTable.id, userPresenceTable.userId))
        .where(and(gte(userPresenceTable.lastSeenAt, fiveMinutesAgo()), eq(appUsersTable.status, "active"), registered())),
      db.select({ n: count() }).from(appUsersTable).where(and(registered(), gte(appUsersTable.createdAt,
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))))),
      db.select({ n: count() }).from(appUsersTable).where(and(registered(), gte(appUsersTable.createdAt, week))),
      db.select({ day: sql<string>`to_char(${appUsersTable.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`, n: count() })
        .from(appUsersTable).where(and(registered(), gte(appUsersTable.createdAt, start)))
        .groupBy(sql`to_char(${appUsersTable.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`),
      db.select({ day: sql<string>`to_char(${userLoginEventsTable.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`, n: count() })
        .from(userLoginEventsTable).where(gte(userLoginEventsTable.occurredAt, start))
        .groupBy(sql`to_char(${userLoginEventsTable.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`),
    ]);
    const bySignup = new Map(signups.map((r) => [r.day, Number(r.n)]));
    const byLogin = new Map(logins.map((r) => [r.day, Number(r.n)]));
    const trends = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      return { date, signups: bySignup.get(date) ?? 0, logins: byLogin.get(date) ?? 0 };
    });
    res.json({ totalUsers: Number(total[0]?.n ?? 0), activeUsers: Number(online[0]?.n ?? 0),
      newUsersToday: Number(today[0]?.n ?? 0), newUsersThisWeek: Number(recent[0]?.n ?? 0), trends });
  } catch (err) {
    logger.error({ err }, "admin/stats error");
    res.status(500).json({ error: "Unable to load platform statistics" });
  }
});

function serializeUser(user: typeof appUsersTable.$inferSelect) {
  return {
    id: user.id, name: user.displayName ?? "—", email: user.verifiedEmail,
    phone: user.phone,
    authProvider: user.clerkUserId ? "clerk" : "phone_otp",
    status: user.status,
    createdAt: user.createdAt.toISOString(), lastLogin: user.lastLogin?.toISOString() ?? null,
  };
}

router.get("/admin/users", async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "20"), 10) || 20));
    const where = search ? and(registered(), or(ilike(appUsersTable.displayName, `%${search}%`),
      ilike(appUsersTable.phone, `%${search}%`), ilike(appUsersTable.verifiedEmail, `%${search}%`))) : registered();
    const [items, total] = await Promise.all([
      db.select({ user: appUsersTable, isOnline: active() }).from(appUsersTable).where(where)
        .orderBy(desc(appUsersTable.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ n: count() }).from(appUsersTable).where(where),
    ]);
    res.json({ items: items.map((row) => ({ ...serializeUser(row.user), isOnline: row.isOnline })),
      total: Number(total[0]?.n ?? 0), page, pageSize });
  } catch (err) {
    logger.error({ err }, "admin/users error");
    res.status(500).json({ error: "Unable to load users" });
  }
});

async function userDetail(id: string) {
  const [user] = await db.select({ user: appUsersTable, isOnline: active() })
    .from(appUsersTable).where(eq(appUsersTable.id, id)).limit(1);
  if (!user) return null;
  const logins = await db.select().from(userLoginEventsTable)
    .where(and(eq(userLoginEventsTable.userId, id),
      gte(userLoginEventsTable.occurredAt, new Date(Date.now() - 90 * 24 * 60 * 60_000))))
    .orderBy(desc(userLoginEventsTable.occurredAt)).limit(50);
  return { ...serializeUser(user.user), isOnline: user.isOnline,
    loginHistory: logins.map((row) => ({
      id: row.id, occurredAt: row.occurredAt.toISOString(), ip: row.ip,
      device: row.device, authMethod: row.authMethod, source: row.source,
    })) };
}

router.get("/admin/users/:userId", async (req, res) => {
  try {
    const detail = await userDetail(req.params.userId);
    if (!detail) { res.status(404).json({ error: "User not found" }); return; }
    res.json(detail);
  } catch (err) {
    logger.error({ err }, "admin/user detail error");
    res.status(500).json({ error: "Unable to load user" });
  }
});

router.patch("/admin/users/:userId", async (req, res) => {
  if (req.body?.status !== "active" && req.body?.status !== "suspended") {
    res.status(400).json({ error: "status must be active or suspended" }); return;
  }
  try {
    const [updated] = await db.update(appUsersTable).set({ status: req.body.status })
      .where(eq(appUsersTable.id, req.params.userId)).returning({ id: appUsersTable.id });
    if (!updated) { res.status(404).json({ error: "User not found" }); return; }
    if (req.body.status === "suspended") {
      await db.delete(userPresenceTable).where(eq(userPresenceTable.userId, updated.id));
    }
    res.json(await userDetail(updated.id));
  } catch (err) {
    logger.error({ err }, "admin/user update error");
    res.status(500).json({ error: "Unable to update user" });
  }
});

function validIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^::ffff:/, "");
  return isIP(normalized) ? normalized : null;
}
router.get("/admin/blocked-ips", async (_req, res) => {
  try {
    const rows = await db.select().from(blockedIpsTable).orderBy(desc(blockedIpsTable.createdAt));
    const policy = ipPolicy();
    res.json({ policy: {
      ...policy,
      clientIpAvailable: clientIp(_req) !== null,
      message: policy.configured
        ? "Only verified client IPs may be blocked. Existing history may contain legacy shared-proxy addresses."
        : "Setup required: verify your ingress proxy CIDRs and configure TRUSTED_PROXY_CIDRS, or confirm direct access and set CLIENT_IP_MODE=direct. Until then blocking is disabled and login IPs are unavailable.",
    }, items: rows.map((r) => ({
      ip: r.ip, reason: r.reason, createdAt: r.createdAt.toISOString(),
    })) });
  } catch (err) {
    logger.error({ err }, "admin/blocked-ips error");
    res.status(500).json({ error: "Unable to load blocked IPs" });
  }
});
router.post("/admin/blocked-ips", async (req, res) => {
  if (!ipPolicy().configured || !clientIp(req)) {
    res.status(503).json({ error: "Client IP policy setup required before adding IP blocks. Verify trusted proxy CIDRs or direct access." });
    return;
  }
  const ip = validIp(req.body?.ip);
  if (!ip || (req.body.reason !== undefined && (typeof req.body.reason !== "string" || req.body.reason.length > 500))) {
    res.status(400).json({ error: "Provide a single valid IP and optional reason up to 500 characters" }); return;
  }
  try {
    await db.insert(blockedIpsTable).values({ ip, reason: req.body.reason ?? null }).onConflictDoNothing();
    res.status(201).json({ ip });
  } catch (err) {
    logger.error({ err }, "admin/block IP error");
    res.status(500).json({ error: "Unable to block IP" });
  }
});
router.delete("/admin/blocked-ips/:ip", async (req, res) => {
  const ip = validIp(req.params.ip);
  if (!ip) { res.status(400).json({ error: "Invalid IP address" }); return; }
  try {
    await db.delete(blockedIpsTable).where(eq(blockedIpsTable.ip, ip));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "admin/unblock IP error");
    res.status(500).json({ error: "Unable to unblock IP" });
  }
});

router.get("/admin/otp-config", async (_req, res) => {
  try {
    const [config] = await db.select({ enabled: adminOtpConfigTable.enabled,
      updatedAt: adminOtpConfigTable.updatedAt }).from(adminOtpConfigTable).limit(1);
    const gateway = getSmsGatewayStatus();
    res.json({
      enabled: config?.enabled ?? true,
      provider: gateway.provider,
      apiKeyConfigured: gateway.apiKeyConfigured,
      updatedAt: config?.updatedAt?.toISOString() ?? null,
      connectionError: gateway.configurationError,
    });
  } catch (err) {
    logger.error({ err }, "admin/otp-config error");
    res.status(500).json({ error: "Unable to load OTP configuration" });
  }
});
router.put("/admin/otp-config", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean" ||
      Object.keys(req.body ?? {}).some((key) => key !== "enabled")) {
    res.status(400).json({ error: "Only the enabled setting is accepted. Provider credentials are configured on the backend host." }); return;
  }
  if (req.body.enabled) {
    try {
      await ensureSmsReady();
    } catch {
      const gateway = getSmsGatewayStatus();
      res.status(503).json({
        error: gateway.configurationError ?? "SMS gateway is not ready. OTP settings were not changed.",
      });
      return;
    }
  }
  try {
    const [existing] = await db.select({ id: adminOtpConfigTable.id }).from(adminOtpConfigTable).limit(1);
    if (existing) await db.update(adminOtpConfigTable)
      .set({ enabled: req.body.enabled, updatedAt: new Date() })
      .where(eq(adminOtpConfigTable.id, existing.id));
    else await db.insert(adminOtpConfigTable).values({
      enabled: req.body.enabled, sender: "", updatedAt: new Date(),
    });
    const [config] = await db.select({ enabled: adminOtpConfigTable.enabled,
      updatedAt: adminOtpConfigTable.updatedAt }).from(adminOtpConfigTable).limit(1);
    const gateway = getSmsGatewayStatus();
    res.json({
      enabled: config!.enabled,
      provider: gateway.provider,
      apiKeyConfigured: gateway.apiKeyConfigured,
      updatedAt: config!.updatedAt?.toISOString() ?? null,
      connectionError: gateway.configurationError,
    });
  } catch (err) {
    logger.error({ err }, "admin/otp-config update error");
    res.status(503).json({ error: "Unable to update OTP settings" });
  }
});
export default router;