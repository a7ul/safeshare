// Google Cloud Storage backend.
//
// Why this exists: TUS state must be shared across instances. Each TUS upload is
// mapped onto a GCS *resumable upload session*:
//
//   createUpload  → start a GCS resumable session, persist its URI
//   appendChunk   → PUT the chunk to the session URI with a Content-Range
//   openDataStream→ stream the finalized object back
//
// The session URI and the small `*.info` metadata object both live in GCS, so a
// POST on one instance and a later PATCH on another resolve to the same durable
// state — no more cross-instance 404s.
//
// GCS resumable sessions require every non-final chunk to be a multiple of
// 256 KiB. The client uploads 5 MiB chunks (= 20 × 256 KiB), so this holds; the
// final chunk may be any size. A misaligned chunk is rejected by GCS, which the
// TUS layer surfaces as a retryable conflict.

import { getAccessToken } from "./gcs-auth.ts";
import {
  computeExpiresAt,
  newUploadInfo,
  type StorageBackend,
  type UploadInfo,
} from "./types.ts";

const JSON_BASE = "https://storage.googleapis.com/storage/v1/b";
const UPLOAD_BASE = "https://storage.googleapis.com/upload/storage/v1/b";

export interface GcsConfig {
  bucket: string;
  prefix: string;
}

export function readGcsConfig(): GcsConfig {
  const bucket = Deno.env.get("GCS_BUCKET") ?? "";
  const prefix = Deno.env.get("GCS_PREFIX") ?? "secureshare/";
  return { bucket, prefix };
}

// GCS reports received bytes in a Range header like "bytes=0-5242879".
// Returns the next expected offset (last byte + 1), or null if absent.
export function parseRangeOffset(rangeHeader: string | null): number | null {
  if (!rangeHeader) return null;
  const m = rangeHeader.match(/bytes=\d+-(\d+)/);
  if (!m) return null;
  return parseInt(m[1], 10) + 1;
}

export function createGcsBackend(config: GcsConfig): StorageBackend {
  const { bucket, prefix } = config;
  const dataName = (id: string) => `${prefix}${id}`;
  const infoName = (id: string) => `${prefix}${id}.info`;
  const objUrl = (name: string) => `${JSON_BASE}/${bucket}/o/${encodeURIComponent(name)}`;

  async function authHeader(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await getAccessToken()}` };
  }

  async function writeInfo(id: string, info: UploadInfo): Promise<void> {
    const res = await fetch(
      `${UPLOAD_BASE}/${bucket}/o?uploadType=media&name=${encodeURIComponent(infoName(id))}`,
      {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify(info),
      },
    );
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`GCS info write failed (${res.status}): ${detail.slice(0, 200)}`);
    }
  }

  const backend: StorageBackend = {
    async ensureReady() {
      if (!bucket) {
        throw new Error(
          "STORAGE_BACKEND=gcs requires GCS_BUCKET to be set to a bucket name.",
        );
      }
    },

    async createUpload(id, size, requestedExpiresAt) {
      // Start a resumable session. The Location response header is the session URI.
      const res = await fetch(
        `${UPLOAD_BASE}/${bucket}/o?uploadType=resumable&name=${encodeURIComponent(dataName(id))}`,
        {
          method: "POST",
          headers: {
            ...(await authHeader()),
            "Content-Length": "0",
            "X-Upload-Content-Type": "application/octet-stream",
            "X-Upload-Content-Length": String(size),
          },
        },
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `GCS resumable session start failed (${res.status}): ${detail.slice(0, 200)}`,
        );
      }
      await res.body?.cancel();
      const sessionUri = res.headers.get("Location");
      if (!sessionUri) throw new Error("GCS did not return a resumable session URI.");

      const info = newUploadInfo(size, computeExpiresAt(requestedExpiresAt), sessionUri);
      await writeInfo(id, info);
    },

    async getUploadInfo(id): Promise<UploadInfo | null> {
      const res = await fetch(`${objUrl(infoName(id))}?alt=media`, {
        headers: await authHeader(),
      });
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`GCS info read failed (${res.status}).`);
      }
      return (await res.json()) as UploadInfo;
    },

    async appendChunk(id, chunk, offset) {
      const info = await this.getUploadInfo(id);
      if (!info?.backendRef) {
        throw new Error("Upload session not found.");
      }
      const size = info.size;
      const end = offset + chunk.length - 1;

      // The session URI is self-authorizing — do NOT attach a bearer token here.
      const res = await fetch(info.backendRef, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${offset}-${end}/${size}` },
        body: chunk,
      });

      let newOffset: number;
      if (res.status === 308) {
        // Incomplete: trust GCS's reported offset over the caller's.
        newOffset = parseRangeOffset(res.headers.get("Range")) ?? offset + chunk.length;
        await res.body?.cancel();
      } else if (res.ok) {
        // 200/201: the upload is complete and the object is finalized.
        newOffset = size;
        await res.body?.cancel();
      } else {
        const detail = await res.text();
        throw new Error(`GCS chunk upload failed (${res.status}): ${detail.slice(0, 200)}`);
      }

      await writeInfo(id, { ...info, offset: newOffset });
      return newOffset;
    },

    async deleteUpload(id) {
      const info = await this.getUploadInfo(id).catch(() => null);

      const del = async (name: string) => {
        const res = await fetch(objUrl(name), { method: "DELETE", headers: await authHeader() });
        await res.body?.cancel();
        return res.ok; // 2xx => existed; 404 => did not
      };
      const dataExisted = await del(dataName(id));
      const infoExisted = await del(infoName(id));

      // Best-effort: abort an unfinished resumable session so it doesn't linger.
      if (info?.backendRef && !dataExisted) {
        await fetch(info.backendRef, { method: "DELETE" }).then((r) => r.body?.cancel()).catch(() => {});
      }

      return dataExisted || infoExisted;
    },

    async openDataStream(id): Promise<ReadableStream<Uint8Array> | null> {
      const res = await fetch(`${objUrl(dataName(id))}?alt=media`, {
        headers: await authHeader(),
      });
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel();
        return null;
      }
      return res.body;
    },
  };

  return backend;
}
