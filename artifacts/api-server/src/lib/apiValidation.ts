const monetaryInputFields = new Set([
  "amount",
  "openingBalance",
  "onlineCollectionBalance",
]);

type ValidationErrorShape = {
  issues: Array<{ code: string; path: readonly unknown[] }>;
  message: string;
};

export function apiValidationErrorMessage(error: ValidationErrorShape): string {
  const exceedsMoneyLimit = error.issues.some(
    (issue) =>
      issue.code === "too_big" &&
      issue.path.some((part) => typeof part === "string" && monetaryInputFields.has(part)),
  );

  return exceedsMoneyLimit ? "Amount exceeds the supported limit" : error.message;
}

export function isDatabaseNumericOverflow(error: unknown): boolean {
  const visited = new Set<object>();
  let current: unknown = error;

  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    const record = current as { code?: unknown; cause?: unknown; originalError?: unknown };
    if (record.code === "22003") return true;
    current = record.cause ?? record.originalError;
  }

  return false;
}
