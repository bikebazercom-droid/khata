import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { readinessDb } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const READINESS_RESPONSE_TIMEOUT_MS = 1_000;

function waitForReadinessCheck(check: Promise<void>): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      resolve(false);
    }, READINESS_RESPONSE_TIMEOUT_MS);

    check.then(
      () => {
        if (settled) return;
        clearTimeout(timeout);
        resolve(true);
      },
      () => {
        if (settled) return;
        clearTimeout(timeout);
        resolve(false);
      },
    );
  });
}

export function createHealthRouter(
  runReadinessCheck: () => PromiseLike<unknown> = () =>
    readinessDb.execute(sql`select 1`),
): IRouter {
  const router: IRouter = Router();
  let readinessCheckInFlight: Promise<void> | undefined;

  function startReadinessCheck(): Promise<void> {
    if (!readinessCheckInFlight) {
      const check = Promise.resolve()
        .then(runReadinessCheck)
        .then(() => undefined);
      readinessCheckInFlight = check;
      void check.then(
        () => {
          if (readinessCheckInFlight === check) readinessCheckInFlight = undefined;
        },
        () => {
          if (readinessCheckInFlight === check) readinessCheckInFlight = undefined;
        },
      );
    }
    return readinessCheckInFlight;
  }

  router.get("/healthz", (_req, res) => {
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  });

  router.get("/readyz", async (_req, res) => {
    const ready = await waitForReadinessCheck(startReadinessCheck());
    if (ready) {
      res.json({ status: "ready" });
      return;
    }
    // Keep database and connection details out of this public response.
    res.status(503).json({ status: "not_ready" });
  });

  return router;
}

export default createHealthRouter();
