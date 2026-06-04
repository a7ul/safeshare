# SecureShare

End-to-end encrypted file and note sharing. Files are encrypted in the browser with AES-256-GCM before they leave your device. The server only ever receives ciphertext — the decryption key lives exclusively in the share URL fragment (`#…`), which browsers never send to the server.

## How it works

```
Browser                              Server
──────────────────────────────────────────────────────────
generate AES-256-GCM key
encrypt(file, key) → ciphertext
upload(ciphertext) ─────────────────────────────────────▶ store bytes
                   ◀──────────────────────────────────── file ID

share URL:  https://your-host/d/m#base64([{id, key, name}, …])
                                   └── never sent to server ──┘

recipient browser reads hash → fetches ciphertext(id) ──▶ return bytes
                             ← decrypt(ciphertext, key)
                               save file to disk
```

1. Each file gets its own random AES-256-GCM key generated in your browser.
2. Ciphertext is uploaded via the [TUS resumable upload protocol](https://tus.io) — large files survive network interruptions.
3. The share link encodes a manifest (file IDs + keys) in the `#` fragment. Fragments are never included in HTTP requests, so keys never touch the server.
4. The recipient decrypts entirely in-browser using the Web Crypto API.

## Features

| | |
|---|---|
| AES-256-GCM encryption | Encrypted in-browser before upload |
| Resumable uploads (TUS) | Up to 500 MB per file |
| Multi-file bundles | Share multiple files in one link |
| Secure notes | Text notes encrypted before leaving the browser |
| Configurable TTL | Links expire after N days (default: 7) |
| Self-hostable | Single binary, any volume, no external services |
| Custom branding | Logo via `LOGO_URL` env var |

---

## Running locally

### Prerequisites

- [Deno](https://deno.land) ≥ 1.40
- Node.js ≥ 18 and npm (for the frontend build)

### Quickstart

```bash
git clone git@github.com:a7ul/secureshare.git
cd secureshare

# Build the React frontend
deno task build-frontend   # runs npm install + vite build

# Start the server (serves frontend + API on the same port)
deno task start
```

Open [http://localhost:8000](http://localhost:8000).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `STORAGE_DIR` | `/tmp/e2eshare` | Where encrypted blobs are stored on disk |
| `LINK_TTL_DAYS` | `7` | Days until a share link expires |
| `LOGO_URL` | _(none)_ | URL of a logo image shown in the UI header |

### Hot-reload development

```bash
# Terminal 1 — Deno backend with file watching
deno task dev

# Terminal 2 — Vite frontend dev server
cd frontend && npm run dev
```

The Vite dev server ([http://localhost:5173](http://localhost:5173)) proxies `/api` and `/upload` to the Deno backend on `:8000`.

---

## Self-hosting on Kubernetes

The server is a single stateless process. Storage is just a directory — mount any volume there. No database, no message queue, no cache.

### Option 1 — PersistentVolumeClaim (block storage)

Good for: single-node setups, GKE Autopilot, DigitalOcean, Linode, etc.

```yaml
# secureshare.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: secureshare-data
  namespace: secureshare
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 20Gi
  storageClassName: standard  # replace with your cloud's storage class
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secureshare
  namespace: secureshare
spec:
  replicas: 1          # ReadWriteOnce only supports one pod — see Option 2 for HA
  selector:
    matchLabels:
      app: secureshare
  template:
    metadata:
      labels:
        app: secureshare
    spec:
      containers:
        - name: secureshare
          image: denoland/deno:2.0.0
          args:
            - run
            - --allow-read
            - --allow-write
            - --allow-net
            - --allow-env
            - /app/main.ts
          workingDir: /app
          env:
            - name: PORT
              value: "8000"
            - name: STORAGE_DIR
              value: /data/uploads
            - name: LINK_TTL_DAYS
              value: "7"
          ports:
            - containerPort: 8000
          readinessProbe:
            httpGet:
              path: /api/config
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          volumeMounts:
            - name: app
              mountPath: /app
            - name: data
              mountPath: /data
      volumes:
        - name: app
          configMap:
            name: secureshare-code   # see note below
        - name: data
          persistentVolumeClaim:
            claimName: secureshare-data
---
apiVersion: v1
kind: Service
metadata:
  name: secureshare
  namespace: secureshare
spec:
  selector:
    app: secureshare
  ports:
    - port: 80
      targetPort: 8000
```

> **Tip:** For the code volume, the simplest approach is to build a container image:
> ```dockerfile
> FROM denoland/deno:2.0.0
> WORKDIR /app
> COPY . .
> RUN deno cache main.ts
> CMD ["run","--allow-read","--allow-write","--allow-net","--allow-env","main.ts"]
> ```
> Then reference your image instead of `denoland/deno:2.0.0`.

### Ingress with TLS (cert-manager)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: secureshare
  namespace: secureshare
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "512m"       # allow large uploads
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"     # TUS uploads can be slow
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
spec:
  tls:
    - hosts: [share.example.com]
      secretName: secureshare-tls
  rules:
    - host: share.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: secureshare
                port:
                  number: 80
```

---

### Option 2 — GCS bucket as a volume (recommended for production)

Mount a Google Cloud Storage bucket as a FUSE filesystem using the [Cloud Storage FUSE CSI driver](https://cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/cloud-storage-fuse-csi-driver). This gives you:

- **Effectively unlimited storage** — no PVC resizing
- **Multi-replica support** — all pods read/write the same bucket
- **Automatic file cleanup** — via GCS Object Lifecycle rules (no cron job)
- **Durability** — 11 nines by default

#### 1. Create the bucket

```bash
gcloud storage buckets create gs://my-secureshare-uploads \
  --location=US \
  --uniform-bucket-level-access
```

#### 2. Set a lifecycle policy to auto-delete expired files

Each upload lives in a directory named by its UUID. A lifecycle rule deletes objects older than your TTL, matching `LINK_TTL_DAYS`:

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": { "age": 7 }
      }
    ]
  }
}
```

```bash
gcloud storage buckets update gs://my-secureshare-uploads \
  --lifecycle-file=lifecycle.json
```

Files uploaded today are automatically deleted after 7 days. No cron job. No cleanup code. No storage costs for expired content.

> **Keep `LINK_TTL_DAYS` and the lifecycle `age` in sync.** If the bucket deletes after 7 days but the app says links expire in 14, users will get 404s on day 8.

#### 3. Grant the workload identity

```bash
# Create a GCP service account
gcloud iam service-accounts create secureshare-sa \
  --project=my-project

# Grant it Storage Object User on the bucket
gcloud storage buckets add-iam-policy-binding gs://my-secureshare-uploads \
  --member="serviceAccount:secureshare-sa@my-project.iam.gserviceaccount.com" \
  --role="roles/storage.objectUser"

# Bind to the Kubernetes service account via Workload Identity
gcloud iam service-accounts add-iam-policy-binding \
  secureshare-sa@my-project.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:my-project.svc.id.goog[secureshare/secureshare]"
```

#### 4. Update the Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secureshare
  namespace: secureshare
spec:
  replicas: 3    # now safe — all pods share the same GCS bucket
  template:
    metadata:
      annotations:
        gke-gcsfuse/volumes: "true"    # enable the CSI driver sidecar
    spec:
      serviceAccountName: secureshare
      containers:
        - name: secureshare
          # ... same as before ...
          volumeMounts:
            - name: gcs-data
              mountPath: /data
      volumes:
        - name: gcs-data
          csi:
            driver: gcsfuse.csi.storage.gke.io
            readOnly: false
            volumeAttributes:
              bucketName: my-secureshare-uploads
              mountOptions: "implicit-dirs,file-cache:enable-parallel-downloads:true"
```

The same pattern works on AWS EKS using the [Mountpoint for Amazon S3 CSI driver](https://docs.aws.amazon.com/eks/latest/userguide/s3-csi.html) and S3 Object Lifecycle policies.

---

## Development guide

### Project structure

```
secureshare/
├── main.ts               # Deno/Hono server — API + static file serving
├── src/
│   ├── tus.ts            # TUS resumable upload protocol handler
│   └── storage.ts        # File storage (read/write encrypted blobs + metadata)
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── UploadPage.tsx    # / route
│   │   │   └── DownloadPage.tsx  # /d/:id route
│   │   ├── components/
│   │   │   └── SecureUploader.tsx
│   │   ├── lib/
│   │   │   ├── crypto.ts     # AES-GCM encrypt/decrypt + key export/import
│   │   │   ├── manifest.ts   # Multi-file manifest encode/decode
│   │   │   ├── uploader.ts   # TUS client wrapper
│   │   │   └── expiry.ts     # Expiry fetch + human-readable formatting
│   │   └── hooks/
│   │       └── useLogo.ts    # Fetches /api/config for optional logo URL
│   ├── e2e/
│   │   └── secureshare.spec.ts  # Playwright E2E tests
│   └── dist/             # Built frontend (gitignored in production, committed here)
├── deno.json             # Deno tasks
└── README.md
```

### Making changes

#### Backend changes

Edit files in `src/` or `main.ts`, then restart the server:

```bash
deno task dev   # auto-restarts on file change
```

#### Frontend changes

```bash
cd frontend
npm run dev     # hot-reload dev server at :5173
```

When ready to ship:

```bash
cd frontend && npm run build
# or from the repo root:
deno task build-frontend
```

The built files in `frontend/dist/` are served directly by the Deno backend.

#### Running E2E tests

```bash
# Make sure the server is running first
deno task start &

cd frontend
npm run test:e2e
```

### Updating the README

Edit `README.md` at the repo root. No build step needed — it's plain Markdown.

### Deploying an update

```bash
# 1. Build the frontend
deno task build-frontend

# 2. Commit everything (including frontend/dist)
git add -A
git commit -m "feat: describe your change"
git push origin main

# 3. If using Kubernetes, roll out the new image
kubectl rollout restart deployment/secureshare -n secureshare
```

---

## Security notes

- **The server never sees plaintext.** All encryption/decryption runs in the browser via the Web Crypto API.
- **The key is in the URL fragment.** Fragments are stripped by browsers before sending HTTP requests and are not written to server logs or CDN access logs. However, they _are_ visible in browser history and may appear in `Referer` headers if the user clicks a link from the share page. Share links over trusted channels only (Signal, encrypted email, etc.).
- **No authentication.** Anyone with a valid link can decrypt the file. For public deployments, add rate limiting at the ingress layer.
- **CORS is open (`*`).** Safe for a single-origin deploy. Restrict it if you split the API and frontend onto different origins.
- **Upload size limit.** 500 MB per file, enforced server-side in the TUS handler.

## License

MIT
