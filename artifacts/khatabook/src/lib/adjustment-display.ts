export interface AdjustmentDisplay {
  details: string;
  adjustment: string | null;
}

/**
 * Transfer descriptions include a generated “adjusted with party” suffix.
 * Keep that metadata in its own report column while preserving user remarks.
 */
export function splitAdjustmentDescription(
  description: string | null | undefined,
  isTransfer: boolean | null | undefined,
  transferPartyName?: string | null,
): AdjustmentDisplay {
  const text = description?.trim() ?? '';
  if (!isTransfer) return { details: text, adjustment: null };

  const generatedSuffix = /(?:\s+—\s+)?অ্যাডজাস্ট করা হয়েছে\s+(.+?)-এর সাথে$/;
  const match = text.match(generatedSuffix);
  const details = match ? text.slice(0, match.index).trim() : text;
  const name = transferPartyName?.trim() || match?.[1]?.trim();

  return {
    details,
    adjustment: name ? `অন্য খাতায়: ${name}` : 'সমন্বয় লেনদেন',
  };
}
