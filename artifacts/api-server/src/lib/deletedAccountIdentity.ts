import { createHmac } from "node:crypto";

export function hashDeletedAccountIdentity(
  kind: "email" | "phone" | "firebase" | "supabase",
  identifier: string,
): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to protect deleted account identities");
  const value = kind === "email" ? identifier.trim().toLowerCase() : identifier.trim();
  return `deleted:${createHmac("sha256", secret)
    .update(`${kind}:${value}`)
    .digest("hex")}`;
}
