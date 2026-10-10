import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '@workspace/db';
import {
  businessesTable,
  ledgerRequestReceiptsTable,
  ledgerEntriesTable,
  partiesTable,
} from '@workspace/db';
import type { AuthenticatedRequest } from '../middlewares/requireAuth';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;
const testDb = pool ? drizzle(pool, { schema }) : null;
const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

let tempRoot: string | undefined;
let businessId = '';
let sourcePartyId = '';
let counterpartyId = '';
let storageRouter: typeof import('./storage').default;
let localUploadRouter: typeof import('./storage').localUploadRouter;
let partiesRouter: typeof import('./parties').default;

const previousStorageEnv = {
  driver: process.env.OBJECT_STORAGE_DRIVER,
  privateDir: process.env.LOCAL_PRIVATE_OBJECT_DIR,
  publicDir: process.env.LOCAL_PUBLIC_OBJECT_DIR,
  publicHtmlDir: process.env.PUBLIC_HTML_DIR,
  secret: process.env.LOCAL_OBJECT_STORAGE_SECRET,
  apiUrl: process.env.PUBLIC_API_URL,
};

function dbForTest() {
  if (!testDb) throw new Error('DATABASE_URL is required for the storage integration test');
  return testDb;
}

function appForBusiness(authenticatedBusinessId: string) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const authenticated = req as AuthenticatedRequest;
    authenticated.businessId = authenticatedBusinessId;
    authenticated.userId = 'integration-test-owner';
    authenticated.role = 'owner';
    next();
  });
  app.use('/api', localUploadRouter);
  app.use('/api', storageRouter);
  app.use('/api', partiesRouter);
  return app;
}

describe.skipIf(!databaseUrl)('offline transfer bill-image storage integration', () => {
  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'banglakhata-storage-route-'));
    process.env.OBJECT_STORAGE_DRIVER = 'local';
    process.env.LOCAL_PRIVATE_OBJECT_DIR = path.join(tempRoot, 'private');
    process.env.LOCAL_PUBLIC_OBJECT_DIR = path.join(tempRoot, 'public');
    process.env.PUBLIC_HTML_DIR = path.join(tempRoot, 'public_html');
    process.env.LOCAL_OBJECT_STORAGE_SECRET = 'integration-test-only-secret';
    process.env.PUBLIC_API_URL = 'http://127.0.0.1';
    await mkdir(process.env.PUBLIC_HTML_DIR, { recursive: true });

    // Import after configuring the local driver because the service selects
    // its backend once, when the storage routes are loaded.
    const storage = await import('./storage');
    storageRouter = storage.default;
    localUploadRouter = storage.localUploadRouter;
    partiesRouter = (await import('./parties')).default;

    const db = dbForTest();
    const [business] = await db.insert(businessesTable)
      .values({ name: 'Storage integration test' })
      .returning();
    businessId = business!.id;
    const parties = await db.insert(partiesTable).values([
      { businessId, name: 'Source party', phone: '', role: 'CUSTOMER' },
      { businessId, name: 'Counterparty', phone: '', role: 'CUSTOMER' },
    ]).returning();
    sourcePartyId = parties[0]!.id;
    counterpartyId = parties[1]!.id;
  }, 30_000);

  afterAll(async () => {
    if (testDb && businessId) {
      await testDb.delete(ledgerEntriesTable)
        .where(inArray(ledgerEntriesTable.partyId, [sourcePartyId, counterpartyId]));
      await testDb.delete(ledgerRequestReceiptsTable)
        .where(eq(ledgerRequestReceiptsTable.businessId, businessId));
      await testDb.delete(partiesTable).where(eq(partiesTable.businessId, businessId));
      await testDb.delete(businessesTable).where(eq(businessesTable.id, businessId));
    }
    await pool?.end();
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    if (previousStorageEnv.driver === undefined) delete process.env.OBJECT_STORAGE_DRIVER;
    else process.env.OBJECT_STORAGE_DRIVER = previousStorageEnv.driver;
    if (previousStorageEnv.privateDir === undefined) delete process.env.LOCAL_PRIVATE_OBJECT_DIR;
    else process.env.LOCAL_PRIVATE_OBJECT_DIR = previousStorageEnv.privateDir;
    if (previousStorageEnv.publicDir === undefined) delete process.env.LOCAL_PUBLIC_OBJECT_DIR;
    else process.env.LOCAL_PUBLIC_OBJECT_DIR = previousStorageEnv.publicDir;
    if (previousStorageEnv.publicHtmlDir === undefined) delete process.env.PUBLIC_HTML_DIR;
    else process.env.PUBLIC_HTML_DIR = previousStorageEnv.publicHtmlDir;
    if (previousStorageEnv.secret === undefined) delete process.env.LOCAL_OBJECT_STORAGE_SECRET;
    else process.env.LOCAL_OBJECT_STORAGE_SECRET = previousStorageEnv.secret;
    if (previousStorageEnv.apiUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousStorageEnv.apiUrl;
  }, 30_000);

  it('uploads a synced transfer photo, serves it after a fresh request, and keeps the counterparty attachment-free', async () => {
    const app = appForBusiness(businessId);
    const uploadedUrl = await request(app)
      .post('/api/storage/uploads/request-url')
      .send({ name: 'bill.png', size: pngBytes.length, contentType: 'image/png' })
      .expect(200);
    expect(uploadedUrl.body.objectPath).toMatch(/^\/objects\/uploads\//);
    expect(uploadedUrl.body.uploadToken).toBeTruthy();

    await request(app)
      .put('/api/storage/uploads/put')
      .set('Authorization', `Bearer ${uploadedUrl.body.uploadToken}`)
      .set('Content-Type', 'image/png')
      .send(pngBytes)
      .expect(200)
      .expect(({ body }) => expect(body.objectPath).toBe(uploadedUrl.body.objectPath));

    const db = dbForTest();
    const transferRequest = {
      type: 'YOU_GAVE',
      amount: 50,
      description: 'Offline transfer with bill photo',
      billImage: uploadedUrl.body.objectPath,
      isTransfer: true,
      transferPartyId: counterpartyId,
      clientRequestId: '00000000-0000-4000-8000-000000000099',
    };
    const createdTransfer = await request(app)
      .post(`/api/parties/${sourcePartyId}/ledger-entries`)
      .send(transferRequest);
    expect(createdTransfer.status, JSON.stringify(createdTransfer.body)).toBe(201);
    expect(createdTransfer.body.linkedEntryId).toBeTruthy();

    // Replaying the same queued request after a lost response must reuse the
    // transaction receipt and retain its already-uploaded object path.
    const replay = await request(app)
      .post(`/api/parties/${sourcePartyId}/ledger-entries`)
      .send(transferRequest)
      .expect(200);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(replay.body.id).toBe(createdTransfer.body.id);

    const syncedRows = await db.select().from(ledgerEntriesTable)
      .where(inArray(ledgerEntriesTable.partyId, [sourcePartyId, counterpartyId]));
    expect(syncedRows).toHaveLength(2);
    expect(syncedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ partyId: sourcePartyId, billImage: uploadedUrl.body.objectPath }),
      expect.objectContaining({ partyId: counterpartyId, billImage: null }),
    ]));

    const sourceLedger = await request(app)
      .get(`/api/parties/${sourcePartyId}/ledger-entries`)
      .expect(200);
    const counterpartyLedger = await request(app)
      .get(`/api/parties/${counterpartyId}/ledger-entries`)
      .expect(200);
    expect(sourceLedger.body[0].billImage).toBe(uploadedUrl.body.objectPath);
    expect(counterpartyLedger.body[0].billImage).toBeNull();

    const sourceAttachmentUrl = `/api/storage${uploadedUrl.body.objectPath}`;
    const firstView = await request(app).get(sourceAttachmentUrl).expect(200);
    expect(firstView.headers['content-type']).toContain('image/png');
    expect(firstView.headers['content-disposition']).toMatch(/^inline;/);
    expect(Buffer.from(firstView.body)).toEqual(pngBytes);

    // A second request models viewing the synced ledger again after app reload.
    const afterReload = await request(app).get(sourceAttachmentUrl).expect(200);
    expect(Buffer.from(afterReload.body)).toEqual(pngBytes);

    const rows = await db.select({
      partyId: ledgerEntriesTable.partyId,
      billImage: ledgerEntriesTable.billImage,
    }).from(ledgerEntriesTable)
      .where(inArray(ledgerEntriesTable.partyId, [sourcePartyId, counterpartyId]));
    expect(rows).toEqual(expect.arrayContaining([
      { partyId: sourcePartyId, billImage: uploadedUrl.body.objectPath },
      { partyId: counterpartyId, billImage: null },
    ]));

    // A valid local object path still cannot be read in another tenant context.
    await request(appForBusiness('00000000-0000-4000-8000-000000000002'))
      .get(sourceAttachmentUrl)
      .expect(403);
  }, 30_000);
});
