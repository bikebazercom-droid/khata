import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import healthRouter from "./health";
import authRouter from "./auth";
import partiesRouter from "./parties";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";
import ledgerRouter from "./ledger";
import eventsRouter from "./events";

const router: IRouter = Router();

// Public routes (no auth required).
router.use(healthRouter);
router.use(authRouter);

// All routes below require a valid session (Clerk or phone OTP).
router.use(requireAuth as any);
router.use(partiesRouter);
router.use(dashboardRouter);
router.use(settingsRouter);
router.use(ledgerRouter);
router.use(eventsRouter);

export default router;
