/**
 * PostgreSQL LISTEN/NOTIFY event bus keyed by businessId.
 *
 * Replaces the original in-memory registry so that events published on one
 * server instance are delivered to SSE clients connected to any instance —
 * all processes share the same PostgreSQL database and therefore the same
 * notification channel.
 *
 * Interface is identical to the old in-memory bus:
 *   - broadcast(businessId, event)  — NOTIFY the pg channel
 *   - subscribe(businessId, handler) → unsubscribe fn  — LISTEN + local fan-out
 */

import pg from "pg";
import { pool } from "@workspace/db";
import { logger } from "./logger";

export type EventType =
  | "party.created"
  | "party.deleted"
  | "ledger.created"
  | "ledger.deleted"
  | "ledger.updated"
  | "settings.updated";

export interface BusinessEvent {
  type: EventType;
  /** Arbitrary JSON payload the client uses to decide which queries to invalidate. */
  payload: Record<string, unknown>;
}

type Handler = (event: BusinessEvent) => void;

// ---------------------------------------------------------------------------
// Channel naming
// ---------------------------------------------------------------------------

/**
 * Derive a safe PostgreSQL channel name from a businessId (UUID).
 * Strip hyphens so the result is a plain alphanumeric identifier that never
 * needs escaping and stays well under PG's 63-byte identifier limit.
 *   e.g. "550e8400-e29b-41d4-a716-446655440000" → "biz_550e8400e29b41d4a716446655440000"
 */
function channelFor(businessId: string): string {
  return `biz_${businessId.replace(/-/g, "")}`;
}

// ---------------------------------------------------------------------------
// Local in-process subscriber registry
// ---------------------------------------------------------------------------
// Each SSE connection registers a handler here. The LISTEN client forwards
// PG notifications to every handler registered under the matching businessId.

const registry = new Map<string, Set<Handler>>();

// ---------------------------------------------------------------------------
// Dedicated LISTEN client
// ---------------------------------------------------------------------------
// pg.Client (not Pool) is required because LISTEN state is per-connection.
// A single persistent client handles all channels for this process.

let listenClient: pg.Client | null = null;

/** Channels this process is currently LISTENing on. */
const listeningChannels = new Set<string>();

async function createListenClient(): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  client.on("notification", (msg) => {
    if (!msg.payload) return;
    let parsed: { businessId: string; event: BusinessEvent };
    try {
      parsed = JSON.parse(msg.payload);
    } catch {
      logger.warn({ payload: msg.payload }, "eventBus: malformed notification payload");
      return;
    }
    const handlers = registry.get(parsed.businessId);
    handlers?.forEach((h) => {
      try {
        h(parsed.event);
      } catch (err) {
        logger.error({ err }, "eventBus: handler threw during notification");
      }
    });
  });

  client.on("error", (err) => {
    logger.error({ err }, "eventBus LISTEN client error — will reconnect");
    // Null out so the next call to getListenClient() creates a fresh one.
    listenClient = null;
    listeningChannels.clear();
    // Attempt reconnect after a brief back-off.
    setTimeout(() => reconnectAndRelisten(), 5_000);
  });

  return client;
}

async function getListenClient(): Promise<pg.Client> {
  if (!listenClient) {
    listenClient = await createListenClient();
  }
  return listenClient;
}

/** After a reconnect, re-LISTEN on every channel we previously had. */
async function reconnectAndRelisten(): Promise<void> {
  // Collect all businessIds that still have active handlers.
  const businessIds = Array.from(registry.keys());
  try {
    const client = await getListenClient();
    for (const businessId of businessIds) {
      const channel = channelFor(businessId);
      await client.query(`LISTEN ${channel}`);
      listeningChannels.add(channel);
    }
    logger.info({ count: businessIds.length }, "eventBus: reconnected and re-listening");
  } catch (err) {
    logger.error({ err }, "eventBus: reconnect failed — retrying in 5 s");
    listenClient = null;
    listeningChannels.clear();
    setTimeout(() => reconnectAndRelisten(), 5_000);
  }
}

/** Ensure this process is LISTENing on the channel for the given businessId. */
async function ensureListening(businessId: string): Promise<void> {
  const channel = channelFor(businessId);
  if (listeningChannels.has(channel)) return;
  const client = await getListenClient();
  await client.query(`LISTEN ${channel}`);
  listeningChannels.add(channel);
}

// ---------------------------------------------------------------------------
// Public API (same signature as the previous in-memory bus)
// ---------------------------------------------------------------------------

/**
 * Register an SSE handler for a business. Returns an unsubscribe function
 * the caller must invoke when the connection closes.
 */
export function subscribe(businessId: string, handler: Handler): () => void {
  if (!registry.has(businessId)) registry.set(businessId, new Set());
  registry.get(businessId)!.add(handler);

  ensureListening(businessId).catch((err) => {
    logger.error({ err, businessId }, "eventBus: failed to LISTEN on channel");
  });

  return () => {
    const handlers = registry.get(businessId);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) registry.delete(businessId);
    // We intentionally leave the LISTEN active — it is harmless and avoids
    // the round-trip cost of UNLISTEN when the same business reconnects soon.
  };
}

/**
 * Broadcast an event to all SSE clients subscribed to this business,
 * across every server instance connected to the same database.
 */
export function broadcast(businessId: string, event: BusinessEvent): void {
  const channel = channelFor(businessId);
  const payload = JSON.stringify({ businessId, event });

  // Use the shared pool for NOTIFY — a regular query, no persistent state needed.
  pool
    .query("SELECT pg_notify($1, $2)", [channel, payload])
    .catch((err) => {
      logger.error({ err, businessId, event }, "eventBus: pg_notify failed");
    });
}
