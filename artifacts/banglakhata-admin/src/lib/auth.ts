export const ADMIN_AUTH_CHANGED_EVENT = "banglakhata-admin:auth-changed";

export function getAdminToken() {
  return localStorage.getItem("admin_token");
}

export function getAdminTokenExpires() {
  return localStorage.getItem("admin_token_expires");
}

export function setAdminAuth(token: string, expiresAt: string) {
  localStorage.setItem("admin_token", token);
  localStorage.setItem("admin_token_expires", expiresAt);
  notifyAdminAuthChanged();
}

export function clearAdminAuth(notify = true) {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_token_expires");
  if (notify) notifyAdminAuthChanged();
}

function notifyAdminAuthChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ADMIN_AUTH_CHANGED_EVENT));
  }
}

export function hasValidAdminSession() {
  const token = getAdminToken();
  const expiresAt = getAdminTokenExpires();
  if (!token || !expiresAt) return false;

  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
}

export async function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = getAdminToken();
  if (!token || !hasValidAdminSession()) {
    clearAdminAuth();
    throw new Error("Your admin session has expired. Please sign in again.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) clearAdminAuth();
  return response;
}
