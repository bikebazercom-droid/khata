/**
 * Download configuration routes.
 *
 * Public:
 *   GET /public/download-configs  — landing page fetches this on load
 *
 * Admin-protected:
 *   GET  /admin/download-configs  — read current config in admin panel
 *   POST /admin/download-configs  — upsert config from admin panel
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "@workspace/db";
import { downloadConfigsTable } from "@workspace/db/schema";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS    = path.resolve(__dirname, "../public/downloads");
const WINDOWS_FILE = path.join(DOWNLOADS, "banglakhata-windows.exe");

async function getConfig() {
  const [row] = await db.select().from(downloadConfigsTable).limit(1);
  return row ?? null;
}

// ── Public: landing page ──────────────────────────────────────────────────────

router.get("/public/download-configs", async (_req, res) => {
  try {
    const cfg = await getConfig();

    // Windows: DB URL > local file
    const windowsAvailable = fs.existsSync(WINDOWS_FILE);
    const windowsUrl       = cfg?.windowsExeUrl
      || (windowsAvailable ? "/api/downloads/banglakhata-windows.exe" : null);

    res.json({
      windowsAvailable: !!(windowsUrl),
      windowsUrl,
    });
  } catch (err) {
    logger.error({ err }, "public/download-configs GET error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Admin: read ───────────────────────────────────────────────────────────────

router.get("/admin/download-configs", requireAdmin as any, async (_req, res) => {
  try {
    const cfg = await getConfig();
    res.json({
      windowsExeUrl: cfg?.windowsExeUrl ?? "",
      updatedAt: cfg?.updatedAt ?? null,
    });
  } catch (err) {
    logger.error({ err }, "admin/download-configs GET error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Admin: upsert ─────────────────────────────────────────────────────────────

router.post("/admin/download-configs", requireAdmin as any, async (req, res) => {
  try {
    const {
      windowsExeUrl   = "",
    } = req.body as {
      windowsExeUrl?:   string;
    };

    const now = new Date();
    const existing = await getConfig();

    let row;
    if (existing) {
      [row] = await db
        .update(downloadConfigsTable)
        .set({ windowsExeUrl, updatedAt: now })
        .where(eq(downloadConfigsTable.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(downloadConfigsTable)
        .values({ windowsExeUrl, updatedAt: now })
        .returning();
    }

    res.json({
      windowsExeUrl: row?.windowsExeUrl ?? windowsExeUrl,
      updatedAt: row?.updatedAt ?? now,
    });
  } catch (err) {
    logger.error({ err }, "admin/download-configs POST error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
