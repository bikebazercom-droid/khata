import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const root = await mkdtemp(path.join(tmpdir(), 'banglakhata-local-storage-'));
const privateDir = path.join(root, 'private');
const publicDir = path.join(root, 'public');
const publicHtmlDir = path.join(root, 'public_html');
process.env.OBJECT_STORAGE_DRIVER = 'local';
process.env.LOCAL_PRIVATE_OBJECT_DIR = privateDir;
process.env.LOCAL_PUBLIC_OBJECT_DIR = publicDir;
process.env.LOCAL_OBJECT_STORAGE_SECRET = 'local-test-secret';
process.env.PUBLIC_API_URL = 'https://helmetbazar.shop';
process.env.PUBLIC_HTML_DIR = publicHtmlDir;
const { ObjectStorageService, ObjectNotFoundError } = await import('./objectStorage');

describe('local object storage driver', () => {
  beforeAll(async () => {
    await mkdir(publicHtmlDir, { recursive: true });
    await writeFile(path.join(root, 'outside.txt'), 'not public');
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it('issues a path-preserving, expiring capability and atomically stores an image', async () => {
    const service = new ObjectStorageService();
    const ticketUrl = await service.getObjectEntityUploadURL({
      businessId: 'business-a', size: 8, contentType: 'image/png',
    });
    const result = await service.putLocalTicket(
      new URL(ticketUrl).searchParams.get('ticket')!,
      Readable.from([Buffer.from([137,80,78,71,13,10,26,10])]),
      { contentType: 'image/png', contentLength: '8' },
    );
    expect(result.objectPath).toMatch(/^\/objects\/uploads\/[0-9a-f-]+$/);
    const file = await service.getObjectEntityFile(result.objectPath);
    const response = await service.downloadObject(file);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toHaveLength(8);
  });

  it('rejects mismatched size, MIME/signature, and path traversal tickets', async () => {
    const service = new ObjectStorageService();
    const url = await service.getObjectEntityUploadURL({ businessId: 'business-a', size: 3, contentType: 'image/png' });
    const token = new URL(url).searchParams.get('ticket')!;
    await expect(service.putLocalTicket(token, Readable.from([Buffer.from('bad')]), {
      contentType: 'image/png', contentLength: '3',
    })).rejects.toThrow(/valid image/);
    await expect(service.getObjectEntityFile('/objects/../outside.txt')).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('deletes safely and rejects a private root under public_html', async () => {
    const service = new ObjectStorageService();
    const url = await service.getObjectEntityUploadURL({ businessId: 'business-a', size: 8, contentType: 'image/png' });
    const token = new URL(url).searchParams.get('ticket')!;
    const { objectPath } = await service.putLocalTicket(token, Readable.from([
      Buffer.from([137,80,78,71,13,10,26,10]),
    ]), { contentType: 'image/png', contentLength: '8' });
    await service.deleteObjectEntity(objectPath);
    await expect(service.getObjectEntityFile(objectPath)).rejects.toBeInstanceOf(ObjectNotFoundError);

    process.env.LOCAL_PRIVATE_OBJECT_DIR = path.join(publicHtmlDir, 'leaked-objects');
    expect(() => new ObjectStorageService()).toThrow(/outside public_html/);
    process.env.LOCAL_PRIVATE_OBJECT_DIR = privateDir;
  });
});