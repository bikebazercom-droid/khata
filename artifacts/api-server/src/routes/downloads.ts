/**
 * Public download routes — NO authentication required.
 *
 * These explicit handlers run before any auth middleware and serve
 * the physical files directly, so they work even if the express.static
 * middleware can't resolve the path (e.g. different cwd in production).
 */
import { Router } from "express";
import fs from "fs";
import path from "path";

const router = Router();

const DOWNLOADS_DIR = path.join(process.cwd(), "public/downloads");
const APK_PATH      = path.join(DOWNLOADS_DIR, "banglakhata.apk");
const WINDOWS_PATH  = path.join(DOWNLOADS_DIR, "banglakhata-windows.exe");

// ── APK ───────────────────────────────────────────────────────────────────────

router.get("/downloads/banglakhata.apk", (req, res) => {
  if (!fs.existsSync(APK_PATH)) {
    res.status(404).json({ error: "APK file not found" });
    return;
  }
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", 'attachment; filename="banglakhata.apk"');
  res.sendFile(APK_PATH);
});

// ── Windows EXE ───────────────────────────────────────────────────────────────

router.get("/downloads/banglakhata-windows.exe", (req, res) => {
  if (!fs.existsSync(WINDOWS_PATH)) {
    res.status(404).json({ error: "Windows installer not found" });
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", 'attachment; filename="banglakhata-windows.exe"');
  res.sendFile(WINDOWS_PATH);
});

// ── Info (legacy) ─────────────────────────────────────────────────────────────

router.get("/downloads/info", (_req, res) => {
  const apkAvailable     = fs.existsSync(APK_PATH);
  const windowsAvailable = fs.existsSync(WINDOWS_PATH);

  res.json({
    androidStoreUrl:  process.env.ANDROID_STORE_URL ?? null,
    iosStoreUrl:      process.env.IOS_STORE_URL     ?? null,
    apkAvailable,
    apkUrl:           apkAvailable     ? "/api/downloads/banglakhata.apk"         : null,
    windowsAvailable,
    windowsUrl:       windowsAvailable ? "/api/downloads/banglakhata-windows.exe" : null,
  });
});

export default router;
