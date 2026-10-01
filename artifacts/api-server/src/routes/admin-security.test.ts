import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, appUsersTable, businessesTable, userBusinessesTable, adminOtpConfigTable,
  blockedIpsTable, userPresenceTable, userLoginEventsTable } from "@workspace/db";
import { signAdminToken } from "../middlewares/requireAdmin";
import { enforceIpBlock, trustedProxyCidrs } from "../middlewares/ipBlock";
import { ensureSmsReady } from "../services/sms";
import adminRouter from "./admin";
import authRouter from "./auth";

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: null }) }));
vi.mock("../services/sms", () => ({
  sendOtpSms: vi.fn(),
  ensureSmsReady: vi.fn(),
  getSmsGatewayStatus: vi.fn(() => ({
    provider: "sms.net.bd", apiKeyConfigured: true,
  })),
}));

describe("admin security and foreground presence", () => {
  const app = express();
  app.use(express.json(), enforceIpBlock, adminRouter, authRouter);
  let businessId: string;
  let userId: string;
  let oldConfig: typeof adminOtpConfigTable.$inferSelect | undefined;
  let createdConfigId: string | undefined;
  const ip = "127.0.0.1";
  const previousDirect = process.env.CLIENT_IP_MODE;
  const previousTrusted = process.env.TRUSTED_PROXY_CIDRS;

  beforeAll(async () => {
    delete process.env.CLIENT_IP_MODE;
    delete process.env.TRUSTED_PROXY_CIDRS;
    await db.delete(blockedIpsTable).where(eq(blockedIpsTable.ip, ip));
    const [existing] = await db.select().from(adminOtpConfigTable).limit(1);
    oldConfig = existing;
    if (!existing) {
      const [created] = await db.insert(adminOtpConfigTable).values({ enabled: true }).returning();
      createdConfigId = created!.id;
    }
    const [business] = await db.insert(businessesTable).values({ name: "Admin security test" }).returning();
    businessId = business!.id;
    const [user] = await db.insert(appUsersTable).values({
      businessId, phone: `+88017${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
    }).returning();
    userId = user!.id;
    await db.insert(userBusinessesTable).values({ businessId, userId });
  });
  afterAll(async () => {
    if (previousDirect === undefined) delete process.env.CLIENT_IP_MODE;
    else process.env.CLIENT_IP_MODE = previousDirect;
    if (previousTrusted === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
    else process.env.TRUSTED_PROXY_CIDRS = previousTrusted;
    await db.delete(blockedIpsTable).where(eq(blockedIpsTable.ip, ip));
    if (oldConfig) await db.update(adminOtpConfigTable).set({ enabled: oldConfig.enabled })
      .where(eq(adminOtpConfigTable.id, oldConfig.id));
    if (createdConfigId) await db.delete(adminOtpConfigTable).where(eq(adminOtpConfigTable.id, createdConfigId));
    if (userId) await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, userId));
    if (userId) await db.delete(appUsersTable).where(eq(appUsersTable.id, userId));
    if (businessId) await db.delete(businessesTable).where(eq(businessesTable.id, businessId));
  });

  it("requires admin JWT, gates IP creation without verified policy and protects personal ledger routes", async () => {
    expect((await request(app).get("/admin/blocked-ips")).status).toBe(401);
    const admin = `Bearer ${signAdminToken()}`;
    const policy = await request(app).get("/admin/blocked-ips").set("Authorization", admin);
    expect(policy.body.policy).toMatchObject({
      configured: false, mode: "setup_required", clientIpAvailable: false,
    });
    expect((await request(app).post("/admin/blocked-ips").set("Authorization", admin)
      .send({ ip, reason: "unsafe shared peer" })).status).toBe(503);
    expect((await request(app).post("/admin/blocked-ips").set("Authorization", admin)
      .set("X-Forwarded-For", "8.8.8.8").send({ ip: "8.8.8.8" })).status).toBe(503);
    expect(await db.select().from(blockedIpsTable).where(eq(blockedIpsTable.ip, ip))).toHaveLength(0);
    expect((await request(app).get("/admin/businesses").set("Authorization", admin)).status).toBe(404);
    expect((await request(app).get("/admin/transactions").set("Authorization", admin)).status).toBe(404);
    const user = await request(app).get(`/admin/users/${userId}`).set("Authorization", admin);
    expect(user.status).toBe(200);
    expect(user.body).not.toHaveProperty("businesses");
    expect(user.body).toHaveProperty("loginHistory");
  });

  it("allows an explicitly verified direct policy but ignores spoofed XFF, blocking sessions and OTP", async () => {
    process.env.CLIENT_IP_MODE = "direct";
    try {
    const token = jwt.sign({ userId, businessId, phone: (await db.select()
      .from(appUsersTable).where(eq(appUsersTable.id, userId)))[0]!.phone, sessionVersion: 0 },
      process.env.SESSION_SECRET!, { expiresIn: "30d" });
    expect((await request(app).post("/auth/presence").set("Authorization", `Bearer ${token}`)).status).toBe(204);
    expect(await db.select().from(userPresenceTable).where(eq(userPresenceTable.userId, userId))).toHaveLength(1);
    const admin = `Bearer ${signAdminToken()}`;
    const stats = await request(app).get("/admin/stats").set("Authorization", admin);
    expect(stats.status).toBe(200);
    expect(stats.body.activeUsers).toBeGreaterThanOrEqual(1);
    expect(stats.body.totalUsers).toBeGreaterThanOrEqual(1);
    expect(stats.body.trends).toHaveLength(30);
    expect(await db.select().from(userLoginEventsTable).where(eq(userLoginEventsTable.userId, userId))).toHaveLength(0);
    expect((await request(app).post("/admin/blocked-ips").set("Authorization", admin)
      .send({ ip: "invalid" })).status).toBe(400);
    expect((await request(app).post("/admin/blocked-ips").set("Authorization", admin)
      .send({ ip, reason: "test" })).status).toBe(201);
    expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)
      .set("X-Forwarded-For", "8.8.8.8")).status).toBe(403);
    expect((await request(app).post("/auth/phone/send-otp").send({ phone: "01712345678" })).status).toBe(403);
    expect((await request(app).post("/auth/phone/verify-otp").send({ phone: "01712345678", code: "123456" })).status).toBe(403);
    await db.delete(blockedIpsTable).where(eq(blockedIpsTable.ip, ip));
    } finally { delete process.env.CLIENT_IP_MODE; }
  });

  it("requires a verified forwarded hop in trusted-proxy mode; never falls back to shared socket", async () => {
    process.env.TRUSTED_PROXY_CIDRS = "127.0.0.1/8";
    try {
      expect(() => trustedProxyCidrs()).not.toThrow();
      const proxied = express();
      proxied.set("trust proxy", trustedProxyCidrs());
      proxied.use(express.json(), enforceIpBlock, adminRouter, authRouter);
      const admin = `Bearer ${signAdminToken()}`;
      // No forwarded client address: policy exists but this request is unresolved.
      const status = await request(proxied).get("/admin/blocked-ips").set("Authorization", admin);
      expect(status.status).toBe(200);
      expect(status.body.policy).toMatchObject({ configured: true, clientIpAvailable: false });
      expect((await request(proxied).post("/admin/blocked-ips").set("Authorization", admin)
        .send({ ip })).status).toBe(503);
      // Verified hop: block the resolved forwarded client, not the proxy peer.
      expect((await request(proxied).post("/admin/blocked-ips").set("Authorization", admin)
        .set("X-Forwarded-For", "203.0.113.25").send({ ip: "203.0.113.25" })).status).toBe(201);
      expect((await request(proxied).post("/auth/phone/send-otp")
        .set("X-Forwarded-For", "203.0.113.25").send({ phone: "01712345678" })).status).toBe(403);
      await db.delete(blockedIpsTable).where(eq(blockedIpsTable.ip, "203.0.113.25"));
    } finally { delete process.env.TRUSTED_PROXY_CIDRS; }
  });

  it("disables BOTH OTP issuance and verification without sending a billable test", async () => {
    const admin = `Bearer ${signAdminToken()}`;
    const leaked = await request(app).get("/admin/otp-config").set("Authorization", admin);
    expect(leaked.status).toBe(200);
    expect(leaked.body).not.toHaveProperty("apiKey");
    expect(leaked.body).not.toHaveProperty("apiKeyHint");
    expect(leaked.body).not.toHaveProperty("remainingBalance");
    expect(leaked.body).toMatchObject({
      provider: "sms.net.bd",
      apiKeyConfigured: true,
    });
    expect(leaked.body).not.toHaveProperty("twilio");
    vi.mocked(ensureSmsReady).mockRejectedValueOnce(new Error("API key missing"));
    expect((await request(app).put("/admin/otp-config").set("Authorization", admin)
      .send({ enabled: true })).status).toBe(503);
    expect((await request(app).put("/admin/otp-config").set("Authorization", admin)
      .send({ enabled: true, sender: "", apiKey: "legacy", remainingBalance: 999 })).status).toBe(400);
    expect((await request(app).put("/admin/otp-config").send({ enabled: false })).status).toBe(401);
    const changed = await request(app).put("/admin/otp-config").set("Authorization", admin)
      .send({ enabled: false });
    expect(changed.status).toBe(200);
    expect((await request(app).post("/auth/phone/send-otp").send({ phone: "01712345678" })).status).toBe(503);
    expect((await request(app).post("/auth/phone/verify-otp").send({ phone: "01712345678", code: "123456" })).status).toBe(503);
  });
});