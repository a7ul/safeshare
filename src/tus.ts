import { Hono } from "npm:hono@4";
import {
  appendChunk,
  createUpload,
  getUploadInfo,
  isComplete,
  isValidId,
} from "./storage.ts";

const TUS_VERSION = "1.0.0";
const MAX_SIZE = 500 * 1024 * 1024; // 500 MB

function parseTusMetadata(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of header.split(",")) {
    const [key, b64] = pair.trim().split(" ");
    if (key && b64) {
      try {
        result[key] = atob(b64);
      } catch { /* ignore malformed entries */ }
    }
  }
  return result;
}

export function createTusRouter(): Hono {
  const router = new Hono();

  router.options("/", (c) =>
    c.newResponse(null, 204, tusHeaders({ maxSize: MAX_SIZE })));

  router.options("/:id", (c) =>
    c.newResponse(null, 204, tusHeaders({ maxSize: MAX_SIZE })));

  // Create upload
  router.post("/", async (c) => {
    const lengthHeader = c.req.header("Upload-Length");
    if (!lengthHeader) return c.text("Missing Upload-Length", 400);

    const size = parseInt(lengthHeader, 10);
    if (isNaN(size) || size < 0 || size > MAX_SIZE) {
      return c.text("Invalid Upload-Length", 400);
    }

    const metaHeader = c.req.header("Upload-Metadata") ?? "";
    const meta = metaHeader ? parseTusMetadata(metaHeader) : {};
    const requestedExpiresAt = meta["expires-at"] ?? undefined;

    const id = crypto.randomUUID();
    await createUpload(id, size, requestedExpiresAt);

    return c.newResponse(null, 201, {
      ...tusHeaders(),
      Location: `/upload/${id}`,
    });
  });

  // Check offset
  router.on("HEAD", "/:id", async (c) => {
    const id = c.req.param("id");
    if (!isValidId(id)) return c.text("Not Found", 404);

    const info = await getUploadInfo(id);
    if (!info) return c.text("Not Found", 404);

    return c.newResponse(null, 200, {
      ...tusHeaders(),
      "Upload-Offset": String(info.offset),
      "Upload-Length": String(info.size),
      "Cache-Control": "no-store",
    });
  });

  // Upload chunk
  router.patch("/:id", async (c) => {
    const id = c.req.param("id");
    if (!isValidId(id)) return c.text("Not Found", 404);

    const info = await getUploadInfo(id);
    if (!info) return c.text("Not Found", 404);
    if (isComplete(info)) return c.text("Upload already complete", 409);

    const contentType = c.req.header("Content-Type") ?? "";
    if (!contentType.includes("application/offset+octet-stream")) {
      return c.text("Invalid Content-Type", 415);
    }

    const offsetHeader = c.req.header("Upload-Offset");
    if (!offsetHeader) return c.text("Missing Upload-Offset", 400);

    const offset = parseInt(offsetHeader, 10);
    if (isNaN(offset) || offset !== info.offset) {
      return c.text("Offset conflict", 409);
    }

    const body = await c.req.arrayBuffer();
    const newOffset = await appendChunk(id, new Uint8Array(body), offset);

    return c.newResponse(null, 204, {
      ...tusHeaders(),
      "Upload-Offset": String(newOffset),
    });
  });

  return router;
}

function tusHeaders(opts: { maxSize?: number } = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "Tus-Resumable": TUS_VERSION,
    "Tus-Version": TUS_VERSION,
    "Tus-Extension": "creation",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Upload-Length, Upload-Offset, Tus-Resumable, Upload-Metadata",
    "Access-Control-Expose-Headers":
      "Location, Upload-Offset, Upload-Length, Tus-Version, Tus-Resumable, Tus-Max-Size, Tus-Extension",
  };
  if (opts.maxSize !== undefined) {
    headers["Tus-Max-Size"] = String(opts.maxSize);
  }
  return headers;
}
