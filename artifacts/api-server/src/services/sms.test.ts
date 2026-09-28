import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ sender?: string }>,
  connectorProxy: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        limit: () => Promise.resolve(mocks.rows),
      }),
    }),
  },
  adminOtpConfigTable: { sender: "sender" },
}));

vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: class {
    proxy = mocks.connectorProxy;
  },
}));

import { sendOtpSms } from "./sms";

describe("Twilio SMS transport", () => {
  const envKeys = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
    "REPLIT_CONNECTORS_HOSTNAME",
    "REPL_IDENTITY",
  ] as const;
  let previousEnv: Partial<Record<(typeof envKeys)[number], string | undefined>>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    for (const key of envKeys) delete process.env[key];
    mocks.rows = [];
    mocks.connectorProxy.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("sends OTP through Twilio REST API when cPanel credentials are configured", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_TEST";
    process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
    process.env.TWILIO_FROM_NUMBER = "+8801700000000";
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        incoming_phone_numbers: [
          { phone_number: "+8801700000000", capabilities: { sms: true } },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sid: "SM_TEST",
        status: "queued",
      }), { status: 201 }));

    await sendOtpSms("+8801712345678", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [senderUrl, senderInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(senderUrl).toContain("/Accounts/AC_TEST/IncomingPhoneNumbers.json");
    expect((senderInit.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("AC_TEST:test-auth-token").toString("base64")}`,
    );

    const [messageUrl, messageInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(messageUrl).toContain("/Accounts/AC_TEST/Messages.json");
    const messageBody = new URLSearchParams(String(messageInit.body));
    expect(messageBody.get("To")).toBe("+8801712345678");
    expect(messageBody.get("From")).toBe("+8801700000000");
    expect(messageBody.get("Body")).toContain("123456");
    expect(mocks.connectorProxy).not.toHaveBeenCalled();
  });

  it("fails clearly on an external host when Twilio credentials are missing", async () => {
    await expect(sendOtpSms("+8801712345678", "123456")).rejects.toThrow(
      "Twilio is not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.connectorProxy).not.toHaveBeenCalled();
  });
});