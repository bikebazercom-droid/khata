/**
 * GET /events — Server-Sent Events channel, one per authenticated business.
 *
 * Clients connect with `EventSource("/api/events", { withCredentials: true })`.
 * The server keeps the response open, fanning out business-scoped events
 * from the in-memory event bus. A heartbeat comment is sent every 25 s to
 * keep proxies/load-balancers from closing idle connections.
 *
 * Native EventSource reconnects automatically on drop; the client will
 * re-fetch all stale queries on reconnect, so no explicit "catch-up" cursor
 * is needed for the "no spinners" UX goal.
 */

import { Router, type IRouter } from "express";
import { subscribe, type BusinessEvent } from "../lib/eventBus";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

const HEARTBEAT_INTERVAL_MS = 25_000;

router.get("/events", (req, res): void => {
  const { businessId } = req as unknown as AuthenticatedRequest;

  // SSE headers — no buffering, keep-alive, no cache.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx: disable proxy buffering
  res.flushHeaders();

  // Send an initial connection confirmation the client can use to mark the
  // channel as "ready" before applying any pending invalidations.
  res.write("event: connected\ndata: {}\n\n");

  // Fan-out handler: serialise each event as an SSE message.
  function send(event: BusinessEvent): void {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  }

  const unsubscribe = subscribe(businessId, send);

  // Heartbeat — keeps the connection alive through idle periods.
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, HEARTBEAT_INTERVAL_MS);

  // Clean up when the client closes the connection.
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
