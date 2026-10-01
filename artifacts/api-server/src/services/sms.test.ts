import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureSmsReady,
  getSmsGatewayStatus,
  sendOtpSms,
  SmsGatewayError,
} from "./sms";

describe("sms.net.bd OTP delivery", () => {
  const originalApiKey = process.env.SMS_NET_BD_API_KEY;
  const originalGatewayUrl = process.env.SMS_NET_BD_API_URL;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.SMS_NET_BD_API_KEY = "test-api-key";
    delete process.env.SMS_NET_BD_API_URL;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.SMS_NET_BD_API_KEY;
    else process.env.SMS_NET_BD_API_KEY = originalApiKey;
    if (originalGatewayUrl === undefined) delete process.env.SMS_NET_BD_API_URL;
    else process.env.SMS_NET_BD_API_URL = originalGatewayUrl;
    vi.unstubAllGlobals();
  });

  it("uses the official endpoint by default and POSTs the OTP parameters without putting the key in the URL", async () => {
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

  it("reads the optional gateway URL and rejects endpoints that could receive the API key", async () => {
    process.env.SMS_NET_BD_API_URL = "https://example.com/sendsms";

    expect(getSmsGatewayStatus()).toMatchObject({
      apiKeyConfigured: true,
      gatewayConfigured: false,
      gatewayUrl: null,
      configurationErrorCode: "invalid_gateway_url",
    });
    await expect(sendOtpSms("+8801712345678", "123456")).rejects.toMatchObject({
      code: "invalid_gateway_url",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an explicit copy of the documented provider endpoint", async () => {
    process.env.SMS_NET_BD_API_URL = "https://api.sms.net.bd/sendsms";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 0 }), { status: 200 }));

    await sendOtpSms("+8801712345678", "123456");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.sms.net.bd/sendsms");
  });

  it("rejects non-Bangladeshi numbers before making a provider request", async () => {
    await expect(sendOtpSms("+14155552671", "123456")).rejects.toMatchObject({
      code: "invalid_phone",
      message: expect.stringContaining("supports Bangladeshi mobile numbers only"),
    });
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

  it("keeps a numeric provider error code for diagnostics without exposing provider text", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        error: 401,
        msg: "Rejected request using test-api-key",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const error = await sendOtpSms("+8801712345678", "123456").catch((caught) => caught);

    expect(error).toMatchObject({
      code: "provider_rejected",
      providerErrorCode: 401,
    });
    expect(error.message).toBe("sms.net.bd did not accept the SMS request");
    expect(error.message).not.toContain("test-api-key");
    expect(error.message).not.toContain("Rejected request");
  });

  it("fails if the provider returns an HTTP error or invalid JSON", async () => {
    fetchMock.mockResolvedValue(new Response("upstream error", { status: 502 }));

    await expect(sendOtpSms("+8801712345678", "123456")).rejects.toThrow(
      "sms.net.bd did not accept the SMS request",
    );
  });

  it("classifies gateway timeouts without preserving transport error details", async () => {
    fetchMock.mockRejectedValue(new DOMException("sensitive transport detail", "TimeoutError"));

    const error = await sendOtpSms("+8801712345678", "123456").catch((caught) => caught);

    expect(error).toBeInstanceOf(SmsGatewayError);
    expect(error).toMatchObject({ code: "network_timeout" });
    expect(error.message).not.toContain("sensitive transport detail");
  });

  it("requires the API key before enabling or sending OTPs", async () => {
    delete process.env.SMS_NET_BD_API_KEY;

    expect(getSmsGatewayStatus()).toMatchObject({
      apiKeyConfigured: false,
      configurationErrorCode: "missing_api_key",
    });
    await expect(ensureSmsReady()).rejects.toMatchObject({ code: "missing_api_key" });
    await expect(sendOtpSms("+8801712345678", "123456")).rejects.toMatchObject({
      code: "missing_api_key",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});