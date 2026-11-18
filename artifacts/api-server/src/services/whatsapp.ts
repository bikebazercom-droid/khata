import { normalizeBdPhone } from "../lib/bdPhone";

const DEFAULT_GRAPH_API_VERSION = "v26.0";

export type WhatsAppGatewayFailureCode =
  | "missing_access_token"
  | "missing_phone_number_id"
  | "missing_template"
  | "invalid_configuration"
  | "invalid_phone"
  | "network_timeout"
  | "network_error"
  | "http_error"
  | "provider_rejected"
  | "invalid_response";

export class WhatsAppGatewayError extends Error {
  constructor(
    readonly code: WhatsAppGatewayFailureCode,
    message: string,
    readonly httpStatus?: number,
    readonly providerErrorCode?: number | string,
  ) {
    super(message);
    this.name = "WhatsAppGatewayError";
  }
}

type WhatsAppConfig = {
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  templateLanguage: string;
  graphApiVersion: string;
};

function getWhatsAppConfig(): WhatsAppConfig {
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
  const templateName = process.env.META_WHATSAPP_OTP_TEMPLATE_NAME?.trim();
  const templateLanguage = process.env.META_WHATSAPP_OTP_TEMPLATE_LANGUAGE?.trim() || "en_US";
  const graphApiVersion = process.env.META_WHATSAPP_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;

  if (!accessToken) {
    throw new WhatsAppGatewayError("missing_access_token", "WhatsApp access token is not configured.");
  }
  if (!phoneNumberId) {
    throw new WhatsAppGatewayError("missing_phone_number_id", "WhatsApp phone number ID is not configured.");
  }
  if (!templateName) {
    throw new WhatsAppGatewayError("missing_template", "WhatsApp OTP template is not configured.");
  }
  if (
    !/^\d{5,30}$/.test(phoneNumberId) ||
    !/^[a-z0-9_]{1,512}$/.test(templateName) ||
    !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage) ||
    !/^v\d{1,3}\.\d{1,2}$/.test(graphApiVersion)
  ) {
    throw new WhatsAppGatewayError("invalid_configuration", "WhatsApp OTP configuration is invalid.");
  }

  return { accessToken, phoneNumberId, templateName, templateLanguage, graphApiVersion };
}

export function ensureWhatsAppReady(): void {
  getWhatsAppConfig();
}

export type WhatsAppGatewayReceipt = { providerMessageId?: string };

function getProviderErrorCode(result: unknown): number | string | undefined {
  if (typeof result !== "object" || result === null || !("error" in result)) return undefined;
  const error = (result as { error?: unknown }).error;
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "number" && Number.isSafeInteger(code)) return code;
  if (typeof code === "string" && /^\d{1,8}$/.test(code)) return code;
  return undefined;
}

function getProviderMessageId(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null || !("messages" in result)) return undefined;
  const messages = (result as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || typeof messages[0] !== "object" || messages[0] === null) {
    return undefined;
  }
  const id = (messages[0] as { id?: unknown }).id;
  return typeof id === "string" && /^wamid\.[A-Za-z0-9+/=_-]{1,1024}$/.test(id)
    ? id
    : undefined;
}

export async function sendOtpWhatsApp(phone: string, code: string): Promise<WhatsAppGatewayReceipt> {
  const config = getWhatsAppConfig();
  const normalizedPhone = normalizeBdPhone(phone);
  if (!normalizedPhone) {
    throw new WhatsAppGatewayError(
      "invalid_phone",
      "WhatsApp OTP delivery supports Bangladeshi mobile numbers only.",
    );
  }

  const endpoint =
    `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizedPhone.slice(1),
        type: "template",
        template: {
          name: config.templateName,
          language: { code: config.templateLanguage },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: code }],
            },
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: code }],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new WhatsAppGatewayError(
      timedOut ? "network_timeout" : "network_error",
      timedOut ? "WhatsApp request timed out." : "Could not reach the WhatsApp Cloud API.",
    );
  }

  const result: unknown = await response.json().catch(() => null);
  const providerErrorCode = getProviderErrorCode(result);
  const providerMessageId = getProviderMessageId(result);
  if (!response.ok) {
    throw new WhatsAppGatewayError(
      "http_error",
      "WhatsApp Cloud API did not accept the OTP request.",
      response.status,
      providerErrorCode,
    );
  }
  if (!providerMessageId) {
    throw new WhatsAppGatewayError(
      result === null ? "invalid_response" : "provider_rejected",
      "WhatsApp Cloud API did not accept the OTP request.",
      undefined,
      providerErrorCode,
    );
  }

  return { providerMessageId };
}
