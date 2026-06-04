import { Hono } from "npm:hono@4";
import { cors } from "npm:hono@4/cors";
import { createTusRouter } from "./src/tus.ts";
import {
  ensureStorageDir,
  getUploadInfo,
  isComplete,
  isValidId,
  openDataStream,
} from "./src/storage.ts";

await ensureStorageDir();

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Upload-Length",
      "Upload-Offset",
      "Tus-Resumable",
      "Upload-Metadata",
    ],
    exposeHeaders: [
      "Location",
      "Upload-Offset",
      "Upload-Length",
      "Tus-Version",
      "Tus-Resumable",
      "Tus-Max-Size",
      "Tus-Extension",
    ],
  }),
);

// Runtime config (logo URL, etc.)
app.get("/api/config", (c) => {
  return c.json({
    logoUrl: Deno.env.get("LOGO_URL") ?? null,
    title: Deno.env.get("TITLE") ?? null,
  });
});

// TUS upload endpoints
app.route("/upload", createTusRouter());

// File metadata (expiry info) — safe to expose, no plaintext content
app.get("/api/meta/:id", async (c) => {
  const id = c.req.param("id");
  if (!isValidId(id)) return c.json({ error: "Not Found" }, 404);

  const info = await getUploadInfo(id);
  if (!info) return c.json({ error: "Not Found" }, 404);

  return c.json({ expiresAt: info.expiresAt ?? null });
});

// Download endpoint — returns raw encrypted bytes
app.get("/api/files/:id", async (c) => {
  const id = c.req.param("id");
  if (!isValidId(id)) return c.text("Not Found", 404);

  const info = await getUploadInfo(id);
  if (!info) return c.text("Not Found", 404);
  if (!isComplete(info)) return c.text("Upload incomplete", 409);

  if (info.expiresAt && new Date(info.expiresAt) < new Date()) {
    return c.text("Link expired", 410);
  }

  const stream = await openDataStream(id);
  if (!stream) return c.text("Not Found", 404);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(info.size),
      "Cache-Control": "no-store",
    },
  });
});

// Static file middleware for built frontend
const DIST = "./frontend/dist";
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  json: "application/json",
};

app.use("/*", async (c, next) => {
  const url = new URL(c.req.url);
  // Strip query/fragment; collapse repeated slashes; block path traversal
  const parts = url.pathname.split("/").filter((p) => p !== ".." && p !== ".");
  const rel = parts.join("/") || "/";
  const filePath = `${DIST}/${rel}`.replace(/\/+/g, "/");

  try {
    const stat = await Deno.stat(filePath);
    const target = stat.isDirectory ? `${filePath}/index.html` : filePath;
    const ext = target.split(".").pop() ?? "";
    const file = await Deno.open(target, { read: true });
    return new Response(file.readable, {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
    });
  } catch {
    return next();
  }
});

// SPA fallback
app.get("*", async (c) => {
  try {
    const html = await Deno.readTextFile(`${DIST}/index.html`);
    return c.html(html);
  } catch {
    return c.text("Frontend not built. Run: deno task build-frontend", 503);
  }
});

const port = parseInt(Deno.env.get("PORT") ?? "8000", 10);
console.log(`SecureShare → http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
