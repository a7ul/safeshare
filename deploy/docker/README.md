# Docker

## Run from the pre-built image

```bash
docker run -d \
  --name secureshare \
  -p 8000:8000 \
  -v /your/storage/path:/data \
  -e STORAGE_DIR=/data \
  -e LINK_TTL_DAYS=7 \
  ghcr.io/a7ul/secureshare:latest
```

Open http://localhost:8000.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `STORAGE_DIR` | `/data` | Where uploads are stored inside the container |
| `LINK_TTL_DAYS` | `30` | Maximum link lifetime in days |
| `LOGO_URL` | _(blank)_ | URL of a company logo shown in the UI |
| `TITLE` | _(blank)_ | Company name shown next to the logo |

## Build the image locally

From the repo root:

```bash
docker build -f deploy/docker/Dockerfile -t secureshare .
docker run -d -p 8000:8000 -v /tmp/secureshare:/data secureshare
```

## Multi-platform build

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f deploy/docker/Dockerfile \
  -t ghcr.io/your-org/secureshare:latest \
  --push .
```
