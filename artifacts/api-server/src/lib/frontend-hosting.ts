import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { existsSync } from "node:fs";
import path from "node:path";

type FrontendHostingOptions = {
  websiteDir: string;
  adminDir: string;
  reservedPrefixes?: string[];
};

export function shouldServeFrontends(nodeEnv: string | undefined, serveFrontends: string | undefined): boolean {
  return serveFrontends === "true" ||
    (nodeEnv === "production" && serveFrontends !== "false");
}

function isPageRequest(req: Request): boolean {
  return (req.method === "GET" || req.method === "HEAD") && Boolean(req.accepts("html"));
}

function sendIndex(indexPath: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isPageRequest(req) || path.extname(req.path)) {
      next();
      return;
    }

    setNoStoreHeaders(res);
    res.sendFile(indexPath, (error) => {
      if (error) next(error);
    });
  };
}

function setNoStoreHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function setStaticCacheHeaders(res: Response, filePath: string): void {
  const fileName = path.basename(filePath);
  if (path.extname(fileName).toLowerCase() === ".html"
    || fileName === "sw.js"
    || fileName === "manifest.webmanifest") {
    setNoStoreHeaders(res);
    return;
  }

  // Vite emits content-hashed entry chunks and assets. Only these immutable
  // files can safely be cached for a year; unhashed public files stay fresh.
  if (/[-.][A-Za-z0-9_-]{8,}\.[^.]+$/.test(fileName)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }

  setNoStoreHeaders(res);
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
      setHeaders: (res, filePath) => setStaticCacheHeaders(res, filePath),
    }),
  );

  // Serve built website assets without allowing its SPA fallback to claim API or admin routes.
  app.use(
    express.static(websiteDir, {
      dotfiles: "ignore",
      fallthrough: true,
      index: false,
      setHeaders: (res, filePath) => setStaticCacheHeaders(res, filePath),
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