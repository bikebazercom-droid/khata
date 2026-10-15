import type { Request } from "express";
import { lt } from "drizzle-orm";
import { db, userLoginAttemptsTable } from "@workspace/db";
import { clientIp } from "../middlewares/ipBlock";

export function deviceDescription(req: Request): string {
  return (req.get("user-agent") ?? "Unknown").slice(0, 255);
}

export async function recordFailedLoginAttempt(
  req: Request,
  input: { identifier: string; authMethod: string; stage: string; errorCode: string },
): Promise<void> {
  const identifier = input.identifier.trim().slice(0, 254).toLowerCase() || "unknown";
  try {
    await db.insert(userLoginAttemptsTable).values({
      identifier,
      authMethod: input.authMethod.slice(0, 40),
      stage: input.stage.slice(0, 40),
      errorCode: input.errorCode.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "unknown_error",
      ip: clientIp(req),
      device: deviceDescription(req),
    });
    await db.delete(userLoginAttemptsTable).where(
      lt(userLoginAttemptsTable.occurredAt, new Date(Date.now() - 90 * 24 * 60 * 60_000)),
    );
  } catch (error) {
    req.log?.error({ error }, "Failed login attempt could not be recorded");
  }
}