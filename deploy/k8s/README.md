# Kubernetes

Two routing options are provided. Use whichever matches your cluster:

| File | When to use |
|---|---|
| `ingress.yaml` | Classic Ingress with nginx-ingress-controller |
| `httproute.yaml` | Gateway API (GKE Autopilot, Istio, Envoy Gateway, Cilium) |

## Quick start

```bash
# 1. Create namespace and storage
kubectl apply -f namespace.yaml
kubectl apply -f pvc.yaml

# 2. Deploy the app
kubectl apply -f configmap.yaml
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml

# 3a. Nginx Ingress (classic)
kubectl apply -f ingress.yaml

# 3b. Gateway API (modern)
kubectl apply -f httproute.yaml
```

## Configuration

Edit `configmap.yaml` before applying. All values are optional — sane defaults are built in.

| Key | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP listen port inside the container |
| `STORAGE_DIR` | `/data` | Mount path for the PVC |
| `LINK_TTL_DAYS` | `7` | Max days before a share link expires |
| `LOGO_URL` | _(blank)_ | URL of a logo to show in the UI header |
| `TITLE` | _(blank)_ | Company name shown next to the logo |

## Scaling beyond one replica

`ReadWriteOnce` PVCs only allow one pod. To run multiple replicas:

1. Use a `ReadWriteMany` storage class (NFS, EFS on AWS, Filestore on GCP)
2. Or mount a GCS/S3 bucket via a CSI driver (see the main README for the GCS lifecycle cleanup recipe)

## Automatic file cleanup with GCS

```yaml
# In deployment.yaml, replace the PVC volume with a GCS FUSE mount
volumes:
  - name: data
    csi:
      driver: gcsfuse.csi.storage.gke.io
      volumeAttributes:
        bucketName: my-secureshare-bucket
        mountOptions: "implicit-dirs"
```

Then set a bucket lifecycle rule to delete objects after `LINK_TTL_DAYS` days.
No cron job needed. See the main README for the full setup.
