import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import healthRouter from "./health";
import authRouter from "./auth";
import partiesRouter from "./parties";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";
import ledgerRouter from "./ledger";
import eventsRouter from "./events";
import storageRouter from "./storage";
import staffRouter from "./staff";
import businessesRouter from "./businesses";

const router: IRouter = Router();

// Public routes (no auth required).
router.use(healthRouter);
router.use(authRouter);

// All routes below require a valid session (Clerk or phone OTP).
router.use(requireAuth as any);

// Storage routes — all require auth (upload mints write-capable presigned URLs;
// object serving requires auth so bill images are only accessible to signed-in users).
router.use(storageRouter);
router.use(partiesRouter);
router.use(dashboardRouter);
router.use(settingsRouter);
router.use(ledgerRouter);
router.use(eventsRouter);

// Staff duty deployment — fully isolated from customer ledger.
router.use(staffRouter);
router.use(businessesRouter);

export default router;
