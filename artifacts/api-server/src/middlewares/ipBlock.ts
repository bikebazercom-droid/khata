import type { Request, Response, NextFunction } from "express";
import { isIP } from "node:net";
import { eq } from "drizzle-orm";
import { blockedIpsTable, db } from "@workspace/db";

/**
 * No implicit trust of Replit's ingress: its proxy CIDRs are not documented.
 * An operator must verify and explicitly configure the trusted ingress CIDRs,
 * OR confirm that the API receives connections directly and opt into direct
 * mode. Never treat a shared, unidentified socket peer as a user's IP.
 */
export function ipPolicy(): { configured: boolean; mode: "trusted_proxy" | "direct" | "setup_required" } {
  if (process.env.TRUSTED_PROXY_CIDRS?.trim()) return { configured: true, mode: "trusted_proxy" };
  if (process.env.CLIENT_IP_MODE === "direct") return { configured: true, mode: "direct" };
  return { configured: false, mode: "setup_required" };
}

export function trustedProxyCidrs(): string[] {
  const values = process.env.TRUSTED_PROXY_CIDRS?.trim()
    ? process.env.TRUSTED_PROXY_CIDRS.split(",").map((v) => v.trim())
    : [];
  if (process.env.CLIENT_IP_MODE && process.env.CLIENT_IP_MODE !== "direct") {
    throw new Error("CLIENT_IP_MODE must be 'direct' or unset");
  }
  if (values.some((v) => !v) || (values.length && process.env.CLIENT_IP_MODE)) {
    throw new Error("Choose exactly one verified client IP policy (direct or trusted proxy CIDRs)");
  }
  for (const value of values) {
    const [host, prefix, extra] = value.split("/");
    const family = isIP(host);
    const max = family === 4 ? 32 : 128;
    if (!family || extra || (prefix !== undefined && (!/^\d+$/.test(prefix) ||
        Number(prefix) <= 0 || Number(prefix) > max))) {
      throw new Error("TRUSTED_PROXY_CIDRS must contain valid, restricted IP addresses or CIDRs");
    }
  }
  return values;
}

// Express req.ip uses only explicitly trusted hops. In proxy mode require
// an actual validated forwarded hop; otherwise req.ip is just the proxy socket.
export function clientIp(req: Request): string | null {
  const policy = ipPolicy();
  if (!policy.configured) return null;
  if (policy.mode === "trusted_proxy" && !req.ips?.length) return null;
  if (policy.mode === "direct" && req.ips?.length) return null;
  const ip = req.ip?.replace(/^::ffff:/, "");
  return ip && isIP(ip) ? ip : null;
}

export async function enforceIpBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = clientIp(req);
    if (!ip) {
      if (ipPolicy().configured) {
        // Allow only the admin-authenticated policy status page to explain
        // misconfigured forwarding. All other routes fail closed.
        if (req.method === "GET" && req.path === "/admin/blocked-ips") {
          next();
          return;
        }
        res.status(503).json({ error: "Client IP could not be verified under the configured proxy policy" });
        return;
      }
      // No policy means no user IP can be determined. Creation is disabled
      // below; do not compare the shared socket peer to legacy block records.
      next();
      return;
    }
    const [blocked] = await db.select({ ip: blockedIpsTable.ip }).from(blockedIpsTable)
      .where(eq(blockedIpsTable.ip, ip)).limit(1);
    if (blocked) {
      res.status(403).json({ error: "Access from this network IP has been blocked. Contact support. Shared networks may affect other users." });
      return;
    }
    next();
  } catch (error) {
    next(error); // Fail closed on DB errors; never silently allow a blocked IP.
  }
}