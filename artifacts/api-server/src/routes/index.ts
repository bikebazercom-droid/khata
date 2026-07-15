import { Router, type IRouter } from "express";
import healthRouter from "./health";
import partiesRouter from "./parties";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(partiesRouter);
router.use(dashboardRouter);
router.use(settingsRouter);

export default router;
