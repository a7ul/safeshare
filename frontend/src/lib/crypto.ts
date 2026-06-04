export interface DecryptedFile {
  filename: string;
  mimeType: string;
  content: ArrayBuffer;
}

export async function generateKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  const bytes = new Uint8Array(raw);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function importKey(b64url: string): Promise<CryptoKey> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (b64.length % 4)) % 4;
  const str = atob(b64 + "=".repeat(padding));
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return await crypto.subtle.importKey(
    "raw",
    bytes.buffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
}

export async function encryptPayload(
  key: CryptoKey,
  filename: string,
  mimeType: string,
  content: ArrayBuffer,
): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const nameBytes = new TextEncoder().encode(filename);
  const mimeBytes = new TextEncoder().encode(mimeType);

  const plainLen = 2 + nameBytes.length + 2 + mimeBytes.length + content.byteLength;
  const plain = new Uint8Array(plainLen);
  const view = new DataView(plain.buffer);
  let off = 0;

  view.setUint16(off, nameBytes.length, true); off += 2;
  plain.set(nameBytes, off); off += nameBytes.length;
  view.setUint16(off, mimeBytes.length, true); off += 2;
  plain.set(mimeBytes, off); off += mimeBytes.length;
  plain.set(new Uint8Array(content), off);

  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain.buffer);

  const result = new Uint8Array(12 + cipher.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(cipher), 12);
  return result.buffer;
}

export async function decryptPayload(
  key: CryptoKey,
  data: ArrayBuffer,
): Promise<DecryptedFile> {
  const iv = new Uint8Array(data, 0, 12);
  const cipher = data.slice(12);

  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  const view = new DataView(plain);
  let off = 0;

  const nameLen = view.getUint16(off, true); off += 2;
  const filename = new TextDecoder().decode(new Uint8Array(plain, off, nameLen)); off += nameLen;
  const mimeLen = view.getUint16(off, true); off += 2;
  const mimeType = new TextDecoder().decode(new Uint8Array(plain, off, mimeLen)); off += mimeLen;
  const content = plain.slice(off);

  return { filename, mimeType, content };
}
