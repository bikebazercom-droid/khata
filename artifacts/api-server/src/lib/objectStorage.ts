import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { File, Storage } from '@google-cloud/storage';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';
const LOCAL_DRIVER = process.env.OBJECT_STORAGE_DRIVER === 'local';
const LOCAL_TICKET_TTL_SECONDS = 900;
const MAX_LOCAL_UPLOAD_BYTES = 20 * 1024 * 1024;
const BILL_ATTACHMENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/octet-stream',
]);

export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: 'json',
        subject_token_field_name: 'access_token',
      },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

type LocalMetadata = { contentType: string; size: number };
export type LocalObjectFile = {
  kind: 'local';
  absolutePath: string;
  metadata: LocalMetadata;
};

export class ObjectStorageService {
  private readonly localRoot: string | null;
  private readonly localPublicRoot: string | null;

  constructor() {
    this.localRoot = LOCAL_DRIVER ? validateLocalRoot(process.env.LOCAL_PRIVATE_OBJECT_DIR, true) : null;
    this.localPublicRoot = LOCAL_DRIVER
      ? validateLocalRoot(process.env.LOCAL_PUBLIC_OBJECT_DIR, false)
      : null;
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          'tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    if (LOCAL_DRIVER) {
      if (!this.localPublicRoot) return null;
      const absolutePath = confinedPath(this.localPublicRoot, filePath);
      try {
        const realRoot = await realpath(this.localPublicRoot);
        const realFile = await realpath(absolutePath);
        if (!realFile.startsWith(`${realRoot}${path.sep}`)) return null;
        const info = await stat(realFile);
        if (!info.isFile()) return null;
        return { kind: 'local', absolutePath: realFile, metadata: {
          contentType: contentTypeFor(filePath), size: info.size,
        } } as unknown as File;
      } catch { return null; }
    }
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File | LocalObjectFile,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    if (isLocalFile(file)) {
      const nodeStream = createReadStream(file.absolutePath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;
      return new Response(webStream, { headers: {
        'Content-Type': file.metadata.contentType,
        'Content-Length': String(file.metadata.size),
        'Cache-Control': `private, max-age=${cacheTtlSec}`,
      } });
    }
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(options?: {
    businessId?: string; size?: number; contentType?: string;
  }): Promise<string> {
    const contentType = (options?.contentType ?? '').toLowerCase();
    if (!BILL_ATTACHMENT_TYPES.has(contentType)) throw new Error('Unsupported attachment content type');
    if (LOCAL_DRIVER) {
      if (!this.localRoot) throw new Error('LOCAL_PRIVATE_OBJECT_DIR is not configured');
      const size = options?.size;
      const businessId = options?.businessId ?? '';
      if (!Number.isSafeInteger(size) || !size || size < 1 || size > MAX_LOCAL_UPLOAD_BYTES) {
        throw new Error(`Upload size must be between 1 and ${MAX_LOCAL_UPLOAD_BYTES} bytes`);
      }
      if (!businessId) throw new Error('Business ID is required for local uploads');
      const objectPath = `/objects/uploads/${randomUUID()}`;
      const payload = {
        businessId,
        objectPath, size,
        contentType,
        expiresAt: Date.now() + LOCAL_TICKET_TTL_SECONDS * 1000,
      };
      return `${this.getLocalUploadEndpoint()}?ticket=${encodeURIComponent(signLocalTicket(payload))}`;
    }
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    if (LOCAL_DRIVER) {
      if (!this.localRoot) throw new Error('LOCAL_PRIVATE_OBJECT_DIR is not configured');
      const relative = objectPath.slice('/objects/'.length);
      try {
        const absolutePath = confinedPath(this.localRoot, relative);
        const realRoot = realpathSync(this.localRoot);
        const realFile = await realpath(absolutePath);
        if (!realFile.startsWith(`${realRoot}${path.sep}`)) throw new Error('Object path escapes storage root');
        const info = await stat(absolutePath);
        if (!info.isFile()) throw new Error();
        let metadata = { contentType: contentTypeFor(realFile), size: info.size };
        try {
          metadata = JSON.parse(await readFile(`${realFile}.meta.json`, 'utf8')) as typeof metadata;
        } catch { /* legacy files use extension inference */ }
        return { kind: 'local', absolutePath: realFile, metadata: {
          contentType: metadata.contentType, size: metadata.size,
        } } as unknown as File;
      } catch { throw new ObjectNotFoundError(); }
    }
    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (LOCAL_DRIVER) {
      const ticket = this.getLocalUploadToken(rawPath);
      return ticket ? verifyLocalTicket(ticket).objectPath : rawPath;
    }
    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  getLocalUploadToken(uploadURL: string): string | undefined {
    if (!LOCAL_DRIVER) return undefined;
    return new URL(uploadURL, this.getLocalUploadEndpoint()).searchParams.get('ticket') ?? undefined;
  }

  getLocalUploadEndpoint(): string {
    const configuredUrl = process.env.PUBLIC_API_URL;
    if (!configuredUrl) throw new Error('PUBLIC_API_URL is required when local object storage is enabled');
    const parsed = new URL(configuredUrl);
    if (
      parsed.username || parsed.password || parsed.pathname !== '/' ||
      parsed.search || parsed.hash ||
      (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')
    ) {
      throw new Error('PUBLIC_API_URL must be an origin URL (HTTPS in production)');
    }
    return `${parsed.origin}/api/storage/uploads/put`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  /**
   * Delete an object entity from storage by its normalized path (e.g.
   * `/objects/uploads/<uuid>`). Resolves silently if the object does not exist.
   * Throws for any other storage error.
   */
  async deleteObjectEntity(objectPath: string): Promise<void> {
    if (!objectPath.startsWith('/objects/')) {
      return;
    }

    if (LOCAL_DRIVER) {
      if (!this.localRoot) return;
      const absolutePath = confinedPath(this.localRoot, objectPath.slice('/objects/'.length));
      try {
        const realRoot = realpathSync(this.localRoot);
        const realFile = await realpath(absolutePath);
        if (!realFile.startsWith(`${realRoot}${path.sep}`)) throw new Error('Object path escapes storage root');
        await rm(realFile, { force: true });
        await rm(`${realFile}.meta.json`, { force: true });
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
      }
      return;
    }
    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      return;
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);

    try {
      await objectFile.delete();
    } catch (err: unknown) {
      // GCS returns a 404-style error when the object is already gone — treat
      // that as success so a double-delete doesn't surface as a failure.
      const code = (err as { code?: number })?.code;
      if (code === 404) {
        return;
      }
      throw err;
    }
  }

  async putLocalTicket(ticket: string, req: NodeJS.ReadableStream, headers: {
    contentType?: string; contentLength?: string;
  }): Promise<{ objectPath: string; size: number }> {
    if (!LOCAL_DRIVER || !this.localRoot) throw new Error('Local storage driver is not enabled');
    const payload = verifyLocalTicket(ticket);
    if (
      !payload.businessId ||
      !Number.isSafeInteger(payload.size) ||
      payload.size < 1 ||
      payload.size > MAX_LOCAL_UPLOAD_BYTES
    ) {
      throw new Error('Invalid upload ticket');
    }
    if (!BILL_ATTACHMENT_TYPES.has(payload.contentType) || headers.contentType !== payload.contentType) {
      throw new Error('Content-Type does not match upload ticket');
    }
    if (headers.contentLength !== undefined && Number(headers.contentLength) !== payload.size) {
      throw new Error('Content-Length does not match upload ticket');
    }
    const destination = confinedPath(this.localRoot, payload.objectPath.slice('/objects/'.length));
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const realRoot = realpathSync(this.localRoot);
    const realParent = await realpath(path.dirname(destination));
    if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error('Object path escapes storage root');
    }
    const temp = `${destination}.upload-${randomUUID()}`;
    let bytes = 0;
    const output = createWriteStream(temp, { flags: 'wx', mode: 0o600 });
    try {
      for await (const chunk of req as AsyncIterable<Buffer>) {
        bytes += chunk.length;
        if (bytes > payload.size) throw new Error('Upload exceeds ticket size');
        if (!output.write(chunk)) await onceDrain(output);
      }
      await new Promise<void>((resolve, reject) => { output.end(() => resolve()); output.on('error', reject); });
      if (bytes !== payload.size) throw new Error('Upload size does not match ticket');
      const signature = await readFile(temp, { encoding: null }).then(buffer => buffer.subarray(0, 16));
      if (!validImageSignature(payload.contentType, signature)) throw new Error('Uploaded bytes are not a valid image');
      await rename(temp, destination);
      await writeMetadata(destination, { contentType: payload.contentType, size: bytes });
      return { objectPath: payload.objectPath, size: bytes };
    } catch (err) {
      output.destroy();
      await rm(temp, { force: true }).catch(() => undefined);
      throw err;
    }
  }
}

function isLocalFile(file: File | LocalObjectFile): file is LocalObjectFile {
  return (file as LocalObjectFile).kind === 'local';
}
function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' :
    ext === '.gif' ? 'image/gif' : 'image/jpeg';
}
async function writeMetadata(filePath: string, metadata: LocalMetadata): Promise<void> {
  const temp = `${filePath}.meta-${randomUUID()}`;
  await writeFile(temp, JSON.stringify(metadata), { mode: 0o600 });
  await rename(temp, `${filePath}.meta.json`);
}
function validateLocalRoot(raw: string | undefined, required: boolean): string | null {
  if (!raw) { if (required) throw new Error('LOCAL_PRIVATE_OBJECT_DIR is required'); return null; }
  if (!path.isAbsolute(raw)) throw new Error('Object storage directories must be absolute paths');
  const resolved = path.resolve(raw);
  if (required) {
    const publicHtmlValue = process.env.PUBLIC_HTML_DIR;
    if (!publicHtmlValue || !path.isAbsolute(publicHtmlValue)) {
      throw new Error('PUBLIC_HTML_DIR must be an absolute path when local private storage is enabled');
    }
    const publicHtml = path.resolve(publicHtmlValue);
    if (!existsSync(publicHtml)) throw new Error('PUBLIC_HTML_DIR must exist before local private storage starts');
    const publicHtmlReal = realpathSync(publicHtml);

    let existingPath = resolved;
    while (!existsSync(existingPath)) {
      const parent = path.dirname(existingPath);
      if (parent === existingPath) throw new Error('Unable to resolve local object storage path');
      existingPath = parent;
    }
    if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) {
      throw new Error('Storage root must not be a symlink');
    }
    const existingReal = realpathSync(existingPath);
    const resolvedReal = path.resolve(existingReal, path.relative(existingPath, resolved));
    if (resolvedReal === publicHtmlReal || resolvedReal.startsWith(`${publicHtmlReal}${path.sep}`)) {
      throw new Error('LOCAL_PRIVATE_OBJECT_DIR must be outside public_html');
    }
  }
  return resolved;
}
function confinedPath(root: string, relative: string): string {
  if (relative.includes('\0')) throw new Error('Invalid object path');
  const resolved = path.resolve(root, relative.replace(/^\/+/, ''));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Object path escapes storage root');
  return resolved;
}
type LocalTicket = { businessId: string; objectPath: string; size: number; contentType: string; expiresAt: number };
function ticketSecret(): string {
  const secret = process.env.LOCAL_OBJECT_STORAGE_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error('LOCAL_OBJECT_STORAGE_SECRET (or SESSION_SECRET) is required');
  return secret;
}
function signLocalTicket(payload: LocalTicket): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', ticketSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyLocalTicket(token: string): LocalTicket {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw new Error('Invalid upload ticket');
  const expected = createHmac('sha256', ticketSecret()).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid upload ticket');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as LocalTicket;
  if (payload.expiresAt <= Date.now() || !payload.objectPath.startsWith('/objects/uploads/')) throw new Error('Expired upload ticket');
  return payload;
}
function onceDrain(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise(resolve => stream.once('drain', resolve));
}
function validImageSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.length >= 8 &&
    Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (contentType === 'image/gif') return Buffer.from(bytes.subarray(0, 6)).toString() === 'GIF87a' ||
    Buffer.from(bytes.subarray(0, 6)).toString() === 'GIF89a';
  if (contentType === 'image/webp') return Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP';
  return false;
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}
