function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!isRecord(value)) return [];
  return [value.error, value.message].filter((text): text is string => typeof text === "string");
}

export function isLedgerAmountLimitError(error: unknown): boolean {
  if (!isRecord(error)) {
    return error instanceof Error && /numeric field overflow|numeric value out of range/i.test(error.message);
  }

  const response = isRecord(error.response) ? error.response : undefined;
  const texts = [
    ...errorText(error),
    ...errorText(error.data),
    ...errorText(response?.data),
  ];
  return texts.some((text) =>
    /amount exceeds.{0,40}(limit|range)|numeric field overflow|numeric value out of range/i.test(text),
  );
}
