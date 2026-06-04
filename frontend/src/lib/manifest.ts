export interface ManifestItem {
  id: string;
  key: string;     // base64url — raw AES-256-GCM key, or passcode-wrapped key
  name: string;
  size: number;    // original plaintext size in bytes
  mime: string;
  expiresAt: string; // ISO-8601 — embedded in link, tamper-evident
}

// "none" → item.key is the raw file key (anyone with the link can decrypt).
// "passcode" → item.key is wrapped with a passcode-derived key; kdf holds the salt.
export interface Manifest {
  v: number;
  protection: "none" | "passcode";
  kdf?: { salt: string; iterations: number };
  items: ManifestItem[];
}

export function encodeManifest(manifest: Manifest): string {
  const json = JSON.stringify(manifest);
  const bytes = new TextEncoder().encode(json);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeManifest(encoded: string): Manifest {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (b64.length % 4)) % 4;
  const str = atob(b64 + "=".repeat(padding));
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  const json = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(json);
  // Backward-compatible: an older link encoded a bare ManifestItem[] array.
  if (Array.isArray(parsed)) {
    return { v: 1, protection: "none", items: parsed as ManifestItem[] };
  }
  return parsed as Manifest;
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
