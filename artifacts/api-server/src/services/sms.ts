import { normalizeBdPhone } from "../lib/bdPhone";

const SMS_NET_BD_SEND_URL = "https://api.sms.net.bd/sendsms";
const OTP_MESSAGE = (code: string) =>
  `BanglaKhata verification code: ${code}. Expires in 10 minutes. Do not share it.`;

export type SmsGatewayStatus = {
  provider: "sms.net.bd";
  apiKeyConfigured: boolean;
};

/** Report only whether the server secret exists; never return or log its value. */
export function getSmsGatewayStatus(): SmsGatewayStatus {
  return {
    provider: "sms.net.bd",
    apiKeyConfigured: Boolean(process.env.SMS_NET_BD_API_KEY?.trim()),
  };
}

export async function ensureSmsReady(): Promise<void> {
  if (!getSmsGatewayStatus().apiKeyConfigured) {
    throw new Error("sms.net.bd API key is not configured");
  }
}

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  await ensureSmsReady();

  const normalizedPhone = normalizeBdPhone(phone);
  if (!normalizedPhone) {
    throw new Error("sms.net.bd OTP delivery supports Bangladeshi mobile numbers only");
  }

  const apiKey = process.env.SMS_NET_BD_API_KEY!.trim();
  const body = {
    api_key: apiKey,
    msg: OTP_MESSAGE(code),
    // sms.net.bd accepts either 880… or local 01… numbers; omit E.164's plus.
    to: normalizedPhone.slice(1),
  };
  const response = await fetch(SMS_NET_BD_SEND_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const result: unknown = await response.json().catch(() => null);
  const accepted =
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    (result as { error?: unknown }).error === 0;

  if (!response.ok || !accepted) {
    // Do not include response bodies, request parameters, or the API key in logs/errors.
    throw new Error("sms.net.bd did not accept the SMS request");
  }
}