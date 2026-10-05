import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ready" });
  } catch {
    // Keep database and connection details out of this public response.
    res.status(503).json({ status: "not_ready" });
  }
});

export default router;
