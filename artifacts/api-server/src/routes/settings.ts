import { Router, type IRouter } from "express";
import { db, businessSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { broadcast } from "../lib/eventBus";
import {
  GetBusinessSettingsResponse,
  UpdateBusinessSettingsBody,
  UpdateBusinessSettingsResponse,
} from "@workspace/api-zod";
import { getOrCreateBusinessSettings } from "../lib/khatabook";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";
import { apiValidationErrorMessage } from "../lib/apiValidation";

const router: IRouter = Router();

router.get("/settings", async (req, res): Promise<void> => {
  const { businessId } = req as AuthenticatedRequest;
  const settings = await getOrCreateBusinessSettings(businessId);
  res.json(
    GetBusinessSettingsResponse.parse({
      ...settings,
      onlineCollectionBalance: Number(settings.onlineCollectionBalance),
    }),
  );
});

router.patch("/settings", async (req, res): Promise<void> => {
  const { businessId } = req as AuthenticatedRequest;
  const parsed = UpdateBusinessSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: apiValidationErrorMessage(parsed.error) });
    return;
  }

  const existing = await getOrCreateBusinessSettings(businessId);

  const updates: Partial<typeof businessSettingsTable.$inferInsert> = {};
  if (parsed.data.storeName !== undefined) {
    updates.storeName = parsed.data.storeName;
  }
  if (parsed.data.language !== undefined) {
    updates.language = parsed.data.language;
  }
  if (parsed.data.onlineCollectionBalance !== undefined) {
    updates.onlineCollectionBalance = parsed.data.onlineCollectionBalance.toFixed(2);
  }

  const [updated] = await db
    .update(businessSettingsTable)
    .set(updates)
    .where(eq(businessSettingsTable.id, existing.id))
    .returning();

  broadcast(businessId, { type: 'settings.updated', payload: {} });

  res.json(
    UpdateBusinessSettingsResponse.parse({
      ...updated,
      onlineCollectionBalance: Number(updated!.onlineCollectionBalance),
    }),
  );
});

export default router;
