import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { signAdminToken } from "../middlewares/requireAdmin";
import { createApiRouter } from "./index";

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: null }) }));

describe("admin installer status route", () => {
  const app = express();
  app.use("/api", createApiRouter());

  it("accepts an admin JWT before Clerk user-session middleware", async () => {
    const response = await request(app)
      .get("/api/admin/binary-info")
      .set("Authorization", `Bearer ${signAdminToken()}`)
      .expect(200);

    expect(response.body.exe).toMatchObject({ exists: expect.any(Boolean) });
    expect(response.body.mac).toMatchObject({ exists: expect.any(Boolean) });
  });

  it("still rejects requests without an admin JWT", async () => {
    await request(app).get("/api/admin/binary-info").expect(401);
  });
});
