import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import healthRouter from "./health";
import authRouter from "./auth";
import partiesRouter from "./parties";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";
import ledgerRouter from "./ledger";
import eventsRouter from "./events";
import storageRouter, { localUploadRouter } from "./storage";
import staffRouter from "./staff";
import businessesRouter from "./businesses";
import userRouter from "./user";
import adminRouter from "./admin";
import uploadsRouter from "./uploadBinary";
import downloadsRouter from "./downloads";
import downloadConfigsRouter from "./downloadConfigs";
import scanRouter from "./scan";
import ownerRouter from "./owner";
import notificationsRouter from "./notifications";
import { enforceRoleAccess } from "../middlewares/roleAccess";
import { enforceIpBlock } from "../middlewares/ipBlock";

export function createApiRouter(
  publicHealthRouter: IRouter = healthRouter,
): IRouter {
  const router: IRouter = Router();

  // Public routes (no auth required).
  router.use(publicHealthRouter);
  // Keep health checks independent of DB availability. All authentication,
  // authenticated API, admin and OTP paths pass through the persisted blocklist.
  router.use(enforceIpBlock);
  router.use(authRouter);
  router.use(downloadsRouter);
  router.use(downloadConfigsRouter);
  // Direct local-disk uploads use a short-lived signed capability URL, just like
  // the GCS presigned PUT. Mount before session auth so clients need no header.
  router.use(localUploadRouter);

  // Admin routes — use their own JWT auth (adminBearer), not Clerk.
  router.use(adminRouter);

  // All routes below require a valid session (Clerk or phone OTP).
  router.use(requireAuth as any);
  router.use(enforceRoleAccess);
  router.use(uploadsRouter);

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
  router.use(userRouter);
  router.use(scanRouter);
  router.use(ownerRouter);
  router.use(notificationsRouter);

  return router;
}

export default createApiRouter();
