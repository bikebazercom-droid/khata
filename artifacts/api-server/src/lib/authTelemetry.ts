import type { Request } from "express";

export function deviceDescription(req: Request): string {
  return (req.get("user-agent") ?? "Unknown").slice(0, 255);
}