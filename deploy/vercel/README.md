# Vercel

> **Note:** Vercel's serverless functions have no persistent disk. SecureShare requires
> durable file storage for encrypted uploads. The approach below uses Vercel with
> Cloudflare R2 (or any S3-compatible store) as the backend. This requires a small
> storage adapter change to `src/storage.ts`.

## Limitations

- Vercel functions have a 4.5 MB body size limit on the Hobby plan (50 MB on Pro).
  For files larger than this, use a different deployment target (Docker, k8s, fly.io).
- Vercel does not support Deno natively. The backend must be ported to a Node.js/Edge
  runtime, or you can serve only the frontend from Vercel and host the API separately.

## Recommended: Frontend on Vercel + API elsewhere

The simplest split:

1. Deploy the **frontend** (`frontend/dist/`) as a static site on Vercel.
2. Deploy the **API** (the Deno server) on any platform with persistent storage
   (Docker, fly.io, a VPS, Kubernetes).
3. Set the `VITE_API_BASE` environment variable in Vite so the frontend points to your API.

```bash
# In frontend/.env.production
VITE_API_BASE=https://api.share.example.com
```

Then update `frontend/src/lib/uploader.ts` and `frontend/src/lib/expiry.ts` to prefix
requests with `import.meta.env.VITE_API_BASE`.

### Deploy frontend to Vercel

```bash
cd frontend
npm run build
npx vercel deploy dist/ --prod
```

Or connect the GitHub repo in the Vercel dashboard and set:
- **Framework**: Vite
- **Root Directory**: `frontend`
- **Build Command**: `npm run build`
- **Output Directory**: `dist`

## Full-stack on Vercel (advanced, requires Node.js port)

Not covered here. The Deno backend would need to be rewritten as Vercel API routes
(Node.js) with an S3 storage adapter. This is tracked in
[issue #XX](https://github.com/a7ul/secureshare) if there is demand.
