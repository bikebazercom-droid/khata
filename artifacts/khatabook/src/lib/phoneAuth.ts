/**
 * Utilities for the custom phone-OTP auth path.
 *
 * After a successful OTP verification the server sets an httpOnly `phone_session`
 * cookie. The frontend can't read that cookie from JS, so we keep a small
 * in-memory flag and a `/api/auth/me` check to know whether a phone session
 * is active.
 */
import {
  NATIVE_AUTH_READY_MESSAGE,
  NATIVE_AUTH_REJECTED_MESSAGE,
  postNativeAuthMessage,
} from './nativePushBridge';

export interface MeResponse {
  userId: string;
  businessId: string;
  businessName?: string;
  needsBookName?: boolean;
  phone?: string;
  authMethod: "clerk" | "phone";
  role?: "owner" | "staff";
}

interface NativeAuthBootstrapResult {
  ok: boolean;
  status: number;
  data?: MeResponse;
  code?: string;
}

declare global {
  interface Window {
    __BKH_NATIVE_AUTH_BOOTSTRAP__?: Promise<NativeAuthBootstrapResult>;
  }
}

let nativeAuthBootstrapPromise: Promise<NativeAuthBootstrapResult> | null = null;
let nativeAuthReadyNotified = false;
let nativeAuthRejectedNotified = false;

export async function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  const injectedBootstrap = typeof window === 'undefined'
    ? undefined
    : window.__BKH_NATIVE_AUTH_BOOTSTRAP__;
  if (injectedBootstrap) {
    nativeAuthBootstrapPromise ??= injectedBootstrap;
    const result = await nativeAuthBootstrapPromise;
    if (result.ok && result.data) {
      if (typeof window !== 'undefined') delete window.__BKH_NATIVE_AUTH_BOOTSTRAP__;
      nativeAuthBootstrapPromise = null;
      if (!nativeAuthReadyNotified) {
        nativeAuthReadyNotified = true;
        postNativeAuthMessage(NATIVE_AUTH_READY_MESSAGE);
      }
      return result.data;
    }
    if (result.status === 401 || result.status === 403) {
      if (typeof window !== 'undefined') delete window.__BKH_NATIVE_AUTH_BOOTSTRAP__;
      nativeAuthBootstrapPromise = null;
      if (!nativeAuthRejectedNotified) {
        nativeAuthRejectedNotified = true;
        postNativeAuthMessage(NATIVE_AUTH_REJECTED_MESSAGE);
      }
      if (result.code === 'STAFF_ACCESS_REVOKED' && !nativeAuthRejectedNotified) {
        nativeAuthRejectedNotified = true;
        postNativeAuthMessage(NATIVE_AUTH_REJECTED_MESSAGE);
      }
      const error = new Error("Session expired or access denied") as Error & { status: number; code?: string };
      error.status = result.status;
      error.code = result.code;
      throw error;
    }
  }

  const res = await fetch(`/api/auth/me`, { credentials: "include", cache: "no-store", signal });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { code?: unknown } | null;
    const error = new Error(res.status === 401 || res.status === 403 ? "Session expired or access denied" : "Authentication server unavailable") as Error & { status: number; code?: string };
    error.status = res.status;
    if (typeof body?.code === 'string') error.code = body.code;
    if (error.code === 'STAFF_ACCESS_REVOKED' && !nativeAuthRejectedNotified) {
      nativeAuthRejectedNotified = true;
      postNativeAuthMessage(NATIVE_AUTH_REJECTED_MESSAGE);
    }
    throw error;
  }
  return res.json() as Promise<MeResponse>;
}

export async function sendOtp(phone: string): Promise<void> {
  const res = await fetch(`/api/auth/phone/send-otp`, {
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
  const res = await fetch(`/api/auth/phone/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ phone, code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    if (typeof body?.error === 'string' && body.error.trim()) {
      throw new Error(body.error);
    }
    if (res.status === 401) throw new Error('Invalid or expired code');
    throw new Error(`Sign-in service error (HTTP ${res.status}). Use Google/email or try again later.`);
  }
  return res.json() as Promise<MeResponse>;
}

export async function sendPhoneLinkOtp(phone: string): Promise<void> {
  const res = await fetch('/api/auth/phone/link/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ phone }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Could not send the verification code.');
  }
}

export async function verifyPhoneLinkOtp(
  phone: string,
  code: string,
): Promise<{ success: true; phone: string }> {
  const res = await fetch('/api/auth/phone/link/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ phone, code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Could not verify the phone number.');
  }
  return res.json() as Promise<{ success: true; phone: string }>;
}

export async function phoneLogout(): Promise<void> {
  const response = await fetch(`/api/auth/phone/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Could not revoke the phone session");
  }
}
