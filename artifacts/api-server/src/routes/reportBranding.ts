import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  GetPublicReportBrandingResponse,
  GetAdminReportBrandingResponse,
  UpdateAdminReportBrandingBody,
  UpdateAdminReportBrandingResponse,
} from "@workspace/api-zod";
import { db, downloadConfigsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();
const REPORT_BRANDING_MIGRATION = "20261009_000001_add_report_branding_settings.sql";

type ReportBrandingRecord = Pick<
  typeof downloadConfigsTable.$inferSelect,
  "websiteUrl" | "androidStoreUrl" | "iosStoreUrl" | "supportPhone" | "supportEmail" | "updatedAt"
>;

const reportBrandingColumns = {
  websiteUrl: downloadConfigsTable.websiteUrl,
  androidStoreUrl: downloadConfigsTable.androidStoreUrl,
  iosStoreUrl: downloadConfigsTable.iosStoreUrl,
  supportPhone: downloadConfigsTable.supportPhone,
  supportEmail: downloadConfigsTable.supportEmail,
  updatedAt: downloadConfigsTable.updatedAt,
};

function reportBranding(row: ReportBrandingRecord | undefined) {
  return {
    websiteUrl: row?.websiteUrl ?? "",
    playStoreUrl: row?.androidStoreUrl ?? "",
    appleStoreUrl: row?.iosStoreUrl ?? "",
    supportPhone: row?.supportPhone ?? "",
    supportEmail: row?.supportEmail ?? "",
  };
}

function adminReportBranding(row: ReportBrandingRecord | undefined) {
  return GetAdminReportBrandingResponse.parse({
    ...reportBranding(row),
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  });
}

function isHttpsUrlOrBlank(value: string): boolean {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) &&
      !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function validSupportEmail(value: string): boolean {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isMissingReportBrandingMigration(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /column ["'](?:website_url|support_phone|support_email)["'] does not exist/i.test(message);
}

function reportBrandingMigrationMessage(): string {
  return `Apply the Supabase migration ${REPORT_BRANDING_MIGRATION} before managing report branding.`;
}

router.get("/public/report-branding", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select(reportBrandingColumns).from(downloadConfigsTable).limit(1);
    res.json(GetPublicReportBrandingResponse.parse(reportBranding(row)));
  } catch (err) {
    req.log.error({ err }, "public/report-branding GET error");
    res.status(503).json({ error: "Report links are temporarily unavailable" });
  }
});

router.get("/admin/report-branding", requireAdmin as any, async (req, res): Promise<void> => {
  try {
    const [row] = await db.select(reportBrandingColumns).from(downloadConfigsTable).limit(1);
    res.json(adminReportBranding(row));
  } catch (err) {
    req.log.error({ err }, "admin/report-branding GET error");
    res.status(503).json({
      error: isMissingReportBrandingMigration(err)
        ? reportBrandingMigrationMessage()
        : "Unable to load report settings",
    });
  }
});

router.put("/admin/report-branding", requireAdmin as any, async (req, res): Promise<void> => {
  const parsed = UpdateAdminReportBrandingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide valid website, app store, phone, and email values." });
    return;
  }

  const input = {
    websiteUrl: parsed.data.websiteUrl.trim(),
    playStoreUrl: parsed.data.playStoreUrl.trim(),
    appleStoreUrl: parsed.data.appleStoreUrl.trim(),
    supportPhone: parsed.data.supportPhone.trim(),
    supportEmail: parsed.data.supportEmail.trim(),
  };

  if (
    !isHttpsUrlOrBlank(input.websiteUrl) ||
    !isHttpsUrlOrBlank(input.playStoreUrl) ||
    !isHttpsUrlOrBlank(input.appleStoreUrl) ||
    !validSupportEmail(input.supportEmail)
  ) {
    res.status(400).json({
      error: "Website and app store links must be secure HTTPS URLs; enter a valid support email.",
    });
    return;
  }

  try {
    const [existing] = await db
      .select({ id: downloadConfigsTable.id })
      .from(downloadConfigsTable)
      .limit(1);
    const updatedAt = new Date();
    const [row] = existing
      ? await db
          .update(downloadConfigsTable)
          .set({
            websiteUrl: input.websiteUrl,
            androidStoreUrl: input.playStoreUrl,
            iosStoreUrl: input.appleStoreUrl,
            supportPhone: input.supportPhone,
            supportEmail: input.supportEmail,
            updatedAt,
          })
          .where(eq(downloadConfigsTable.id, existing.id))
          .returning()
      : await db
          .insert(downloadConfigsTable)
          .values({
            websiteUrl: input.websiteUrl,
            androidStoreUrl: input.playStoreUrl,
            iosStoreUrl: input.appleStoreUrl,
            supportPhone: input.supportPhone,
            supportEmail: input.supportEmail,
            updatedAt,
          })
          .returning();

    res.json(UpdateAdminReportBrandingResponse.parse(adminReportBranding(row)));
  } catch (err) {
    req.log.error({ err }, "admin/report-branding PUT error");
    res.status(isMissingReportBrandingMigration(err) ? 503 : 500).json({
      error: isMissingReportBrandingMigration(err)
        ? reportBrandingMigrationMessage()
        : "Unable to save report settings",
    });
  }
});

export default router;
