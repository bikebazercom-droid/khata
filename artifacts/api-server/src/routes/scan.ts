import { Router } from "express";
import multer from "multer";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, ledgerEntriesTable, partiesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { broadcast } from "../lib/eventBus";
import {
  createOwnerEntryNotificationsBestEffort,
  publishOwnerEntryNotifications,
} from "../lib/ownerNotifications";
import {
  fromSignedBalance,
  toSignedBalance,
  toDateOnlyString,
} from "../lib/khatabook";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";
import { BulkSaveBengaliLedgerBody } from "@workspace/api-zod";
import { apiValidationErrorMessage } from "../lib/apiValidation";

const router = Router();

// ── multer: in-memory storage for the scanned ledger image ───────────────────
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

// ── POST /api/scan/bengali-ledger ─────────────────────────────────────────────
// Accepts a multipart/form-data POST with field "image".
// Fetches all parties for the business, sends the image + party list to
// OpenAI Vision with Bengali fuzzy-matching instructions, returns matched items.
router.post(
  "/scan/bengali-ledger",
  scanUpload.single("image"),
  async (req, res): Promise<void> => {
    const { businessId } = req as unknown as AuthenticatedRequest;

    if (!req.file) {
      res.status(400).json({ error: "image file is required" });
      return;
    }

    // Fetch all parties for this business to use in name matching
    const parties = await db
      .select({
        id: partiesTable.id,
        name: partiesTable.name,
        role: partiesTable.role,
      })
      .from(partiesTable)
      .where(eq(partiesTable.businessId, businessId));

    const partyListText = parties.length > 0
      ? parties.map((p, i) => `${i + 1}. [${p.id}] ${p.name} (${p.role})`).join("\n")
      : "(no parties yet)";

    const base64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64}`;
    const today = toDateOnlyString(new Date()) ?? new Date().toISOString().slice(0, 10);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 3000,
      messages: [
        {
          role: "system",
          content:
            `You are a Bengali handwritten ledger OCR and intelligent name-matching assistant.

Your task:
1. Carefully read every row of the handwritten Bengali ledger image
2. Extract: person/party name, transaction amount, transaction type
3. Match each extracted name against the system party database using fuzzy string matching
   (handle: spelling variations, abbreviations, Bengali script similarities, partial names)
4. Return ONLY a valid JSON object — no markdown fences, no extra text

JSON format: { "items": [ ...array of item objects... ] }

Each item must have EXACTLY these keys:
- "partyId": string UUID from matched party, or null if no good match
- "partyName": string — the matched system name (or the extracted name if no match)
- "extractedName": string — exactly as it appears in the image
- "amount": number — positive number only, no currency symbols
- "type": "YOU_GOT" for received/জমা/পেয়েছি/পেয়েছেন, "YOU_GAVE" for paid/খরচ/দিয়েছি/দিয়েছেন
- "note": string — any additional description beside the entry (empty string if none)
- "confidence": "high" if name match is very clear, "medium" if approximate, "low" if uncertain

System party database:
${partyListText}

Fuzzy matching rules:
- বাবলু matches বাবলু মিয়া or বাবলু ভাই
- রহিম matches রহিমুদ্দিন, রহিম মিয়া
- Short forms like "বাবু" should match "বাবু হোসেন"
- Ignore common suffixes: মিয়া, ভাই, সাহেব, বাই

If no transactions are found in the image, return {"items":[]}.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Today is ${today}. Please scan this Bengali handwritten ledger and match all names against my party database.`,
            },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" },
            },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);

    type ParsedItem = {
      partyId: string | null;
      partyName: string;
      extractedName: string;
      amount: number;
      type: "YOU_GAVE" | "YOU_GOT";
      note: string;
      confidence: "high" | "medium" | "low";
    };

    let items: ParsedItem[] = [];
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { items?: unknown[] };
        if (Array.isArray(parsed.items)) {
          items = parsed.items
            .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
            .map((i) => ({
              partyId: typeof i.partyId === "string" && i.partyId.length > 10 ? i.partyId : null,
              partyName: typeof i.partyName === "string" ? i.partyName : String(i.extractedName ?? ""),
              extractedName: typeof i.extractedName === "string" ? i.extractedName : "",
              amount: typeof i.amount === "number" ? Math.abs(i.amount) : Math.abs(Number(i.amount)) || 0,
              type: (i.type as string) === "YOU_GOT" ? "YOU_GOT" : "YOU_GAVE",
              note: typeof i.note === "string" ? i.note : "",
              confidence: (["high", "medium", "low"] as const).includes(i.confidence as "high" | "medium" | "low")
                ? (i.confidence as "high" | "medium" | "low")
                : "low",
              } as ParsedItem))
            .filter((i) => i.amount > 0);
        }
      } catch {
        // Malformed JSON — return empty list
      }
    }

    res.json({ items });
  },
);

// ── POST /api/scan/bulk-save ──────────────────────────────────────────────────
// Bulk-saves confirmed scan results across multiple parties in one transaction.
router.post("/scan/bulk-save", async (req, res): Promise<void> => {
  const { businessId, userId, role } = req as unknown as AuthenticatedRequest;

  type BulkEntry = {
    partyId: string;
    amount: number;
    type: "YOU_GAVE" | "YOU_GOT";
    note?: string;
  };

  const parsed = BulkSaveBengaliLedgerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: apiValidationErrorMessage(parsed.error) });
    return;
  }
  const entries: BulkEntry[] = parsed.data.entries.map((item) => ({
    partyId: item.partyId,
    amount: item.amount,
    type: item.type,
    note: item.note ?? "",
  }));

  // Verify all referenced parties belong to this business
  const uniquePartyIds = [...new Set(entries.map((e) => e.partyId))];
  const dbParties = await db
    .select()
    .from(partiesTable)
    .where(and(eq(partiesTable.businessId, businessId)));

  const partyMap = new Map(dbParties.map((p) => [p.id, { ...p }]));
  for (const pid of uniquePartyIds) {
    if (!partyMap.has(pid)) {
      res.status(404).json({ error: `Party not found: ${pid}` });
      return;
    }
  }

  const now = new Date();
  const createdEntries: (typeof ledgerEntriesTable.$inferSelect)[] = [];

  await db.transaction(async (tx) => {
    for (const item of entries) {
      const party = partyMap.get(item.partyId)!;
      const currentSigned = toSignedBalance(party);
      const delta = item.type === "YOU_GAVE" ? item.amount : -item.amount;
      const nextSigned = currentSigned + delta;
      const { currentBalance, balanceType } = fromSignedBalance(nextSigned);

      // Keep the in-memory map up-to-date so multiple entries for the same
      // party within the same batch stack their balances correctly.
      partyMap.set(item.partyId, { ...party, currentBalance, balanceType });

      const [entry] = await tx
        .insert(ledgerEntriesTable)
        .values({
          partyId: item.partyId,
          createdByUserId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
            ? userId
            : null,
          type: item.type,
          amount: item.amount.toFixed(2),
          description: item.note ?? "",
          dueDate: null,
          createdAt: now,
        })
        .returning();

      await tx
        .update(partiesTable)
        .set({ currentBalance, balanceType, lastTransactionAt: now })
        .where(eq(partiesTable.id, item.partyId));

      createdEntries.push(entry!);
    }
  });

  const notifications = role === "staff"
    ? await createOwnerEntryNotificationsBestEffort({
      businessId,
      actorUserId: userId,
      entries: createdEntries.map((entry) => ({
        entryId: entry.id,
        partyId: entry.partyId,
        partyName: partyMap.get(entry.partyId)!.name,
      })),
    })
    : [];
  publishOwnerEntryNotifications(notifications);
  // Broadcast live-update events for each affected party
  for (const entry of createdEntries) {
    broadcast(businessId, {
      type: "ledger.created",
      payload: { partyId: entry.partyId, entryId: entry.id },
    });
  }

  res.status(201).json({ count: createdEntries.length });
});

export default router;
