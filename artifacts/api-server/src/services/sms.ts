import { normalizeBdPhone } from "../lib/bdPhone";

const DEFAULT_SMS_NET_BD_SEND_URL = "https://api.sms.net.bd/sendsms";
const OTP_MESSAGE = (code: string) =>
  `BanglaKhata verification code: ${code}. Expires in 10 minutes. Do not share it.`;

export type SmsGatewayFailureCode =
  | "missing_api_key"
  | "invalid_gateway_url"
  | "invalid_phone"
  | "network_timeout"
  | "network_error"
  | "http_error"
  | "provider_rejected"
  | "invalid_response";

export class SmsGatewayError extends Error {
  constructor(
    readonly code: SmsGatewayFailureCode,
    message: string,
    readonly httpStatus?: number,
    readonly providerErrorCode?: number | string,
  ) {
    super(message);
    this.name = "SmsGatewayError";
  }
}

export type SmsGatewayStatus = {
  provider: "sms.net.bd";
  apiKeyConfigured: boolean;
  gatewayConfigured: boolean;
  /** Only ever contains the approved provider URL; invalid input is never echoed. */
  gatewayUrl: string | null;
  configurationErrorCode: "missing_api_key" | "invalid_gateway_url" | null;
  configurationError: string | null;
};

function resolveSmsGatewayUrl(): string | null {
  const configuredUrl = process.env.SMS_NET_BD_API_URL?.trim();
  const candidate = configuredUrl || DEFAULT_SMS_NET_BD_SEND_URL;
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  // This endpoint receives the API key in its POST body. Restrict overrides to
  // the documented provider endpoint so a bad setting cannot exfiltrate it.
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "api.sms.net.bd" ||
    url.pathname !== "/sendsms" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  return url.toString();
}

/** Report configuration state only; never return or log the API key. */
export function getSmsGatewayStatus(): SmsGatewayStatus {
  const apiKeyConfigured = Boolean(process.env.SMS_NET_BD_API_KEY?.trim());
  const gatewayUrl = resolveSmsGatewayUrl();
  const configurationErrorCode = !apiKeyConfigured
    ? "missing_api_key"
    : !gatewayUrl
      ? "invalid_gateway_url"
      : null;

  return {
    provider: "sms.net.bd",
    apiKeyConfigured,
    gatewayConfigured: gatewayUrl !== null,
    gatewayUrl,
    configurationErrorCode,
    configurationError:
      configurationErrorCode === "missing_api_key"
        ? "SMS_NET_BD_API_KEY is not configured in the backend environment."
        : configurationErrorCode === "invalid_gateway_url"
          ? "SMS_NET_BD_API_URL must be https://api.sms.net.bd/sendsms."
          : null,
  };
}

export async function ensureSmsReady(): Promise<void> {
  const status = getSmsGatewayStatus();
  if (status.configurationErrorCode === "missing_api_key") {
    throw new SmsGatewayError("missing_api_key", status.configurationError!);
  }
  if (status.configurationErrorCode === "invalid_gateway_url") {
    throw new SmsGatewayError("invalid_gateway_url", status.configurationError!);
  }
}

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  await ensureSmsReady();

  const normalizedPhone = normalizeBdPhone(phone);
  if (!normalizedPhone) {
    throw new SmsGatewayError(
      "invalid_phone",
      "sms.net.bd OTP delivery supports Bangladeshi mobile numbers only",
    );
  }

  const apiKey = process.env.SMS_NET_BD_API_KEY!.trim();
  const gatewayUrl = getSmsGatewayStatus().gatewayUrl!;
  const body = {
    api_key: apiKey,
    msg: OTP_MESSAGE(code),
    // sms.net.bd accepts either 880… or local 01… numbers; omit E.164's plus.
    to: normalizedPhone.slice(1),
  };
  let response: Response;
  try {
    response = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new SmsGatewayError(
      timedOut ? "network_timeout" : "network_error",
      timedOut
        ? "sms.net.bd request timed out"
        : "Could not reach the sms.net.bd gateway",
    );
  }

  const result: unknown = await response.json().catch(() => null);
  const accepted =
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    (result as { error?: unknown }).error === 0;

  if (!response.ok) {
    throw new SmsGatewayError(
      "http_error",
      "sms.net.bd did not accept the SMS request",
      response.status,
    );
  }
  if (!accepted) {
    const rawProviderCode =
      typeof result === "object" && result !== null && "error" in result
        ? (result as { error?: unknown }).error
        : undefined;
    const providerErrorCode =
      typeof rawProviderCode === "number" && Number.isSafeInteger(rawProviderCode)
        ? rawProviderCode
        : typeof rawProviderCode === "string" && /^\d{1,4}$/.test(rawProviderCode)
          ? rawProviderCode
          : undefined;
    throw new SmsGatewayError(
      result === null ? "invalid_response" : "provider_rejected",
      "sms.net.bd did not accept the SMS request",
      undefined,
      providerErrorCode,
    );
  }
}