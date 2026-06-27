// Local-filesystem storage backend.
//
// Correct for a SINGLE instance (or multiple instances sharing one volume, e.g.
// a ReadWriteMany PVC). This is the default backend and preserves the original
// behaviour. For autoscaled / multi-instance deployments use the GCS backend.

import {
  computeExpiresAt,
  newUploadInfo,
  type StorageBackend,
  type UploadInfo,
} from "./types.ts";

export function createFsBackend(storageDir: string): StorageBackend {
  const uploadDir = (id: string) => `${storageDir}/${id}`;
  const dataPath = (id: string) => `${uploadDir(id)}/data`;
  const infoPath = (id: string) => `${uploadDir(id)}/info.json`;

  return {
    async ensureReady() {
      await Deno.mkdir(storageDir, { recursive: true });
    },

    async createUpload(id, size, requestedExpiresAt) {
      await Deno.mkdir(uploadDir(id), { recursive: true });
      const info = newUploadInfo(size, computeExpiresAt(requestedExpiresAt));
      await Deno.writeTextFile(infoPath(id), JSON.stringify(info));
      await Deno.writeFile(dataPath(id), new Uint8Array(0));
    },

    async getUploadInfo(id): Promise<UploadInfo | null> {
      try {
        return JSON.parse(await Deno.readTextFile(infoPath(id)));
      } catch {
        return null;
      }
    },

    async appendChunk(id, chunk, offset) {
      const file = await Deno.open(dataPath(id), { write: true });
      try {
        await file.seek(offset, Deno.SeekMode.Start);
        await file.write(chunk);
      } finally {
        file.close();
      }
      const newOffset = offset + chunk.length;
      const info = await this.getUploadInfo(id);
      if (info) {
        await Deno.writeTextFile(
          infoPath(id),
          JSON.stringify({ ...info, offset: newOffset }),
        );
      }
      return newOffset;
    },

    async deleteUpload(id) {
      try {
        await Deno.remove(uploadDir(id), { recursive: true });
        return true;
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) return false;
        throw err;
      }
    },

    async openDataStream(id): Promise<ReadableStream<Uint8Array> | null> {
      try {
        const file = await Deno.open(dataPath(id), { read: true });
        return file.readable;
      } catch {
        return null;
      }
    },
  };
}
