import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { ensureDefaultBusiness } from "./middlewares/requireAuth";
import { migrateBillImages } from "./lib/migrateBillImages";
import { mountFrontendHosting } from "./lib/frontend-hosting";
import { trustedProxyCidrs } from "./middlewares/ipBlock";
import { isDatabaseNumericOverflow } from "./lib/apiValidation";

const app: Express = express();
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
if (
  process.env.OBJECT_STORAGE_DRIVER === 'local' &&
  process.env.NODE_ENV === 'production' &&
  corsAllowedOrigins.length === 0
) {
  throw new Error('CORS_ALLOWED_ORIGINS is required for production local-storage deployments');
}

// Only accept forwarding headers from explicitly configured proxy CIDRs.
// Without configuration, req.ip is the socket peer (not the spoofable XFF).
const trustedProxies = trustedProxyCidrs();
app.set("trust proxy", trustedProxies.length ? trustedProxies : false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy must come before body parsers — it streams raw bytes.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({
  credentials: true,
  origin: corsAllowedOrigins.length
    ? (origin, callback) => callback(null, !origin || corsAllowedOrigins.includes(origin))
    : true,
}));

// cookie-parser required for reading phone_session JWT cookie.
app.use(cookieParser());

// Raised from the default 100kb so a scanned bill/receipt image (stored as a
// base64 data URL) can be submitted with a ledger entry.
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true }));

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

const __dirname_app   = path.dirname(fileURLToPath(import.meta.url));

app.use("/api", router);
app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (isDatabaseNumericOverflow(error)) {
    logger.warn({ requestId: req.id, code: "22003" }, "Database numeric value exceeded its supported range");
    res.status(400).json({ error: "Amount exceeds the supported limit" });
    return;
  }
  next(error);
});

// Hostinger's single Node app can serve the two built Vite apps on the same
// origin. Replit keeps serving these as separate artifacts unless explicitly
// enabled by the root production start command.
if (process.env.SERVE_FRONTENDS === "true") {
  mountFrontendHosting(app, {
    websiteDir: path.resolve(__dirname_app, "../../khatabook/dist/public"),
    adminDir: path.resolve(__dirname_app, "../../banglakhata-admin/dist/public"),
    reservedPrefixes: [CLERK_PROXY_PATH],
  });
}

// ── Fire-and-forget startup migrations ───────────────────────────────────────
void ensureDefaultBusiness();
// Move any bill images stored as base64 data URLs into cloud object storage.
void migrateBillImages();

export default app;
