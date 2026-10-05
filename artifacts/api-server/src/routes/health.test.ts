import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: executeMock },
}));

import healthRouter from "./health";

const app = express();
app.use("/api", healthRouter);

describe("API health routes", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue(undefined);
  });

  it("keeps liveness independent of database availability", async () => {
    executeMock.mockRejectedValueOnce(new Error("database unavailable"));

    await request(app)
      .get("/api/healthz")
      .expect(200, { status: "ok" });

    expect(executeMock).not.toHaveBeenCalled();
  });

  it("reports readiness when the database query succeeds", async () => {
    await request(app)
      .get("/api/readyz")
      .expect(200, { status: "ready" });

    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("returns a generic 503 without leaking database errors", async () => {
    const sensitiveError = "postgres://user:password@db.example/private";
    executeMock.mockRejectedValueOnce(new Error(sensitiveError));

    const response = await request(app)
      .get("/api/readyz")
      .expect(503, { status: "not_ready" });

    expect(JSON.stringify(response.body)).not.toContain(sensitiveError);
  });
});
