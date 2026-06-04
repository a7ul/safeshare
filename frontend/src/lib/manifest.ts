export interface ManifestItem {
  id: string;
  key: string;  // base64url AES key
  name: string;
  size: number; // original plaintext size in bytes
  mime: string;
}

export function encodeManifest(items: ManifestItem[]): string {
  const json = JSON.stringify(items);
  const bytes = new TextEncoder().encode(json);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeManifest(encoded: string): ManifestItem[] {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (b64.length % 4)) % 4;
  const str = atob(b64 + "=".repeat(padding));
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as ManifestItem[];
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
