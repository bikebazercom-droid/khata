import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mountFrontendHosting } from "./frontend-hosting";

let tempRoot: string;
let websiteDir: string;
let adminDir: string;

function createFrontendFiles() {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), "banglakhata-frontends-"));
  websiteDir = path.join(tempRoot, "website");
  adminDir = path.join(tempRoot, "admin");

  mkdirSync(path.join(websiteDir, "assets"), { recursive: true });
  mkdirSync(path.join(adminDir, "assets"), { recursive: true });

  writeFileSync(path.join(websiteDir, "index.html"), "<html>shop website</html>");
  writeFileSync(path.join(websiteDir, "assets", "app.js"), "window.site = 'shop';");
  writeFileSync(path.join(adminDir, "index.html"), "<html>admin panel</html>");
  writeFileSync(path.join(adminDir, "assets", "app.js"), "window.site = 'admin';");
}

function makeApp() {
  const app = express();
  app.get("/api/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found" }));
  mountFrontendHosting(app, {
    websiteDir,
    adminDir,
    reservedPrefixes: ["/__clerk"],
  });
  return app;
}

describe("combined Hostinger frontend hosting", () => {
  beforeEach(createFrontendFiles);
  afterEach(() => rmSync(tempRoot, { recursive: true, force: true }));

  it("serves the public website and admin panel at their base paths", async () => {
    const app = makeApp();

    const website = await request(app).get("/").expect(200);
    const admin = await request(app).get("/admin/").expect(200);

    expect(website.text).toContain("shop website");
    expect(admin.text).toContain("admin panel");
  });

  it("serves each frontend's assets from its own URL prefix", async () => {
    const app = makeApp();

    const websiteAsset = await request(app).get("/assets/app.js").expect(200);
    const adminAsset = await request(app).get("/admin/assets/app.js").expect(200);

    expect(websiteAsset.text).toContain("'shop'");
    expect(adminAsset.text).toContain("'admin'");
  });

  it("returns the correct app shell for deep links", async () => {
    const app = makeApp();

    const websiteRoute = await request(app).get("/party/party-123").expect(200);
    const adminRoute = await request(app).get("/admin/users/user-123").expect(200);
    const adminDashboard = await request(app).get("/admin/dashboard").expect(200);

    expect(websiteRoute.text).toContain("shop website");
    expect(adminRoute.text).toContain("admin panel");
    expect(adminDashboard.text).toContain("admin panel");
  });

  it("does not turn missing assets or API routes into HTML", async () => {
    const app = makeApp();

    await request(app).get("/assets/missing.js").expect(404);
    const api = await request(app).get("/api/not-found").expect(404);
    const clerkProxy = await request(app).get("/__clerk/not-found").expect(404);

    expect(api.body).toEqual({ error: "API route not found" });
    expect(clerkProxy.text).not.toContain("shop website");
  });

  it("fails clearly when the static builds are missing", () => {
    expect(() =>
      mountFrontendHosting(express(), {
        websiteDir: path.join(tempRoot, "missing-website"),
        adminDir: path.join(tempRoot, "missing-admin"),
      }),
    ).toThrow(/pnpm run build:hostinger/);
  });
});