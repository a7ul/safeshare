# Deno Deploy

> **Note:** Deno Deploy is a serverless edge platform — it has no persistent filesystem.
> SecureShare needs disk storage for encrypted uploads, so you need to add a storage adapter
> (Deno KV + R2, or a third-party S3-compatible service) to run here. The instructions below
> cover the simplest path using Cloudflare R2 as the backend store.

## Option A — Deno Deploy + Cloudflare R2

Cloudflare R2 is S3-compatible and has a generous free tier (10 GB free, no egress fees).

### 1. Create an R2 bucket

```bash
# Install Wrangler if needed
npm install -g wrangler
wrangler login

wrangler r2 bucket create secureshare-uploads
```

### 2. Get R2 credentials

In the Cloudflare dashboard, go to **R2 > Manage R2 API tokens** and create a token with
Object Read & Write permissions on your bucket. Note:
- Account ID
- Access Key ID
- Secret Access Key
- Bucket name
- Endpoint: `https://<account-id>.r2.cloudflarestorage.com`

### 3. Add a storage adapter

The current `src/storage.ts` writes to the local filesystem. To run on Deno Deploy, swap it
for an S3-compatible adapter such as [`aws4fetch`](https://github.com/mhart/aws4fetch).
A community-maintained adapter is tracked in [issue #XX](https://github.com/a7ul/secureshare).

### 4. Deploy

```bash
# Install deployctl
deno install -gArf jsr:@deno/deployctl

# Deploy from the repo root
deployctl deploy --project=secureshare main.ts
```

Set environment variables in the Deno Deploy dashboard:
```
STORAGE_BACKEND=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=secureshare-uploads
LINK_TTL_DAYS=7
TITLE=My Company
LOGO_URL=https://...
```

## Option B — Self-host with a single binary (simpler)

For most use cases, the [single binary release](https://github.com/a7ul/secureshare/releases)
is easier and cheaper than Deno Deploy. It runs anywhere — a $5 VPS, a Raspberry Pi, or your
own server.

```bash
curl -L https://github.com/a7ul/secureshare/releases/latest/download/secureshare-linux-x64 \
  -o secureshare
chmod +x secureshare
STORAGE_DIR=/var/lib/secureshare PORT=8000 ./secureshare
```
