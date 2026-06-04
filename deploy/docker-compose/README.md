# Docker Compose

## Start

```bash
cd deploy/docker-compose
docker compose up -d
```

Open http://localhost:8000.

## Stop

```bash
docker compose down
```

## Configuration

Edit `docker-compose.yml` and change the `environment` section. No rebuild needed — just restart the container.

```bash
docker compose down && docker compose up -d
```

## Persist uploads across restarts

The `uploads` named volume in `docker-compose.yml` persists data automatically.
To use a host directory instead:

```yaml
volumes:
  - /your/host/path:/data
```

## Pin a specific version

```yaml
image: ghcr.io/a7ul/secureshare:1.0.0
```

Find available tags at: https://github.com/a7ul/secureshare/pkgs/container/secureshare
