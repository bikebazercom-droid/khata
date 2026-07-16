/**
 * In-memory SSE event bus keyed by businessId.
 *
 * Write endpoints call `broadcast(businessId, event)` after a successful DB
 * mutation. SSE handler in routes/events.ts subscribes per-connection and
 * fans out to every browser tab/device connected to the same business.
 */

export type EventType =
  | 'party.created'
  | 'party.deleted'
  | 'ledger.created'
  | 'settings.updated';

export interface BusinessEvent {
  type: EventType;
  /** Arbitrary JSON payload the client uses to decide which queries to invalidate. */
  payload: Record<string, unknown>;
}

type Handler = (event: BusinessEvent) => void;

// businessId → set of active SSE handlers
const registry = new Map<string, Set<Handler>>();

/**
 * Register an SSE handler for a business. Returns an unsubscribe function
 * the caller must invoke when the connection closes.
 */
export function subscribe(businessId: string, handler: Handler): () => void {
  if (!registry.has(businessId)) registry.set(businessId, new Set());
  registry.get(businessId)!.add(handler);

  return () => {
    const handlers = registry.get(businessId);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) registry.delete(businessId);
  };
}

/**
 * Broadcast an event to all SSE clients subscribed to this business.
 * Silently no-ops when nobody is connected.
 */
export function broadcast(businessId: string, event: BusinessEvent): void {
  registry.get(businessId)?.forEach((h) => h(event));
}
