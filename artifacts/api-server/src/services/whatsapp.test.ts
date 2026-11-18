import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureWhatsAppReady,
  sendOtpWhatsApp,
  WhatsAppGatewayError,
} from "./whatsapp";

describe("WhatsApp Cloud API OTP delivery", () => {
  const originalValues = {
    token: process.env.META_WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
    templateName: process.env.META_WHATSAPP_OTP_TEMPLATE_NAME,
    templateLanguage: process.env.META_WHATSAPP_OTP_TEMPLATE_LANGUAGE,
    graphVersion: process.env.META_WHATSAPP_GRAPH_API_VERSION,
  };
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.META_WHATSAPP_ACCESS_TOKEN = "test-meta-token";
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = "123456789012345";
    process.env.META_WHATSAPP_OTP_TEMPLATE_NAME = "banglakhata_otp";
    process.env.META_WHATSAPP_OTP_TEMPLATE_LANGUAGE = "en_US";
    process.env.META_WHATSAPP_GRAPH_API_VERSION = "v26.0";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("META_WHATSAPP_ACCESS_TOKEN", originalValues.token);
    restore("META_WHATSAPP_PHONE_NUMBER_ID", originalValues.phoneNumberId);
    restore("META_WHATSAPP_OTP_TEMPLATE_NAME", originalValues.templateName);
    restore("META_WHATSAPP_OTP_TEMPLATE_LANGUAGE", originalValues.templateLanguage);
    restore("META_WHATSAPP_GRAPH_API_VERSION", originalValues.graphVersion);
    vi.unstubAllGlobals();
  });

  it("sends a copy-code authentication template to the normalized number", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.test_message_123" }],
    }), { status: 200 }));

    await expect(sendOtpWhatsApp("+880 (17) 1234-5678", "012345"))
      .resolves.toEqual({ providerMessageId: "wamid.test_message_123" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v26.0/123456789012345/messages");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-meta-token",
      "Content-Type": "application/json",
    });
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "8801712345678",
      type: "template",
      template: {
        name: "banglakhata_otp",
        language: { code: "en_US" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "012345" }] },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: "012345" }],
          },
        ],
      },
    });
    expect(String(url)).not.toContain("test-meta-token");
  });

  it("fails closed when the access token is missing", () => {
    delete process.env.META_WHATSAPP_ACCESS_TOKEN;

    expect(() => ensureWhatsAppReady()).toThrowError(
      expect.objectContaining({ code: "missing_access_token" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid configuration and numbers before making a request", async () => {
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = "https://example.com";
    expect(() => ensureWhatsAppReady()).toThrowError(
      expect.objectContaining({ code: "invalid_configuration" }),
    );

    process.env.META_WHATSAPP_PHONE_NUMBER_ID = "123456789012345";
    await expect(sendOtpWhatsApp("+14155552671", "123456")).rejects.toMatchObject({
      code: "invalid_phone",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose provider response text or the access token in errors", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: "Invalid token test-meta-token",
        type: "OAuthException",
        code: 190,
      },
    }), { status: 401 }));

    const error = await sendOtpWhatsApp("+8801712345678", "123456")
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(WhatsAppGatewayError);
    expect(error).toMatchObject({ code: "http_error", httpStatus: 401, providerErrorCode: 190 });
    expect(error.message).not.toContain("test-meta-token");
    expect(error.message).not.toContain("Invalid token");
  });
});
