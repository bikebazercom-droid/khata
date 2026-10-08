export function isTransientNetworkError(error: unknown): boolean {
  const record = typeof error === 'object' && error !== null
    ? error as {
    status?: unknown;
    response?: { status?: unknown };
    message?: unknown;
    }
    : undefined;
  const status = typeof record?.status === 'number'
    ? record.status
    : typeof record?.response?.status === 'number'
      ? record.response.status
      : undefined;
  // An HTTP response means the request reached a server. Server-side failures
  // and validation rejections must be shown to the user, not replayed as if
  // they were caused by lost connectivity.
  if (status !== undefined) return status === 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (!record) {
    return error instanceof Error && /network|fetch|offline|timeout|connection/i.test(error.message);
  }
  return typeof record.message === 'string' &&
    /network|fetch|offline|timeout|timed out|connection/i.test(record.message);
}
