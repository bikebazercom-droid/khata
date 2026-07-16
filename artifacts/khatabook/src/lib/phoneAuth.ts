/**
 * Utilities for the custom phone-OTP auth path.
 *
 * After a successful OTP verification the server sets an httpOnly `phone_session`
 * cookie. The frontend can't read that cookie from JS, so we keep a small
 * in-memory flag and a `/api/auth/me` check to know whether a phone session
 * is active.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface MeResponse {
  userId: string;
  businessId: string;
  businessName?: string;
  phone?: string;
  authMethod: "clerk" | "phone";
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await fetch(`${BASE}/api/auth/me`, { credentials: "include" });
  if (!res.ok) throw new Error("not authenticated");
  return res.json() as Promise<MeResponse>;
}

export async function sendOtp(phone: string): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/phone/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ phone }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as any;
    throw new Error(body.error ?? "Failed to send OTP");
  }
}

export async function verifyOtp(phone: string, code: string): Promise<MeResponse> {
  const res = await fetch(`${BASE}/api/auth/phone/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ phone, code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as any;
    throw new Error(body.error ?? "Invalid code");
  }
  return res.json() as Promise<MeResponse>;
}

export async function phoneLogout(): Promise<void> {
  await fetch(`${BASE}/api/auth/phone/logout`, {
    method: "POST",
    credentials: "include",
  });
}
