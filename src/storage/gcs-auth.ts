// Google Cloud access-token provider.
//
// On Cloud Run / GKE Workload Identity / GCE, the instance's service account
// token is available from the metadata server — no key file needed. The token
// is cached until shortly before it expires. For local testing you can inject a
// token directly with the GCS_ACCESS_TOKEN env var (e.g. from
// `gcloud auth print-access-token`).

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cache: CachedToken | null = null;

// Refresh this many ms before actual expiry to avoid using a token mid-flight
// that expires during a long upload chunk.
const EXPIRY_SKEW_MS = 60_000;

export function clearTokenCache(): void {
  cache = null;
}

export async function getAccessToken(nowMs: number = Date.now()): Promise<string> {
  const override = Deno.env.get("GCS_ACCESS_TOKEN");
  if (override) return override;

  if (cache && cache.expiresAtMs - EXPIRY_SKEW_MS > nowMs) {
    return cache.token;
  }

  const res = await fetch(METADATA_TOKEN_URL, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to obtain GCP access token from metadata server (${res.status}). ` +
        `Set GCS_ACCESS_TOKEN for non-GCP environments.`,
    );
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cache = {
    token: body.access_token,
    expiresAtMs: nowMs + body.expires_in * 1000,
  };
  return cache.token;
}
