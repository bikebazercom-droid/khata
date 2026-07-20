import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "changeme-dev-secret";

export interface AdminTokenPayload {
  sub: string; // "admin"
  iat: number;
  exp: number;
}

export function signAdminToken(): string {
  return jwt.sign({ sub: "admin" }, ADMIN_SECRET, { expiresIn: "8h" });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing admin token" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    jwt.verify(token, ADMIN_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired admin token" });
  }
}
