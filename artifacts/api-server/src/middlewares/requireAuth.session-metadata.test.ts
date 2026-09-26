import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLERK_SESSION_METADATA_TIMEOUT_MS, getVerifiedClerkEmail, verifyClerkSessionCreationTime } from "./requireAuth";

const cutoff = new Date("2025-01-01T00:00:00.000Z");
const session = { id: "session", user_id: "worker", created_at: cutoff.getTime() + 1 };

describe("Clerk session metadata deadline", () => {
  beforeEach(() => vi.stubEnv("CLERK_SECRET_KEY", "sk_test_local_fixture"));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("bounds a fetch that never returns headers, aborts it, and ignores late rejection", async () => {
    vi.useFakeTimers();
    let rejectLate!: (error: Error) => void;
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      new Promise<Response>((_, reject) => { rejectLate = reject; }));
    vi.stubGlobal("fetch", fetchMock);
    const result = verifyClerkSessionCreationTime("session", "worker", cutoff).catch((error: Error) => error);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.clerk.com/v1/sessions/session",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await vi.advanceTimersByTimeAsync(CLERK_SESSION_METADATA_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual(expect.objectContaining({ message: expect.stringContaining("timed out") }));
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    rejectLate(new Error("late network rejection"));
    await Promise.resolve();
  });

  it("uses the same budget for headers and a stalled JSON body", async () => {
    vi.useFakeTimers();
    let resolveBody!: (value: typeof session) => void;
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({
      ok: true,
      json: () => new Promise((resolve) => { resolveBody = resolve; }),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);
    const result = verifyClerkSessionCreationTime("session", "worker", cutoff).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(CLERK_SESSION_METADATA_TIMEOUT_MS);
    expect(await result).toEqual(expect.objectContaining({ message: expect.stringContaining("timed out") }));
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    resolveBody(session);
    await Promise.resolve();
  });

  it("clears the timer on success, mismatch, and provider error; retries the same session", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...session, created_at: cutoff.getTime() })))
      .mockResolvedValueOnce(new Response(JSON.stringify(session)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyClerkSessionCreationTime("session", "worker", cutoff)).rejects.toThrow("provider unavailable");
    expect(vi.getTimerCount()).toBe(0);
    expect(await verifyClerkSessionCreationTime("session", "worker", cutoff)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(await verifyClerkSessionCreationTime("session", "worker", cutoff)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("Clerk verified-email metadata deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["headers", "JSON body"] as const)("bounds a stalled %s, aborts, ignores late completion, and retries", async (stage) => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_local_fixture");
    vi.useFakeTimers();
    const user = {
      primary_email_address_id: "verified",
      email_addresses: [{ id: "verified", email_address: "WORKER@example.test", verification: { status: "verified" } }],
    };
    let releaseLate!: () => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, _init?: RequestInit) =>
        stage === "headers"
          ? new Promise<globalThis.Response>((resolve) => {
            releaseLate = () => resolve(new Response(JSON.stringify(user)));
          })
          : Promise.resolve({
            ok: true,
            json: () => new Promise((resolve) => { releaseLate = () => resolve(user); }),
          } as globalThis.Response))
      .mockResolvedValueOnce(new Response(JSON.stringify(user)));
    vi.stubGlobal("fetch", fetchMock);
    const result = getVerifiedClerkEmail("worker").catch((error: Error) => error);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.clerk.com/v1/users/worker",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await vi.advanceTimersByTimeAsync(CLERK_SESSION_METADATA_TIMEOUT_MS);
    expect(await result).toEqual(expect.objectContaining({ message: expect.stringContaining("timed out") }));
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    releaseLate();
    await Promise.resolve();
    expect(await getVerifiedClerkEmail("worker")).toBe("worker@example.test");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("distinguishes provider failures from a successful response without verified email", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_local_fixture");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ email_addresses: [] }))));
    await expect(getVerifiedClerkEmail("worker")).rejects.toThrow("Could not verify Clerk email");
    expect(vi.getTimerCount()).toBe(0);
    expect(await getVerifiedClerkEmail("worker")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});