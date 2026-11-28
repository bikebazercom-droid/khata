import express from "express";
import { createServer, type Server } from "node:http";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appUsersTable, businessesTable, db, ledgerEntriesTable, partiesTable, workerPartyAssignmentsTable } from "@workspace/db";
import type { BusinessEvent } from "../lib/eventBus";
const bus = vi.hoisted(() => ({
  handler: null as ((event: BusinessEvent) => void) | null,
  ready: null as (() => void) | null,
  businessId: "",
  unsubscribe: vi.fn(),
  listeners: [] as Array<{ businessId: string; handler: (event: BusinessEvent) => void }>,
}));
vi.mock("../lib/eventBus", () => ({
  subscribe: (businessId: string, handler: (event: BusinessEvent) => void, readiness: { ready: () => void }) => {
    bus.businessId = businessId; bus.handler = handler; bus.ready = readiness.ready;
    const listener = { businessId, handler };
    bus.listeners.push(listener);
    return () => {
      bus.listeners = bus.listeners.filter((item) => item !== listener);
      bus.unsubscribe();
    };
  },
  broadcast: (businessId: string, event: BusinessEvent) => {
    bus.listeners.filter((item) => item.businessId === businessId).forEach((item) => item.handler(event));
  },
}));
import eventsRouter from "./events";
import { enforceRoleAccess } from "../middlewares/roleAccess";
import partiesRouter from "./parties";

describe("staff live ledger updates", () => {
  let businessId: string, staffId: string, assignedId: string, privateId: string;
  let server: Server;
  let base: string;
  const output: string[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    Object.assign(req, { businessId, userId: staffId, role: "staff", status: "active" });
    const write = res.write.bind(res);
    res.write = ((chunk: unknown) => {
      output.push(String(chunk));
      return write(chunk as string);
    }) as typeof res.write;
    next();
  });
  app.use(enforceRoleAccess, eventsRouter, partiesRouter);
  app.get("/settings", (_req, res) => { res.json({ secret: true }); });

  beforeAll(async () => {
    const [business] = await db.insert(businessesTable).values({ name: "Live staff book" }).returning();
    businessId = business!.id;
    const [staff] = await db.insert(appUsersTable).values({ businessId, role: "staff" }).returning();
    staffId = staff!.id;
    const parties = await db.insert(partiesTable).values([
      { name: "Assigned live party", role: "CUSTOMER", businessId, phone: "" },
      { name: "Unassigned live party", role: "CUSTOMER", businessId, phone: "" },
    ]).returning();
    assignedId = parties[0]!.id; privateId = parties[1]!.id;
    await db.insert(workerPartyAssignmentsTable).values({ userId: staffId, partyId: assignedId });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    await vi.waitFor(() => expect(bus.listeners).toHaveLength(0));
  });
  afterAll(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (staffId) {
      await db.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, staffId));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, staffId));
    }
    if (assignedId && privateId) {
      await db.delete(ledgerEntriesTable).where(inArray(ledgerEntriesTable.partyId, [assignedId, privateId]));
      await db.delete(partiesTable).where(inArray(partiesTable.id, [assignedId, privateId]));
    }
    if (businessId) await db.delete(businessesTable).where(eq(businessesTable.id, businessId));
  });

  it("allows staff streaming without granting owner-only settings access", async () => {
    const controller = new AbortController();
    try {
      const stream = await fetch(`${base}/events`, { signal: controller.signal });
      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type")).toContain("text/event-stream");
      expect(bus.businessId).toBe(businessId);
      expect(output.join("")).not.toContain("event: connected");
      bus.ready!();
      expect(output.join("")).toContain("event: connected");
      expect((await request(app).get("/settings")).status).toBe(403);
    } finally { controller.abort(); }
  });

  it("pushes a committed entry to both open staff sessions without a polling wait", async () => {
    output.length = 0;
    const one = new AbortController();
    const two = new AbortController();
    try {
      await fetch(`${base}/events`, { signal: one.signal }); bus.ready!();
      await fetch(`${base}/events`, { signal: two.signal }); bus.ready!();
      const saved = await request(app).post(`/parties/${assignedId}/ledger-entries`)
        .send({ type: "YOU_GAVE", amount: 100, description: "Two-session live test" });
      expect(saved.status, saved.text).toBe(201);
      await vi.waitFor(() => expect(output.filter((chunk) => chunk.includes("event: ledger.created"))).toHaveLength(2));
      const [party] = await db.select().from(partiesTable).where(eq(partiesTable.id, assignedId));
      expect(Number(party!.currentBalance)).toBe(100);
    } finally { one.abort(); two.abort(); }
  });

  it("delivers assigned-party changes, hides private events, and stops after access revocation", async () => {
    output.length = 0;
    bus.unsubscribe.mockClear();
    const controller = new AbortController();
    try {
      await fetch(`${base}/events`, { signal: controller.signal });
      bus.ready!();
      bus.handler!({ type: "ledger.created", payload: { partyId: assignedId, entryId: "entry", confidential: "owner-only" } });
      await vi.waitFor(() => expect(output.join("")).toContain("event: ledger.created"));
      expect(output.join("")).toContain(assignedId);
      expect(output.join("")).not.toContain("owner-only");
      const before = output.join("");
      bus.handler!({ type: "ledger.created", payload: { partyId: privateId } });
      bus.handler!({ type: "notification.created", payload: { recipientUserId: staffId, text: "private alert" } });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(output.join("")).toBe(before);
      await db.update(appUsersTable).set({ status: "suspended" }).where(eq(appUsersTable.id, staffId));
      bus.handler!({ type: "ledger.updated", payload: { partyId: assignedId } });
      await vi.waitFor(() => expect(bus.unsubscribe).toHaveBeenCalled());
      expect(output.join("")).not.toContain("event: ledger.updated");
    } finally { controller.abort(); }
  });
});
