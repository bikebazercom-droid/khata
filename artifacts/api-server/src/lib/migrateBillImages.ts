/**
 * One-time startup migration: move bill images stored as base64 data URLs in
 * the `ledger_entries.bill_image` column into cloud object storage, then
 * replace the column value with the object path so future reads use the
 * stored URL.
 *
 * Safe to call repeatedly — entries whose `billImage` doesn't start with
 * `data:` are skipped, so the migration is idempotent.
 */

import { eq, sql } from "drizzle-orm";
import { db, ledgerEntriesTable, partiesTable } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

const objectStorageService = new ObjectStorageService();

/** Convert a base64 data URL string to a Node.js Buffer. */
function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const [header, data] = dataUrl.split(",");
  const mimeMatch = header?.match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const buffer = Buffer.from(data ?? "", "base64");
  return { buffer, mimeType };
}

export async function migrateBillImages(): Promise<void> {
  try {
    // Find all entries that still hold raw base64 data.
    const rows = await db
      .select({
        id: ledgerEntriesTable.id,
        billImage: ledgerEntriesTable.billImage,
        businessId: partiesTable.businessId,
      })
      .from(ledgerEntriesTable)
      .innerJoin(partiesTable, eq(ledgerEntriesTable.partyId, partiesTable.id))
      .where(sql`${ledgerEntriesTable.billImage} like 'data:%'`);

    if (rows.length === 0) {
      logger.info("[migrateBillImages] no base64 bill images found — nothing to migrate");
      return;
    }

    logger.info(`[migrateBillImages] migrating ${rows.length} base64 bill image(s) to cloud storage`);

    let succeeded = 0;
    let failed = 0;

    for (const row of rows) {
      if (!row.billImage) continue;

      try {
        if (!row.businessId) throw new Error("Bill image owner business is missing");
        const { buffer, mimeType } = dataUrlToBuffer(row.billImage);

        // Get a presigned PUT URL, then upload the image bytes directly to
        // storage. Local-disk tickets travel in Authorization so access logs
        // never record a bearer ticket in the URL.
        const uploadURL = await objectStorageService.getObjectEntityUploadURL({
          businessId: row.businessId,
          size: buffer.length,
          contentType: mimeType,
        });
        const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
        const localToken = objectStorageService.getLocalUploadToken(uploadURL);

        const uploadRes = await fetch(
          localToken ? objectStorageService.getLocalUploadEndpoint() : uploadURL,
          {
          method: "PUT",
          body: buffer,
          headers: {
            "Content-Type": mimeType,
            ...(localToken ? { Authorization: `Bearer ${localToken}` } : {}),
          },
          // @ts-ignore — Node 18+ fetch accepts Buffer as body
          duplex: "half",
          },
        );

        if (!uploadRes.ok) {
          throw new Error(`GCS PUT returned ${uploadRes.status}`);
        }

        // Update the row to store the objectPath instead of the base64 blob.
        await db
          .update(ledgerEntriesTable)
          .set({ billImage: objectPath })
          .where(sql`${ledgerEntriesTable.id} = ${row.id}`);

        succeeded++;
        logger.info(`[migrateBillImages] migrated entry ${row.id} → ${objectPath}`);
      } catch (err) {
        failed++;
        logger.error({ err }, `[migrateBillImages] failed to migrate entry ${row.id}`);
        // Continue with remaining entries — don't abort the whole migration
        // for a single failure.
      }
    }

    logger.info(`[migrateBillImages] done: ${succeeded} succeeded, ${failed} failed`);
  } catch (err) {
    logger.error({ err }, "[migrateBillImages] migration failed");
  }
}
