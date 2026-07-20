/**
 * /api/admin/isolated/... — thin alias routes that mirror the main admin
 * endpoints. Intended for isolated testing without touching the main route tree.
 * Auth requirement is identical: adminBearer JWT.
 */
import { Router } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  db,
  appUsersTable,
  businessesTable,
  ledgerEntriesTable,
  adminOtpConfigTable,
} from "@workspace/db";
import { count, sum } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAdmin as any);

router.get("/api/admin/isolated/stats", async (_req, res) => {
  try {
    const [[{ totalUsers }], [{ totalBusinesses }], [{ totalTx }], [{ vol }]] =
      await Promise.all([
        db.select({ totalUsers: count() }).from(appUsersTable),
        db.select({ totalBusinesses: count() }).from(businessesTable),
        db.select({ totalTx: count() }).from(ledgerEntriesTable),
        db.select({ vol: sum(ledgerEntriesTable.amount) }).from(ledgerEntriesTable),
      ]);

    const sourceRows = await db
      .select({ loginSource: appUsersTable.loginSource, cnt: count() })
      .from(appUsersTable)
      .groupBy(appUsersTable.loginSource);

    const usersByLoginSource: Record<string, number> = {};
    for (const r of sourceRows) usersByLoginSource[r.loginSource ?? "unknown"] = Number(r.cnt);

    res.json({
      totalUsers: Number(totalUsers),
      totalBusinesses: Number(totalBusinesses),
      totalTransactions: Number(totalTx),
      totalTransactionVolume: Number(vol ?? 0),
      usersByLoginSource,
    });
  } catch (err) {
    logger.error({ err }, "isolated/stats error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/admin/isolated/otp-balance", async (_req, res) => {
  try {
    const [row] = await db.select().from(adminOtpConfigTable).limit(1);
    res.json({ remainingBalance: row?.remainingBalance ?? 0 });
  } catch (err) {
    logger.error({ err }, "isolated/otp-balance error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
