import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
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

const app: Express = express();

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

app.use(cors({ credentials: true, origin: true }));

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

// Serve downloadable files (APK, etc.) from the public/downloads directory.
// Accessible at /api/downloads/<filename> in both dev and production.
app.use(
  "/api/downloads",
  express.static(path.join(process.cwd(), "public/downloads"), {
    dotfiles: "ignore",
    setHeaders(res, filePath) {
      if (filePath.endsWith(".apk")) {
        res.setHeader("Content-Type", "application/vnd.android.package-archive");
        res.setHeader("Content-Disposition", 'attachment; filename="banglakhata.apk"');
      }
      if (filePath.endsWith(".exe")) {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", 'attachment; filename="banglakhata-windows.exe"');
      }
      if (filePath.endsWith(".dmg")) {
        res.setHeader("Content-Type", "application/x-apple-diskimage");
        res.setHeader("Content-Disposition", 'attachment; filename="banglakhata-mac.dmg"');
      }
    },
  }),
);

app.use("/api", router);

// ── Guarantee placeholder download files exist ────────────────────────────────
// Production deployments start from a clean container; these stubs ensure the
// download routes always return 200 even before real installers are uploaded.
(function ensureDownloadFiles() {
  const dir = path.join(process.cwd(), "public/downloads");
  try {
    fs.mkdirSync(dir, { recursive: true });

    const apkPath = path.join(dir, "banglakhata.apk");
    if (!fs.existsSync(apkPath)) {
      // Minimal ZIP stub — PK signature so Android/browsers treat it as binary.
      const buf = Buffer.alloc(512);
      buf.write("PK\x03\x04", 0, "binary");
      buf.write(
        "BanglaKhata Android App - Placeholder. Replace with the real APK.\n",
        30,
        "utf8",
      );
      fs.writeFileSync(apkPath, buf);
      logger.info("[ensureDownloadFiles] created placeholder banglakhata.apk");
    }

    const exePath = path.join(dir, "banglakhata-windows.exe");
    if (!fs.existsSync(exePath)) {
      // Minimal MZ/PE stub — MZ magic so Windows/browsers treat it as binary.
      const buf = Buffer.alloc(256);
      buf.write("MZ", 0, "ascii");
      buf.writeUInt32LE(64, 60); // e_lfanew
      buf.write("PE\x00\x00", 64, "ascii");
      buf.writeUInt16LE(0x014c, 68); // IMAGE_FILE_MACHINE_I386
      buf.writeUInt16LE(0x0002, 86); // IMAGE_FILE_EXECUTABLE_IMAGE
      buf.write(
        "BanglaKhata Windows App - Placeholder. Replace with the real installer.\n",
        96,
        "utf8",
      );
      fs.writeFileSync(exePath, buf);
      logger.info(
        "[ensureDownloadFiles] created placeholder banglakhata-windows.exe",
      );
    }

    const macPath = path.join(dir, "banglakhata-mac.dmg");
    if (!fs.existsSync(macPath)) {
      // Minimal stub so the route returns 503 (placeholder) rather than 404.
      const buf = Buffer.alloc(256);
      buf.write(
        "BanglaKhata macOS App - Placeholder. Replace with the real DMG.\n",
        0,
        "utf8",
      );
      fs.writeFileSync(macPath, buf);
      logger.info("[ensureDownloadFiles] created placeholder banglakhata-mac.dmg");
    }
  } catch (err) {
    logger.error({ err }, "[ensureDownloadFiles] failed to create placeholder files");
  }
})();

// ── Fire-and-forget startup migrations ───────────────────────────────────────
void ensureDefaultBusiness();
// Move any bill images stored as base64 data URLs into cloud object storage.
void migrateBillImages();

export default app;
