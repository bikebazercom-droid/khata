/**
 * Admin-protected binary upload routes.
 *
 *   POST /admin/upload-app-binary  — upload APK, EXE, or DMG (field: "apk" | "exe" | "mac")
 *   GET  /admin/binary-info        — returns file size + mtime for all three binaries
 */
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";

const router = Router();

const DOWNLOADS_DIR = path.join(process.cwd(), "public/downloads");

// Map accepted field names to their fixed filenames on disk.
const FILE_MAP: Record<string, string> = {
  apk: "banglakhata.apk",
  exe: "banglakhata-windows.exe",
  mac: "banglakhata-mac.dmg",
};

// Accepted extensions per field
const ACCEPTED_EXT: Record<string, string[]> = {
  apk: [".apk"],
  exe: [".exe"],
  mac: [".dmg", ".zip", ".tar.gz"],
};

// Ensure the directory always exists before multer tries to write.
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, DOWNLOADS_DIR);
  },
  filename(_req, file, cb) {
    const dest = FILE_MAP[file.fieldname];
    if (!dest) return cb(new Error(`Unknown field '${file.fieldname}'. Use 'apk', 'exe', or 'mac'.`), "");
    cb(null, dest);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter(_req, file, cb) {
    if (!Object.keys(FILE_MAP).includes(file.fieldname)) {
      return cb(new Error(`Invalid field name '${file.fieldname}'. Use 'apk', 'exe', or 'mac'.`));
    }
    const lc   = file.originalname.toLowerCase();
    const exts = ACCEPTED_EXT[file.fieldname] ?? [];
    if (!exts.some((ext) => lc.endsWith(ext))) {
      return cb(
        new Error(
          `Field '${file.fieldname}' only accepts: ${exts.join(", ")}. Got: ${file.originalname}`,
        ),
      );
    }
    cb(null, true);
  },
});

// ── POST /admin/upload-app-binary ────────────────────────────────────────────

router.post(
  "/admin/upload-app-binary",
  requireAdmin as any,
  upload.any(),
  (req: any, res: any) => {
    const files: Express.Multer.File[] = req.files ?? [];
    if (files.length === 0) {
      return res
        .status(400)
        .json({ error: "No file uploaded. Send a multipart field named 'apk', 'exe', or 'mac'." });
    }

    const file = files[0];
    if (!FILE_MAP[file.fieldname]) {
      return res
        .status(400)
        .json({ error: `Invalid field: '${file.fieldname}'. Use 'apk', 'exe', or 'mac'.` });
    }

    logger.info(
      { field: file.fieldname, filename: file.filename, size: file.size },
      "[uploadBinary] file saved",
    );

    res.json({
      ok:        true,
      fieldname: file.fieldname,
      filename:  file.filename,
      size:      file.size,
    });
  },
);

// ── GET /admin/binary-info ───────────────────────────────────────────────────

router.get("/admin/binary-info", requireAdmin as any, (_req: any, res: any) => {
  function stat(filename: string) {
    const p = path.join(DOWNLOADS_DIR, filename);
    try {
      const s = fs.statSync(p);
      return { exists: true, size: s.size, mtime: s.mtime.toISOString() };
    } catch {
      return { exists: false, size: 0, mtime: null };
    }
  }

  res.json({
    apk: stat("banglakhata.apk"),
    exe: stat("banglakhata-windows.exe"),
    mac: stat("banglakhata-mac.dmg"),
  });
});

export default router;
