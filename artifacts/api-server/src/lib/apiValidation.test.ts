import { describe, expect, it } from "vitest";
import { BulkSaveBengaliLedgerBody, CreateLedgerEntryBody } from "@workspace/api-zod";
import { apiValidationErrorMessage, isDatabaseNumericOverflow } from "./apiValidation";

describe("monetary API validation", () => {
  it("accepts twenty-billion ledger entries and returns a clear error above the safe-cent limit", () => {
    expect(CreateLedgerEntryBody.safeParse({
      type: "YOU_GAVE",
      amount: 20_000_000_000,
    }).success).toBe(true);

    const parsed = CreateLedgerEntryBody.safeParse({
      type: "YOU_GAVE",
      amount: 90_071_992_547_410,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(apiValidationErrorMessage(parsed.error)).toBe("Amount exceeds the supported limit");
    }
  });

  it("applies the same limit to reviewed scan entries", () => {
    expect(BulkSaveBengaliLedgerBody.safeParse({
      entries: [{ partyId: "party-1", amount: 20_000_000_000, type: "YOU_GOT" }],
    }).success).toBe(true);
    expect(BulkSaveBengaliLedgerBody.safeParse({
      entries: [{ partyId: "party-1", amount: 90_071_992_547_410, type: "YOU_GOT" }],
    }).success).toBe(false);
  });

  it("recognizes PostgreSQL numeric overflow errors for a clear client response", () => {
    expect(isDatabaseNumericOverflow(Object.assign(new Error("numeric out of range"), {
      code: "22003",
    }))).toBe(true);
    expect(isDatabaseNumericOverflow({ code: "23505" })).toBe(false);
  });
});
