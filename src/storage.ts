const STORAGE_DIR = Deno.env.get("STORAGE_DIR") ?? "/tmp/e2eshare";

export interface UploadInfo {
  size: number;
  offset: number;
  created: string;
  expiresAt: string;
}

export async function ensureStorageDir(): Promise<void> {
  await Deno.mkdir(STORAGE_DIR, { recursive: true });
}

function uploadDir(id: string): string {
  return `${STORAGE_DIR}/${id}`;
}

function dataPath(id: string): string {
  return `${uploadDir(id)}/data`;
}

function infoPath(id: string): string {
  return `${uploadDir(id)}/info.json`;
}

const MAX_TTL_DAYS = parseInt(Deno.env.get("LINK_TTL_DAYS") ?? "30", 10);

export async function createUpload(
  id: string,
  size: number,
  requestedExpiresAt?: string,
): Promise<void> {
  await Deno.mkdir(uploadDir(id), { recursive: true });
  const now = new Date();
  const maxExpiry = new Date(now.getTime() + MAX_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Every upload ALWAYS gets a time limit — this is the one and only thing the
  // server enforces. Honour a valid client-requested expiry, but clamp it to the
  // server maximum (LINK_TTL_DAYS). Anything missing, malformed, or in the past
  // falls back to the maximum, so a share can never be created without a TTL.
  let expiresAt = maxExpiry;
  if (requestedExpiresAt) {
    const requested = new Date(requestedExpiresAt);
    const valid = !isNaN(requested.getTime());
    if (valid && requested > now && requested < maxExpiry) {
      expiresAt = requested;
    }
  }

  const info: UploadInfo = {
    size,
    offset: 0,
    created: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  await Deno.writeTextFile(infoPath(id), JSON.stringify(info));
  await Deno.writeFile(dataPath(id), new Uint8Array(0));
}

export async function getUploadInfo(id: string): Promise<UploadInfo | null> {
  try {
    return JSON.parse(await Deno.readTextFile(infoPath(id)));
  } catch {
    return null;
  }
}

export async function appendChunk(
  id: string,
  chunk: Uint8Array,
  offset: number,
): Promise<number> {
  const file = await Deno.open(dataPath(id), { write: true });
  try {
    await file.seek(offset, Deno.SeekMode.Start);
    await file.write(chunk);
  } finally {
    file.close();
  }
  const newOffset = offset + chunk.length;
  const info = await getUploadInfo(id);
  if (info) {
    await Deno.writeTextFile(
      infoPath(id),
      JSON.stringify({ ...info, offset: newOffset }),
    );
  }
  return newOffset;
}

export async function deleteUpload(id: string): Promise<boolean> {
  try {
    await Deno.remove(uploadDir(id), { recursive: true });
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

export async function openDataStream(
  id: string,
): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const file = await Deno.open(dataPath(id), { read: true });
    return file.readable;
  } catch {
    return null;
  }
}

export function isComplete(info: UploadInfo): boolean {
  return info.offset >= info.size;
}

export function isValidId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}
