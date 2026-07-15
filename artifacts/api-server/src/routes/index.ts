import { Router, type IRouter } from "express";
import healthRouter from "./health";
import partiesRouter from "./parties";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";
import ledgerRouter from "./ledger";

const router: IRouter = Router();

router.use(healthRouter);
router.use(partiesRouter);
router.use(dashboardRouter);
router.use(settingsRouter);
router.use(ledgerRouter);

export default router;
