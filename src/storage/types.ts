// Storage backend abstraction.
//
// SecureShare uses TUS resumable uploads: a POST creates an upload, successive
// PATCHes append chunks at increasing offsets, GET streams the bytes back, HEAD
// reports the current offset, DELETE removes it. The original implementation
// kept this state on local disk, which silently breaks behind a load balancer:
// the POST lands on one instance and a later PATCH on another, which has never
// heard of that upload id and returns 404. A shared backend (e.g. GCS) fixes it.

export interface UploadInfo {
  size: number;
  offset: number;
  created: string;
  expiresAt: string;
  // Backend-specific opaque field (e.g. a GCS resumable session URI). Never
  // exposed to clients — only the owning backend reads it.
  backendRef?: string;
}

export interface StorageBackend {
  // Called once at startup. Validate configuration / create directories.
  ensureReady(): Promise<void>;
  createUpload(id: string, size: number, requestedExpiresAt?: string): Promise<void>;
  getUploadInfo(id: string): Promise<UploadInfo | null>;
  // Append `chunk` at `offset`; returns the new offset. Implementations may
  // trust their own durable offset over the caller's when the two disagree.
  appendChunk(id: string, chunk: Uint8Array, offset: number): Promise<number>;
  deleteUpload(id: string): Promise<boolean>;
  openDataStream(id: string): Promise<ReadableStream<Uint8Array> | null>;
}

export function isComplete(info: UploadInfo): boolean {
  return info.offset >= info.size;
}

export function isValidId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}

const MAX_TTL_DAYS = parseInt(Deno.env.get("LINK_TTL_DAYS") ?? "30", 10);

// Every upload ALWAYS gets a time limit — the one thing the server enforces.
// Honour a valid client-requested expiry, but clamp it to the server maximum.
// Anything missing, malformed, or in the past falls back to the maximum, so a
// share can never be created without a TTL. Shared by all backends.
export function computeExpiresAt(requestedExpiresAt?: string): string {
  const now = new Date();
  const days = Number.isFinite(MAX_TTL_DAYS) && MAX_TTL_DAYS > 0 ? MAX_TTL_DAYS : 30;
  const maxExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  let expiresAt = maxExpiry;
  if (requestedExpiresAt) {
    const requested = new Date(requestedExpiresAt);
    const valid = !isNaN(requested.getTime());
    if (valid && requested > now && requested < maxExpiry) {
      expiresAt = requested;
    }
  }
  return expiresAt.toISOString();
}

export function newUploadInfo(size: number, expiresAt: string, backendRef?: string): UploadInfo {
  return {
    size,
    offset: 0,
    created: new Date().toISOString(),
    expiresAt,
    ...(backendRef !== undefined ? { backendRef } : {}),
  };
}
