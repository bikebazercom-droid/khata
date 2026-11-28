/**
 * GET /events — Server-Sent Events channel, one per authenticated business.
 *
 * Clients connect with authenticated fetch streaming and X-Business-Id.
 * The server keeps the response open, fanning out business-scoped events
 * from the PostgreSQL event bus. A heartbeat comment is sent every 25 s to
 * keep proxies/load-balancers from closing idle connections.
 *
 * The client reconnects automatically on drop and will
 * re-fetch all stale queries on reconnect, so no explicit "catch-up" cursor
 * is needed for the "no spinners" UX goal.
 */

import { Router, type IRouter } from "express";
import { subscribe, type BusinessEvent } from "../lib/eventBus";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";
import { and, eq, isNull } from "drizzle-orm";
import { db, appUsersTable, workerPartyAssignmentsTable } from "@workspace/db";

const router: IRouter = Router();

const HEARTBEAT_INTERVAL_MS = 25_000;

router.get("/events", (req, res): void => {
  const { businessId, userId, role } = req as unknown as AuthenticatedRequest;

  // SSE headers — no buffering, keep-alive, no cache.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx: disable proxy buffering
  res.flushHeaders();

  // Tell the browser to attempt reconnection after 3 seconds (instead of
  // the browser's own default, which varies and can be as long as several
  // seconds). On mobile networks that drop frequently, a shorter retry
  // interval means faster resync after a cell handoff or brief outage.
  res.write("retry: 3000\n\n");

  // Fan-out handler: serialise each event as an SSE message.
  async function send(event: BusinessEvent): Promise<void> {
    if (res.destroyed || res.writableEnded) return;
    if (role === "staff") {
      // Long-lived streams must not retain permissions removed after connect.
      const [activeStaff] = await db.select({ id: appUsersTable.id }).from(appUsersTable).where(and(
        eq(appUsersTable.id, userId), eq(appUsersTable.businessId, businessId),
        eq(appUsersTable.status, "active"), eq(appUsersTable.role, "staff"),
        isNull(appUsersTable.workerAccessDeletedAt),
      )).limit(1);
      if (!activeStaff) { res.end(); return; }
      if (event.type === "settings.updated" || event.type === "sync.required") {
        res.write(`event: ${event.type}\ndata: {}\n\n`);
        return;
      }
      const partyId = event.payload.partyId;
      if (typeof partyId !== "string" || !/^(party|ledger)\./.test(event.type)) return;
      const [assigned] = await db.select({ id: workerPartyAssignmentsTable.partyId })
        .from(workerPartyAssignmentsTable).where(and(
          eq(workerPartyAssignmentsTable.userId, userId),
          eq(workerPartyAssignmentsTable.partyId, partyId),
        )).limit(1);
      if (!assigned || res.destroyed || res.writableEnded) return;
      // Send invalidation metadata only, not arbitrary owner-only event data.
      res.write(`event: ${event.type}\ndata: ${JSON.stringify({ partyId })}\n\n`);
      return;
    }
    const isOwnerNotificationEvent =
      event.type === "notification.created" || event.type === "notification.updated";
    if (isOwnerNotificationEvent && event.payload.recipientUserId !== userId) return;

    if (isOwnerNotificationEvent) {
      const { recipientUserId: _recipientUserId, ...payload } = event.payload;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`);
      return;
    }
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  }

  const unsubscribe = subscribe(businessId, (event) => {
    void send(event).catch((err) => {
      req.log?.error({ err }, "Live event authorization failed");
      res.end();
    });
  }, {
    ready: () => {
      if (!res.destroyed && !res.writableEnded) res.write("event: connected\ndata: {}\n\n");
    },
    failed: () => { res.end(); },
  });

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
