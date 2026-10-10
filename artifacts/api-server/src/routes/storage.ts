import { Readable } from 'stream';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db, ledgerEntriesTable, partiesTable } from '@workspace/db';

import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';
import { type AuthenticatedRequest } from '../middlewares/requireAuth';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Auth is enforced by the requireAuth middleware applied before this router
 * in routes/index.ts — no per-route check needed here.
 */
router.post(
  '/storage/uploads/request-url',
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;

      const { businessId } = req as AuthenticatedRequest;
      const uploadURL = await objectStorageService.getObjectEntityUploadURL({
        businessId, size, contentType,
      });
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);
      const uploadToken = objectStorageService.getLocalUploadToken(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL: uploadToken
            ? objectStorageService.getLocalUploadEndpoint()
            : uploadURL,
          objectPath,
          ...(uploadToken ? { uploadToken } : {}),
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile =
      await objectStorageService.getObjectEntityFile(objectPath);

    // Enforce per-object ownership: verify the requested object is referenced
    // by a ledger entry that belongs to the authenticated user's business.
    // This prevents any authenticated user from fetching another tenant's
    // bill images by guessing or enumerating object paths.
    const { businessId } = req as AuthenticatedRequest;
    const [ownerEntry] = await db
      .select({ id: ledgerEntriesTable.id })
      .from(ledgerEntriesTable)
      .innerJoin(
        partiesTable,
        eq(ledgerEntriesTable.partyId, partiesTable.id),
      )
      .where(
        and(
          eq(ledgerEntriesTable.billImage, objectPath),
          eq(partiesTable.businessId, businessId),
        ),
      )
      .limit(1);

    if (!ownerEntry) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/pdf') {
      res.setHeader('Content-Disposition', 'inline; filename="attachment.pdf"');
    }

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;

/**
 * Local-disk PUT capability endpoint. This is deliberately exported separately
 * so routes/index mounts it before requireAuth: the signed ticket is the
 * authentication capability for the direct file PUT, matching GCS presigned
 * uploads and keeping existing clients free of an Authorization header.
 */
export const localUploadRouter: IRouter = Router();
localUploadRouter.put('/storage/uploads/put', async (req: Request, res: Response) => {
  const authorization = req.header('authorization') ?? '';
  const ticket = /^Bearer\s+([A-Za-z0-9._~-]+)$/i.exec(authorization)?.[1] ?? '';
  if (!ticket) { res.status(400).json({ error: 'Missing upload ticket' }); return; }
  try {
    const result = await objectStorageService.putLocalTicket(ticket, req, {
      contentType: req.header('content-type') ?? undefined,
      contentLength: req.header('content-length') ?? undefined,
    });
    res.status(200).json({ objectPath: result.objectPath });
  } catch (error) {
    req.log.error({ err: error }, 'Error storing local object');
    const message = error instanceof Error ? error.message : '';
    res.status(/ticket|Content|size|escape/i.test(message) ? 400 : 500)
      .json({ error: 'Failed to upload object' });
  }
});
