import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { existsSync } from "node:fs";
import path from "node:path";

type FrontendHostingOptions = {
  websiteDir: string;
  adminDir: string;
  reservedPrefixes?: string[];
};

function isPageRequest(req: Request): boolean {
  return (req.method === "GET" || req.method === "HEAD") && Boolean(req.accepts("html"));
}

function sendIndex(indexPath: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isPageRequest(req) || path.extname(req.path)) {
      next();
      return;
    }

    res.sendFile(indexPath, (error) => {
      if (error) next(error);
    });
  };
}

function matchesPrefix(requestPath: string, prefix: string): boolean {
  const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return requestPath === normalizedPrefix || requestPath.startsWith(`${normalizedPrefix}/`);
}

export function mountFrontendHosting(
  app: Express,
  { websiteDir, adminDir, reservedPrefixes = [] }: FrontendHostingOptions,
): void {
  const websiteIndex = path.resolve(websiteDir, "index.html");
  const adminIndex = path.resolve(adminDir, "index.html");

  if (!existsSync(websiteIndex) || !existsSync(adminIndex)) {
    throw new Error(
      "Combined frontend hosting is enabled, but a built index.html is missing. Run `pnpm run build:hostinger` before starting the server.",
    );
  }

  // The admin Vite build uses BASE_PATH=/admin/, so its assets live below this prefix.
  app.use(
    "/admin",
    express.static(adminDir, {
      dotfiles: "ignore",
      fallthrough: true,
      index: false,
    }),
  );

  // Serve built website assets without allowing its SPA fallback to claim API or admin routes.
  app.use(
    express.static(websiteDir, {
      dotfiles: "ignore",
      fallthrough: true,
      index: false,
    }),
  );

  app.get(/^\/admin(?:\/.*)?$/, (req, res, next) => {
    if (path.extname(req.path)) {
      next();
      return;
    }

    sendIndex(adminIndex)(req, res, next);
  });

  app.get(/.*/, (req, res, next) => {
    if (
      req.path === "/admin" ||
      req.path.startsWith("/admin/") ||
      ["/api", ...reservedPrefixes].some((prefix) => matchesPrefix(req.path, prefix))
    ) {
      next();
      return;
    }

    sendIndex(websiteIndex)(req, res, next);
  });
}