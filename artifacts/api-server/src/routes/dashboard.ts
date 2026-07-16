import { Router, type IRouter } from "express";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { getDashboardTotals, getOrCreateBusinessSettings } from "../lib/khatabook";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const { businessId } = req as AuthenticatedRequest;
  const [totals, settings] = await Promise.all([
    getDashboardTotals(businessId),
    getOrCreateBusinessSettings(businessId),
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
