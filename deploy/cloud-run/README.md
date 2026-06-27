# Deploying SecureShare on Cloud Run (shared GCS storage)

SecureShare stores in-progress TUS uploads in a storage backend. The default
`fs` backend keeps that state on the instance's local disk — which **breaks on
Cloud Run**, because Cloud Run autoscales to multiple instances and load-balances
each request independently. The upload is created on one instance and a later
chunk lands on another, which has never seen that upload id and returns
`404 Not Found`. Small files (one chunk) slip through; larger files fail partway.

The fix is the **GCS backend** (`STORAGE_BACKEND=gcs`): upload data and metadata
live in a shared bucket, so any instance can serve any chunk of any upload.

## How it works

Each TUS upload maps onto a **GCS resumable upload session**:

| TUS                      | GCS                                                        |
|--------------------------|------------------------------------------------------------|
| `POST /upload`           | start a resumable session; store its URI in `<id>.info`    |
| `PATCH` chunk @ offset   | `PUT` the chunk to the session URI with a `Content-Range`  |
| `HEAD` (offset)          | read `<id>.info`                                            |
| `GET /api/files/:id`     | stream the finalized object back                           |
| `DELETE`                 | delete the object + `<id>.info`                            |

The session URI and `<id>.info` both live in GCS, so the state is shared across
instances. No session affinity required.

## Setup

```bash
REGION=us-central1
BUCKET=your-secureshare-bucket
SA=secureshare@your-project.iam.gserviceaccount.com

# 1. Bucket
gsutil mb -l $REGION gs://$BUCKET

# 2. Service account can read/write objects
gsutil iam ch serviceAccount:$SA:roles/storage.objectAdmin gs://$BUCKET

# 3. (recommended) auto-delete leftover objects after the max link TTL
cat > /tmp/lifecycle.json <<'JSON'
{ "rule": [ { "action": {"type": "Delete"}, "condition": {"age": 31} } ] }
JSON
gsutil lifecycle set /tmp/lifecycle.json gs://$BUCKET

# 4. Deploy (edit YOUR_* placeholders in service.yaml first)
gcloud run services replace deploy/cloud-run/service.yaml --region=$REGION
```

## Environment variables

| Var                | Default          | Notes                                            |
|--------------------|------------------|--------------------------------------------------|
| `STORAGE_BACKEND`  | `fs`             | set to `gcs`                                     |
| `GCS_BUCKET`       | —                | required when `STORAGE_BACKEND=gcs`              |
| `GCS_PREFIX`       | `secureshare/`   | object name prefix inside the bucket             |
| `LINK_TTL_DAYS`    | `30`             | max share lifetime                               |
| `MAX_UPLOAD_MB`    | `500`            | per-file upload ceiling                          |
| `GCS_ACCESS_TOKEN` | —                | only for local testing off-GCP (see below)       |

## Authentication

On Cloud Run the service account token is read from the metadata server
automatically — no key file. The service account just needs
`roles/storage.objectAdmin` on the bucket.

To exercise the GCS backend locally:

```bash
export STORAGE_BACKEND=gcs
export GCS_BUCKET=your-secureshare-bucket
export GCS_ACCESS_TOKEN="$(gcloud auth print-access-token)"
deno task start
```

## Note on the single-instance alternative

If you don't need horizontal scale, the `deploy/k8s` manifests (or
`max-instances=1` on Cloud Run) with the default `fs` backend on a persistent
disk also avoid the bug. The GCS backend is the right choice when you want
autoscaling.
