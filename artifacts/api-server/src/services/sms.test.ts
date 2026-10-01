import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSmsReady, sendOtpSms } from "./sms";

describe("sms.net.bd OTP delivery", () => {
  const originalApiKey = process.env.SMS_NET_BD_API_KEY;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.SMS_NET_BD_API_KEY = "test-api-key";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.SMS_NET_BD_API_KEY;
    else process.env.SMS_NET_BD_API_KEY = originalApiKey;
    vi.unstubAllGlobals();
  });

  it("POSTs the OTP parameters to sms.net.bd without putting the API key in the URL", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 0,
          msg: "Request successfully submitted",
          data: { request_id: 1234 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await sendOtpSms("+880 (17) 1234-5678", "123456");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.sms.net.bd/sendsms");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init?.body));
    expect(body.api_key).toBe("test-api-key");
    expect(body.to).toBe("8801712345678");
    expect(body.msg).toContain("123456");
    expect(String(url)).not.toContain("test-api-key");
  });

  it("rejects non-Bangladeshi numbers before making a provider request", async () => {
    await expect(sendOtpSms("+14155552671", "123456")).rejects.toThrow(
      "supports Bangladeshi mobile numbers only",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails generically when sms.net.bd rejects the request", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 401, msg: "Invalid API key" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(sendOtpSms("+8801712345678", "123456")).rejects.toThrow(
      "sms.net.bd did not accept the SMS request",
    );
  });

  it("fails if the provider returns an HTTP error or invalid JSON", async () => {
    fetchMock.mockResolvedValue(new Response("upstream error", { status: 502 }));

    await expect(sendOtpSms("+8801712345678", "123456")).rejects.toThrow(
      "sms.net.bd did not accept the SMS request",
    );
  });

  it("requires the API key before enabling or sending OTPs", async () => {
    delete process.env.SMS_NET_BD_API_KEY;

    await expect(ensureSmsReady()).rejects.toThrow("API key is not configured");
    await expect(sendOtpSms("+8801712345678", "123456")).rejects.toThrow(
      "API key is not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});