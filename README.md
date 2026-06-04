# SecureShare

End-to-end encrypted file and note sharing. Files are encrypted in your browser with AES-256-GCM before a single byte leaves your device. The server stores only ciphertext. The decryption key and passcode live exclusively in the share URL — which browsers never send to the server.

[![CI](https://github.com/a7ul/secureshare/actions/workflows/ci.yml/badge.svg)](https://github.com/a7ul/secureshare/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## How it works

```
Your browser                         Server
--------------------------------------------------
generate AES-256-GCM key
generate random passcode
encrypt(file, key) = ciphertext
wrap(key, pbkdf2(passcode)) = wrapped_key
upload(ciphertext) -----------------> store bytes
                   <----------------- file ID

share URL:  https://host/d/m#base64(manifest)~passcode
                              ^--- NEVER sent to server

recipient reads URL -> fetch(ciphertext) ----------> return bytes
                    <- unwrap(wrapped_key, passcode)
                    <- decrypt(ciphertext, key)
                       save file to disk
```

- All encryption and decryption happen in `frontend/src/lib/crypto.ts` using the **Web Crypto API**. The server has zero crypto code.
- Every share generates a random **AES-256-GCM** file key and a random **passcode**. The file key is wrapped (AES-KW) with a PBKDF2-derived key from the passcode.
- Files upload via the **TUS resumable protocol** — large files survive network interruptions.
- Multiple files are bundled in one link via a manifest in the URL hash.
- **Per-share expiry** (1h / 24h / 7d / 30d) is chosen at upload time, embedded in the manifest, and enforced server-side.

---

## Features

| | |
|---|---|
| AES-256-GCM browser encryption | Server never sees plaintext |
| Passcode-wrapped keys (PBKDF2) | Extra layer — server can't decrypt even with the ciphertext |
| TUS resumable uploads | Up to 500 MB per file |
| Multi-file bundles | One link for multiple files |
| Secure notes | Text encrypted before leaving the browser |
| Per-share expiry | 1 hour, 24 hours, 7 days, 30 days |
| Two share modes | Single unified link, or link + passcode sent separately |
| Configurable branding | Logo and company name via env vars |
| Single binary | No database, cache, or queue needed |
| MIT licensed | |

---

## Running locally

### Prerequisites

- [Deno](https://deno.land) 2.x
- Node.js 20+ and npm (frontend build only)

### Quickstart

```bash
git clone git@github.com:a7ul/secureshare.git
cd secureshare

# Build the React frontend into frontend/dist/
deno task build-frontend

# Start the server
deno task start
```

Open http://localhost:8000.

### With branding

```bash
LOGO_URL="https://example.com/logo.png" \
TITLE="Acme Corp" \
STORAGE_DIR=/var/lib/secureshare \
deno task start
```

The server proxies `LOGO_URL` through `/api/logo` so the image always loads same-origin — no mixed-content warnings, no referrer blocks.

### Hot-reload development

```bash
# Terminal 1 — Deno backend with file watching
deno task dev

# Terminal 2 — Vite frontend dev server with HMR
cd frontend && npm run dev
```

Frontend dev server at http://localhost:5173 proxies `/api` and `/upload` to the Deno backend on `:8000`.

---

## Configuration

All configuration is via environment variables. Every variable has a sane default.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `STORAGE_DIR` | `/tmp/e2eshare` | Directory where encrypted uploads are stored |
| `LINK_TTL_DAYS` | `30` | Maximum days a share link can live (server-side cap) |
| `LOGO_URL` | _(blank)_ | URL of a company logo — proxied through `/api/logo` |
| `TITLE` | _(blank)_ | Company name shown next to the logo |

---

## Compile to a single binary

```bash
# Build frontend first (it gets embedded)
deno task build-frontend

# Compile for the current platform
deno task compile
./secureshare
```

Cross-compile for other platforms:

```bash
deno compile \
  --allow-read --allow-write --allow-net --allow-env \
  --target x86_64-unknown-linux-gnu \
  --output secureshare-linux-x64 \
  main.ts
```

Supported targets: `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`, `x86_64-apple-darwin`, `aarch64-apple-darwin`.

---

## Releases

Pre-built binaries for every platform are attached to each [GitHub release](https://github.com/a7ul/secureshare/releases).

```bash
# Linux x64
curl -L https://github.com/a7ul/secureshare/releases/latest/download/secureshare-linux-x64 \
  -o secureshare && chmod +x secureshare

# macOS Apple Silicon
curl -L https://github.com/a7ul/secureshare/releases/latest/download/secureshare-macos-arm64 \
  -o secureshare && chmod +x secureshare

STORAGE_DIR=/var/lib/secureshare ./secureshare
```

Docker images are published to `ghcr.io/a7ul/secureshare` on every push to `main` and on every release tag.

```bash
docker run -p 8000:8000 -v /data/secureshare:/data \
  -e STORAGE_DIR=/data \
  -e TITLE="Acme Corp" \
  -e LOGO_URL="https://example.com/logo.png" \
  ghcr.io/a7ul/secureshare:latest
```

---

## Deployment recipes

| Platform | Guide |
|---|---|
| Docker | [deploy/docker/README.md](deploy/docker/README.md) |
| Docker Compose | [deploy/docker-compose/README.md](deploy/docker-compose/README.md) |
| Kubernetes (Ingress + HTTPRoute) | [deploy/k8s/README.md](deploy/k8s/README.md) |
| Deno Deploy | [deploy/deno-deploy/README.md](deploy/deno-deploy/README.md) |
| Vercel | [deploy/vercel/README.md](deploy/vercel/README.md) |

### Kubernetes with GCS lifecycle cleanup

Mount a GCS bucket via the Cloud Storage FUSE CSI driver and set an object lifecycle rule to auto-delete after `LINK_TTL_DAYS` days. No cron job needed.

```bash
gcloud storage buckets create gs://my-secureshare --location=US
echo '{"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":7}}]}}' > lc.json
gcloud storage buckets update gs://my-secureshare --lifecycle-file=lc.json
```

See [deploy/k8s/README.md](deploy/k8s/README.md) for the full volume mount spec.

---

## Development

### Project structure

```
secureshare/
  main.ts                      Deno/Hono server — API, logo proxy, static serving
  src/
    tus.ts                     TUS resumable upload handler (reads expiry from metadata)
    storage.ts                 Encrypted blob storage (STORAGE_DIR, TTL capping)
  frontend/
    src/
      pages/
        UploadPage.tsx          / route
        DownloadPage.tsx        /d/:id route
        HowItWorksPage.tsx      /how-it-works route
      components/
        SecureUploader.tsx      Upload UI (expiry picker, always-passcode flow)
        BrandRow.tsx            Logo + company name with onError fallback
      lib/
        crypto.ts               AES-256-GCM encrypt/decrypt, PBKDF2 key derivation,
                                passcode generation, key wrapping — browser only
        manifest.ts             Multi-file manifest encode/decode (v2 with protection field)
        uploader.ts             TUS client wrapper (sends expiry via Upload-Metadata)
        expiry.ts               Expiry formatting
      hooks/
        useConfig.ts            Fetches /api/config (logo + title)
    e2e/
      secureshare.spec.ts       Playwright E2E tests (19 tests)
  deploy/
    docker/                     Dockerfile + instructions
    docker-compose/             docker-compose.yml + instructions
    k8s/                        Namespace, PVC, ConfigMap, Deployment, Service,
                                Ingress (nginx), HTTPRoute (Gateway API), README
    deno-deploy/                Deno Deploy notes (needs storage adapter)
    vercel/                     Vercel notes (frontend-only deploy recommended)
  .github/
    workflows/
      ci.yml                    Build + E2E on every push/PR; Docker push on main
      release.yml               Cross-platform binaries + GitHub release on v* tag
      automerge.yml             Auto-merge Dependabot patch/minor PRs
    dependabot.yml              Weekly updates for npm and GitHub Actions
```

### Making a change

```bash
# Backend
deno task dev          # auto-restarts on file change

# Frontend
cd frontend && npm run dev   # Vite dev server with HMR at :5173

# After changes — rebuild before running
deno task build-frontend
```

### Running E2E tests

```bash
deno task start &              # server must be running first
cd frontend && npm run test:e2e
```

### Cutting a release

```bash
# 1. Update version in deno.json
# 2. Commit and push
git add deno.json && git commit -m "chore: bump version to X.Y.Z" && git push

# 3. Tag — triggers the release workflow
git tag vX.Y.Z && git push origin vX.Y.Z
```

CI builds and tests on every push. The release workflow compiles binaries for all 5 platforms and creates a GitHub release automatically.

---

## Security

- **The server never sees plaintext.** Encryption and decryption run entirely in the browser.
- **Two layers of protection.** Files are encrypted with AES-256-GCM using a random key. That key is wrapped with AES-KW using a PBKDF2-derived key from a random passcode. The server stores wrapped ciphertext — even with full access to the stored data, it cannot decrypt without the passcode.
- **The passcode is in the URL fragment.** Fragments are not sent in HTTP requests and are not logged by servers or CDNs. However, they are visible in browser history. For maximum privacy, use the "share separately" option to send the link and passcode through different channels.
- **No authentication.** Anyone with a valid link (and passcode) can decrypt the file. Add rate limiting at the ingress layer for public deployments.
- **Server-enforced expiry.** The server returns HTTP 410 for expired links regardless of what the manifest says.
- **500 MB per file** cap enforced server-side in the TUS handler.

---

## License

MIT — see [LICENSE](LICENSE).
