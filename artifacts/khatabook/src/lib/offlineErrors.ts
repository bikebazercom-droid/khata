export function isTransientNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (typeof error !== 'object' || error === null) {
    return error instanceof Error && /network|fetch|offline|timeout|connection/i.test(error.message);
  }
  const record = error as {
    status?: unknown;
    response?: { status?: unknown };
    message?: unknown;
  };
  const status = typeof record.status === 'number'
    ? record.status
    : typeof record.response?.status === 'number'
      ? record.response.status
      : undefined;
  if (status !== undefined) return status === 0 || status >= 500;
  return typeof record.message === 'string' &&
    /network|fetch|offline|timeout|timed out|connection/i.test(record.message);
}
