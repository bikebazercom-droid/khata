/**
 * Public download info endpoint — no auth required.
 * Returns configured store URLs and whether APK / Windows installer files
 * are present on disk.
 */
import { Router } from "express";
import fs from "fs";
import path from "path";

const router = Router();

const APK_PATH     = path.join(process.cwd(), "public/downloads/banglakhata.apk");
const WINDOWS_PATH = path.join(process.cwd(), "public/downloads/banglakhata-windows.exe");

router.get("/downloads/info", (_req, res) => {
  const apkAvailable     = fs.existsSync(APK_PATH);
  const windowsAvailable = fs.existsSync(WINDOWS_PATH);

  res.json({
    androidStoreUrl:  process.env.ANDROID_STORE_URL ?? null,
    iosStoreUrl:      process.env.IOS_STORE_URL     ?? null,
    apkAvailable,
    apkUrl:           apkAvailable     ? "/api/downloads/banglakhata.apk"          : null,
    windowsAvailable,
    windowsUrl:       windowsAvailable ? "/api/downloads/banglakhata-windows.exe"  : null,
  });
});

export default router;
