import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, adminOtpConfigTable } from "@workspace/db";

const connectors = new ReplitConnectors();

type TwilioList<T> = { accounts?: T[]; incoming_phone_numbers?: T[] };
type Account = { sid: string; status: string };
type Sender = { phone_number: string; capabilities?: { sms?: boolean } };

async function twilioJson<T>(path: string, options?: { method: string; body: string; headers: Record<string, string> }): Promise<T> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // cPanel is not running inside Replit's connector proxy. Use Twilio's
  // authenticated REST API when deployment credentials are configured.
  if (accountSid && authToken) {
    const response = await fetch(`https://api.twilio.com${path}`, {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        ...options?.headers,
      },
      ...(options?.body ? { body: options.body } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Twilio request failed (${response.status})`);
    if (result == null) throw new Error("Twilio returned an invalid response");
    return result as T;
  }

  // Keep the connected Replit integration available when this app runs on
  // Replit. Never silently fall back to it on an external host.
  if (!process.env.REPLIT_CONNECTORS_HOSTNAME || !process.env.REPL_IDENTITY) {
    throw new Error(
      "Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.",
    );
  }

  const response = await connectors.proxy("twilio", path, options);
  if (!response.ok) throw new Error(`Twilio request failed (${response.status})`);
  return response.json() as Promise<T>;
}

/** Fail closed if no single unambiguous SMS sender is configured. */
async function resolveSender(): Promise<{ accountSid: string; from: string }> {
  let accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  if (!accountSid) {
    const accounts = await twilioJson<TwilioList<Account>>("/2010-04-01/Accounts.json?PageSize=20");
    const active = accounts.accounts?.filter((account) => account.status === "active") ?? [];
    if (active.length !== 1) throw new Error("Configure one Twilio account for SMS");
    accountSid = active[0]!.sid;
  }

  const [config] = await db.select({ sender: adminOtpConfigTable.sender }).from(adminOtpConfigTable).limit(1);
  const from = config?.sender || process.env.TWILIO_FROM_NUMBER;
  const numbers = await twilioJson<TwilioList<Sender>>(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=100`,
  );
  const smsNumbers = numbers.incoming_phone_numbers?.filter((number) => number.capabilities?.sms) ?? [];
  if (from) {
    if (!smsNumbers.some((number) => number.phone_number === from))
      throw new Error("The selected Twilio SMS sender does not belong to the connected account");
    return { accountSid, from };
  }
  if (smsNumbers.length !== 1) throw new Error("Configure TWILIO_FROM_NUMBER for SMS");
  return { accountSid, from: smsNumbers[0]!.phone_number };
}

/** Only nonsecret provider facts, retrieved live; unavailable is never presented as zero. */
export async function getSmsAccountStatus(): Promise<{
  status: string; balance: string | null; currency: string | null;
  senders: string[]; sender: string | null;
}> {
  let sid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? null;
  if (!sid) {
    const accounts = await twilioJson<TwilioList<Account>>("/2010-04-01/Accounts.json?PageSize=20");
    const active = accounts.accounts?.filter((a) => a.status === "active") ?? [];
    sid = active.length === 1 ? active[0]!.sid : null;
  }
  if (!sid) throw new Error("Select a Twilio account using server configuration");
  const account = await twilioJson<Account>(`/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`);
  const numbers = await twilioJson<TwilioList<Sender>>(
    `/2010-04-01/Accounts/${encodeURIComponent(sid)}/IncomingPhoneNumbers.json?PageSize=100`);
  const senders = numbers.incoming_phone_numbers?.filter((n) => n.capabilities?.sms)
    .map((n) => n.phone_number) ?? [];
  const [config] = await db.select({ sender: adminOtpConfigTable.sender }).from(adminOtpConfigTable).limit(1);
  let balance: string | null = null;
  let currency: string | null = null;
  try {
    const result = await twilioJson<{ balance?: string; currency?: string }>(
      `/2010-04-01/Accounts/${encodeURIComponent(sid)}/Balance.json`);
    balance = result.balance ?? null;
    currency = result.currency ?? null;
  } catch {
    // Twilio account API may not expose billing scope; show unavailable, not a made-up value.
  }
  return { status: account.status, balance, currency, senders,
    sender: config?.sender || process.env.TWILIO_FROM_NUMBER || (senders.length === 1 ? senders[0]! : null) };
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