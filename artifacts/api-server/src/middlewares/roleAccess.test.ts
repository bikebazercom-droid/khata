import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AuthenticatedRequest } from "./requireAuth";
import { enforceRoleAccess } from "./roleAccess";

function makeApp(role?: "owner" | "staff", status?: "active" | "suspended") {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const auth = req as unknown as AuthenticatedRequest;
    auth.userId = "role-test-user";
    auth.role = role as "owner" | "staff";
    auth.status = status as "active" | "suspended";
    next();
  });
  app.use(enforceRoleAccess);
  app.use((_req, res) => res.json({ passed: true }));
  return app;
}

describe("central role access policy", () => {
  it("fails closed when auth has no recognized active role", async () => {
    const response = await request(makeApp()).get("/owner/workers");
    expect(response.status).toBe(403);
  });

  it("denies staff settings routes", async () => {
    const response = await request(makeApp("staff", "active")).get("/settings");
    expect(response.status).toBe(403);
  });

  it("rejects bill-image and transfer fields on staff ledger writes", async () => {
    const app = makeApp("staff", "active");
    const withImage = await request(app).post("/parties/party-id/ledger-entries")
      .send({ type: "YOU_GAVE", amount: 10, billImage: "/objects/private" });
    const transfer = await request(app).post("/parties/party-id/ledger-entries")
      .send({ type: "YOU_GAVE", amount: 10, isTransfer: true });
    expect(withImage.status).toBe(403);
    expect(transfer.status).toBe(403);
  });
});