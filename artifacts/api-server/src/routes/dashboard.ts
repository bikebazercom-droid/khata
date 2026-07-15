import { Router, type IRouter } from "express";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { getDashboardTotals, getOrCreateBusinessSettings } from "../lib/khatabook";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [totals, settings] = await Promise.all([
    getDashboardTotals(),
    getOrCreateBusinessSettings(),
  ]);

  res.json(
    GetDashboardSummaryResponse.parse({
      youWillGet: totals.youWillGet,
      youWillGive: totals.youWillGive,
      onlineCollectionBalance: Number(settings.onlineCollectionBalance),
      customerCount: totals.customerCount,
      supplierCount: totals.supplierCount,
    }),
  );
});

export default router;
