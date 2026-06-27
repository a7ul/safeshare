// Storage facade.
//
// Selects a storage backend at startup and re-exports the small surface the TUS
// router and HTTP handlers use. Backends are interchangeable:
//
//   STORAGE_BACKEND=fs   (default) — local disk; correct for a single instance
//                                     or a shared ReadWriteMany volume.
//   STORAGE_BACKEND=gcs            — Google Cloud Storage; correct for
//                                     autoscaled / multi-instance deployments.
//
// Keeping the same exported names means tus.ts and main.ts need no changes.

import { createFsBackend } from "./storage/fs.ts";
import { createGcsBackend, readGcsConfig } from "./storage/gcs.ts";
import {
  isComplete,
  isValidId,
  type StorageBackend,
  type UploadInfo,
} from "./storage/types.ts";

export { isComplete, isValidId };
export type { UploadInfo };

function selectBackend(): StorageBackend {
  const kind = (Deno.env.get("STORAGE_BACKEND") ?? "fs").toLowerCase();
  if (kind === "gcs") {
    return createGcsBackend(readGcsConfig());
  }
  const dir = Deno.env.get("STORAGE_DIR") ?? "/tmp/e2eshare";
  return createFsBackend(dir);
}

const backend = selectBackend();

export function ensureStorageDir(): Promise<void> {
  return backend.ensureReady();
}

export function createUpload(
  id: string,
  size: number,
  requestedExpiresAt?: string,
): Promise<void> {
  return backend.createUpload(id, size, requestedExpiresAt);
}

export function getUploadInfo(id: string): Promise<UploadInfo | null> {
  return backend.getUploadInfo(id);
}

export function appendChunk(
  id: string,
  chunk: Uint8Array,
  offset: number,
): Promise<number> {
  return backend.appendChunk(id, chunk, offset);
}

export function deleteUpload(id: string): Promise<boolean> {
  return backend.deleteUpload(id);
}

export function openDataStream(
  id: string,
): Promise<ReadableStream<Uint8Array> | null> {
  return backend.openDataStream(id);
}
