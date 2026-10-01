/**
 * Public download routes — NO authentication required.
 *
 * These explicit handlers run before any auth middleware and serve
 * the physical files directly, so they work even if the express.static
 * middleware can't resolve the path (e.g. different cwd in production).
 *
 *   GET /downloads/banglakhata-windows.exe    — Windows installer
 *   GET /downloads/banglakhata-mac.dmg        — macOS / Linux DMG
 *   GET /download/:platform                   — parameterised alias
 *   GET /downloads/info                       — desktop installer availability
 */
import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

// Resolve relative to the compiled bundle (dist/index.mjs → ../public/downloads)
// so the path is correct in both dev (cwd = artifacts/api-server) and production
// (cwd = workspace root, bundle at artifacts/api-server/dist/index.mjs).
const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS_DIR = path.resolve(__dirname, "../public/downloads");
const WINDOWS_PATH = path.join(DOWNLOADS_DIR, "banglakhata-windows.exe");
const MAC_PATH     = path.join(DOWNLOADS_DIR, "banglakhata-mac.dmg");

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendBinary(
  req: any,
  res: any,
  filePath: string,
  contentType: string,
  filename: string,
) {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: `${filename} not found`, available: false });
    return;
  }
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.sendFile(filePath);
}

// ── Named routes ──────────────────────────────────────────────────────────────
router.get("/downloads/banglakhata-windows.exe", (req, res) => {
  sendBinary(req, res, WINDOWS_PATH, "application/octet-stream", "banglakhata-windows.exe");
});

router.get("/downloads/banglakhata-mac.dmg", (req, res) => {
  sendBinary(req, res, MAC_PATH, "application/x-apple-diskimage", "banglakhata-mac.dmg");
});

// ── Parameterised alias: GET /api/download/:platform ─────────────────────────

router.get("/download/:platform", (req, res) => {
  const { platform } = req.params as { platform: string };
  switch (platform.toLowerCase()) {
    case "windows":
      return sendBinary(req, res, WINDOWS_PATH, "application/octet-stream", "banglakhata-windows.exe");
    case "mac":
    case "macos":
    case "linux":
      return sendBinary(req, res, MAC_PATH, "application/x-apple-diskimage", "banglakhata-mac.dmg");
    default:
      res.status(400).json({ error: `Unknown platform '${platform}'. Use windows or mac.` });
  }
});

// ── Info ──────────────────────────────────────────────────────────────────────

router.get("/downloads/info", (_req, res) => {
  const windowsAvailable = fs.existsSync(WINDOWS_PATH);
  const macAvailable     = fs.existsSync(MAC_PATH);

  res.json({
    windowsAvailable,
    windowsUrl:       windowsAvailable ? "/api/downloads/banglakhata-windows.exe" : null,
    macAvailable,
    macUrl:           macAvailable     ? "/api/downloads/banglakhata-mac.dmg"     : null,
  });
});

export default router;
