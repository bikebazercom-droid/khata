import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

type TwilioList<T> = { accounts?: T[]; incoming_phone_numbers?: T[] };
type Account = { sid: string; status: string };
type Sender = { phone_number: string; capabilities?: { sms?: boolean } };

async function twilioJson<T>(path: string, options?: { method: string; body: string; headers: Record<string, string> }): Promise<T> {
  const response = await connectors.proxy("twilio", path, options);
  if (!response.ok) throw new Error(`Twilio request failed (${response.status})`);
  return response.json() as Promise<T>;
}

/** Fail closed if no single unambiguous SMS sender is configured. */
async function resolveSender(): Promise<{ accountSid: string; from: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (accountSid && from) return { accountSid, from };

  const accounts = await twilioJson<TwilioList<Account>>("/2010-04-01/Accounts.json?PageSize=20");
  const active = accounts.accounts?.filter((account) => account.status === "active") ?? [];
  if (!accountSid && active.length !== 1) throw new Error("Configure one Twilio account for SMS");
  const sid = accountSid ?? active[0]!.sid;
  if (from) return { accountSid: sid, from };
  const numbers = await twilioJson<TwilioList<Sender>>(
    `/2010-04-01/Accounts/${encodeURIComponent(sid)}/IncomingPhoneNumbers.json?PageSize=100`,
  );
  const smsNumbers = numbers.incoming_phone_numbers?.filter((number) => number.capabilities?.sms) ?? [];
  if (smsNumbers.length !== 1) throw new Error("Configure TWILIO_FROM_NUMBER for SMS");
  return { accountSid: sid, from: smsNumbers[0]!.phone_number };
}

export async function ensureSmsReady(): Promise<void> {
  const { accountSid } = await resolveSender();
  // Even when account and sender are supplied via configuration, verify that
  // the connection works before allowing the owner to promise phone access.
  const account = await twilioJson<Account>(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
  );
  if (account.status !== "active") throw new Error("Twilio account is not active");
}

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  const { accountSid, from } = await resolveSender();
  const body = new URLSearchParams({
    To: phone,
    From: from,
    Body: `BanglaKhata verification code: ${code}. Expires in 10 minutes. Do not share it.`,
  });
  const message = await twilioJson<{ sid?: string; status?: string }>(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );
  if (!message.sid || message.status === "failed" || message.status === "undelivered") {
    throw new Error("SMS delivery was not accepted");
  }
}