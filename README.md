# SecureShare

End-to-end encrypted file and note sharing. Files are encrypted in your browser with AES-256-GCM before a single byte leaves your device. The server only ever receives ciphertext. The decryption key lives exclusively in the share URL fragment — which browsers never send to the server.

[![CI](https://github.com/a7ul/secureshare/actions/workflows/ci.yml/badge.svg)](https://github.com/a7ul/secureshare/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## How it works

```
Your browser                         Server
--------------------------------------------------
generate AES-256-GCM key
encrypt(file, key) = ciphertext
upload(ciphertext) -----------------> store bytes
                   <----------------- file ID

share URL:  https://host/d/m#base64([{id, key, name, expiresAt}, ...])
                              ^--- NEVER sent to server

recipient reads URL hash -> fetch(ciphertext) -----> return bytes
                         <- decrypt(ciphertext, key)
                            save file to disk
```

- Encryption and decryption run entirely in `frontend/src/lib/crypto.ts` using the browser Web Crypto API. The server has zero crypto code.
- Files upload via the [TUS resumable protocol](https://tus.io) — large files survive network interruptions.
- Multiple files are bundled in one link via a base64-encoded manifest in the URL hash.
- Optionally, the manifest's keys are wrapped behind a passcode (shared separately, or embedded in a unified link) — see [Security](#security).
- Expiry is chosen per share (1h / 24h / 7d / 30d) and embedded in the manifest, so the recipient sees it immediately without a server round-trip.

---

## Features

- AES-256-GCM browser encryption — server never sees plaintext
- TUS resumable uploads up to `MAX_UPLOAD_MB` (500 MB default) per file
- Multi-file bundles in one link
- Passcode protection — wrap the link's key behind a passcode (shared separately) or bake it into a single unified link
- Secure notes — text encrypted before leaving the browser
- Per-share expiry: 1 hour, 24 hours, 7 days, 30 days
- Delete on demand — anyone with the link can permanently remove the files before they expire
- Server-enforced TTL capped at `LINK_TTL_DAYS`
- Optional company logo and name via environment variables
- Single self-contained binary — no database, no cache, no queue
- MIT licensed

---

## Running locally

### Prerequisites

- [Deno](https://deno.land) 2.x
- Node.js 20+ and npm (for the frontend build)

### Quickstart

```bash
git clone git@github.com:a7ul/secureshare.git
cd secureshare

# Build the React frontend into frontend/dist/
deno task build-frontend

# Start the server (serves frontend + API on the same port)
deno task start
```

Open http://localhost:8000.

### Hot-reload development

```bash
# Terminal 1: Deno backend with file watching
deno task dev

# Terminal 2: Vite frontend dev server with HMR
cd frontend && npm run dev
```

Frontend dev server runs at http://localhost:5173 and proxies `/api` and `/upload` to the Deno backend on `:8000`.

### Compile a single binary

```bash
# First build the frontend (it gets embedded in the binary)
deno task build-frontend

# Compile for the current platform
deno task compile
./secureshare
```

Cross-compile for other platforms:

```bash
deno compile \
  --allow-read --allow-write --allow-net --allow-env \
  --include frontend/dist \
  --target x86_64-unknown-linux-gnu \
  --output secureshare-linux-x64 \
  main.ts
```

Available targets: `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`, `x86_64-apple-darwin`, `aarch64-apple-darwin`.

---

## Configuration

All configuration is via environment variables. Every variable has a sane default.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP port to listen on |
| `STORAGE_DIR` | `/tmp/e2eshare` | Directory where encrypted uploads are stored |
| `LINK_TTL_DAYS` | `30` | Maximum share link lifetime in days — the cap the server enforces |
| `MAX_UPLOAD_MB` | `500` | Maximum upload size per file, in MB |
| `LOGO_URL` | _(blank)_ | URL of a company logo shown in the UI header |
| `TITLE` | _(blank)_ | Company name shown next to the logo |

### Example with branding

```bash
LOGO_URL="https://example.com/logo.png" \
TITLE="Acme Corp" \
STORAGE_DIR=/var/lib/secureshare \
LINK_TTL_DAYS=14 \
./secureshare
```

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

---

## Deployment recipes

| Platform | Guide |
|---|---|
| Docker | [deploy/docker/README.md](deploy/docker/README.md) |
| Docker Compose | [deploy/docker-compose/README.md](deploy/docker-compose/README.md) |
| Kubernetes (Ingress + HTTPRoute) | [deploy/k8s/README.md](deploy/k8s/README.md) |
| Deno Deploy | [deploy/deno-deploy/README.md](deploy/deno-deploy/README.md) |
| Vercel | [deploy/vercel/README.md](deploy/vercel/README.md) |

### Kubernetes with automatic cleanup (GCS lifecycle)

Mount a GCS bucket via the Cloud Storage FUSE CSI driver and set a lifecycle rule to delete objects after `LINK_TTL_DAYS` days. No cron job needed.

```bash
# Create bucket
gcloud storage buckets create gs://my-secureshare --location=US

# Set lifecycle rule to delete objects after 7 days
cat > lifecycle.json << 'EOF'
{"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":7}}]}}
EOF
gcloud storage buckets update gs://my-secureshare --lifecycle-file=lifecycle.json
```

Then in your Deployment, replace the PVC volume with:

```yaml
volumes:
  - name: data
    csi:
      driver: gcsfuse.csi.storage.gke.io
      volumeAttributes:
        bucketName: my-secureshare
        mountOptions: "implicit-dirs"
```

The same pattern works on AWS with the [S3 CSI driver](https://docs.aws.amazon.com/eks/latest/userguide/s3-csi.html) and S3 lifecycle policies.

---

## Development

### Project structure

```
secureshare/
  main.ts                     Deno/Hono server entry point
  src/
    tus.ts                    TUS resumable upload handler
    storage.ts                Encrypted blob storage (read/write to STORAGE_DIR)
  frontend/
    src/
      pages/
        UploadPage.tsx         / route
        HowItWorksPage.tsx     /how-it-works route
        DownloadPage.tsx       /d/:id route
      components/
        SecureUploader.tsx     Upload UI with expiry picker
      lib/
        crypto.ts              AES-256-GCM encrypt/decrypt (browser only)
        manifest.ts            Multi-file manifest encode/decode
        uploader.ts            TUS client wrapper
        expiry.ts              Expiry formatting
      hooks/
        useConfig.ts           Fetches /api/config (logo + title)
    e2e/
      secureshare.spec.ts      Playwright E2E tests
  deploy/
    docker/                    Dockerfile + instructions
    docker-compose/            docker-compose.yml + instructions
    k8s/                       Kubernetes manifests (Ingress + HTTPRoute)
    deno-deploy/               Deno Deploy notes
    vercel/                    Vercel notes
  .github/
    workflows/
      ci.yml                   Build, test, push Docker image on main
      release.yml              Cross-platform binaries + GitHub release on v* tag
      automerge.yml            Auto-merge Dependabot patch/minor PRs
    dependabot.yml             Weekly dependency updates (npm + GitHub Actions)
```

### Making changes

```bash
# Backend
deno task dev          # starts server with --watch

# Frontend
cd frontend && npm run dev   # Vite dev server at :5173

# After changes, rebuild before deploying
deno task build-frontend
```

### Running E2E tests

```bash
deno task start &      # start the server first
cd frontend && npm run test:e2e
```

### Releasing a new version

```bash
# 1. Update the version in deno.json
#    "version": "1.2.0"

# 2. Commit
git add deno.json
git commit -m "chore: bump version to 1.2.0"
git push origin main

# 3. Tag the release — this triggers the release workflow
git tag v1.2.0
git push origin v1.2.0
```

The CI workflow builds, tests, and pushes a Docker image on every push to `main`.
The release workflow builds cross-platform binaries and creates a GitHub release on every `v*` tag.

---

## Security

- **The client does encryption and keys; the server does the time limit.** All cryptography — encrypting files, deriving passcode keys, holding the decryption keys — happens in the browser. The server has no crypto code. The **only** policy the server enforces on a share is its expiry; everything else about access lives in the link.
- **The server never sees plaintext.** All encryption runs in the browser via the Web Crypto API.
- **The key is in the URL fragment.** Fragments are stripped by browsers before sending HTTP requests and are not written to server logs or CDN access logs. However, they are visible in browser history. Share links over trusted channels only.
- **Passcode protection (optional).** The random file key can be wrapped (encrypted) with a key derived from a passcode via PBKDF2 (210k iterations, SHA-256). The link then carries only the wrapped key plus a salt — useless without the passcode. *Passcode* mode keeps the passcode out of the link (share it separately); *unified link* mode embeds it in the fragment for convenience. The server never sees the passcode.
- **No authentication.** Anyone with a valid link (and passcode, if set) can decrypt the file. Add rate limiting at the ingress layer for public deployments.
- **Deletion is link-scoped.** `DELETE /api/files/:id` removes a share. Knowing the id is the credential — exactly as it is for download — so anyone holding the link can delete it, and no one without it can. Deletion is permanent and idempotent (a missing id returns 404).
- **Every share always has a time limit, enforced server-side.** A share can't be created without an expiry — a missing, malformed, or past client value falls back to the `LINK_TTL_DAYS` maximum. The server returns HTTP 410 for expired links. The client-side expiry in the manifest is for display only.
- **Uploads are capped at `MAX_UPLOAD_MB` (500 MB default) per file**, enforced in the TUS handler.

---

## License

MIT — see [LICENSE](LICENSE).
