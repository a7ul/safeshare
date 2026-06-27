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

/* ─── Streaming chunked encryption ──────────────────── */
/*
 * Large files (hundreds of MB) cannot be encrypted in one shot: encryptPayload
 * holds the plaintext, the cipher, and several copies in memory at once (~4× the
 * file size) and runs a single multi-hundred-MB AES-GCM call that blocks the main
 * thread. At 300–500 MB this exhausts the tab's memory budget and stalls/crashes.
 *
 * The streaming format encrypts the file as a sequence of independent records,
 * each its own AES-GCM message (fresh IV, own tag). We slice the source File one
 * chunk at a time and move each encrypted chunk straight into Blob storage, so JS
 * heap never holds more than ~one chunk regardless of file size.
 *
 * Wire format:
 *   header : "SSC1" magic (4 bytes) | chunkSize uint32-LE (4 bytes)
 *   record : recLen uint32-LE (4 bytes) | iv (12 bytes) | ciphertext+tag
 *   record 0      → metadata: nameLen u16-LE | name | mimeLen u16-LE | mime
 *   records 1..n  → consecutive plaintext chunks of the file
 *
 * Each record's AES-GCM additionalData binds its index and a "last record" flag,
 * so reordering, dropping, or truncating records fails authentication.
 */

const STREAM_MAGIC = new Uint8Array([0x53, 0x53, 0x43, 0x31]); // "SSC1"
const STREAM_HEADER_LEN = 8;
const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB plaintext per record

function recordAAD(index: number, isLast: boolean): Uint8Array<ArrayBuffer> {
  const aad = new Uint8Array(5);
  new DataView(aad.buffer).setUint32(0, index, false); // big-endian index
  aad[4] = isLast ? 1 : 0;
  return aad;
}

async function encryptRecord(
  key: CryptoKey,
  index: number,
  isLast: boolean,
  plain: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: recordAAD(index, isLast) },
    key,
    plain,
  );
  const body = 12 + cipher.byteLength;
  const out = new Uint8Array(4 + body);
  new DataView(out.buffer).setUint32(0, body, true); // recLen LE
  out.set(iv, 4);
  out.set(new Uint8Array(cipher), 16);
  return out;
}

function hasStreamMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === STREAM_MAGIC[0] && bytes[1] === STREAM_MAGIC[1] &&
    bytes[2] === STREAM_MAGIC[2] && bytes[3] === STREAM_MAGIC[3];
}

// Encrypt a File/Blob into a streamed Blob. Peak JS heap stays at ~chunkSize
// because each encrypted record is moved into Blob storage immediately.
export async function encryptFileToBlob(
  key: CryptoKey,
  filename: string,
  mimeType: string,
  file: Blob,
  onProgress?: (fraction: number) => void,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<Blob> {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(filename);
  const mimeBytes = enc.encode(mimeType);
  const meta: Uint8Array<ArrayBuffer> = new Uint8Array(2 + nameBytes.length + 2 + mimeBytes.length);
  const mv = new DataView(meta.buffer);
  let o = 0;
  mv.setUint16(o, nameBytes.length, true); o += 2;
  meta.set(nameBytes, o); o += nameBytes.length;
  mv.setUint16(o, mimeBytes.length, true); o += 2;
  meta.set(mimeBytes, o);

  const totalChunks = Math.ceil(file.size / chunkSize);

  const header: Uint8Array<ArrayBuffer> = new Uint8Array(STREAM_HEADER_LEN);
  header.set(STREAM_MAGIC, 0);
  new DataView(header.buffer).setUint32(4, chunkSize, true);

  const parts: BlobPart[] = [header];
  // Record 0 = metadata. It is the last record only for a zero-byte file.
  parts.push(await encryptRecord(key, 0, totalChunks === 0, meta));

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const buf: Uint8Array<ArrayBuffer> = new Uint8Array(await file.slice(start, end).arrayBuffer());
    const isLast = i === totalChunks - 1;
    // Wrap immediately in a Blob so the encrypted bytes leave the JS heap.
    parts.push(new Blob([await encryptRecord(key, i + 1, isLast, buf)]));
    onProgress?.((i + 1) / totalChunks);
  }

  return new Blob(parts, { type: "application/octet-stream" });
}

// Unified decrypt: auto-detects the streamed format and falls back to the legacy
// single-shot format so links created before streaming still open. Reads one
// record at a time so peak heap stays at ~chunkSize for large files.
export async function decryptToBlob(
  key: CryptoKey,
  src: Blob,
): Promise<{ filename: string; mimeType: string; content: Blob }> {
  const magic = new Uint8Array(await src.slice(0, 4).arrayBuffer());

  if (!hasStreamMagic(magic)) {
    // Legacy single-shot payload.
    const buf = await src.arrayBuffer();
    const d = await decryptPayload(key, buf);
    return {
      filename: d.filename,
      mimeType: d.mimeType,
      content: new Blob([d.content], { type: d.mimeType }),
    };
  }

  let pos = STREAM_HEADER_LEN;
  let index = 0;
  let filename = "";
  let mimeType = "application/octet-stream";
  const contentParts: BlobPart[] = [];

  while (pos < src.size) {
    const lenBuf = new Uint8Array(await src.slice(pos, pos + 4).arrayBuffer());
    if (lenBuf.length < 4) throw new Error("Truncated file.");
    const recLen = new DataView(lenBuf.buffer).getUint32(0, true);
    pos += 4;
    const recBuf: Uint8Array<ArrayBuffer> = new Uint8Array(await src.slice(pos, pos + recLen).arrayBuffer());
    if (recBuf.length < recLen || recLen < 12) throw new Error("Corrupted file.");
    pos += recLen;

    const iv = recBuf.slice(0, 12);
    const cipher = recBuf.slice(12);
    const isLast = pos >= src.size;

    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: recordAAD(index, isLast) },
        key,
        cipher,
      );
    } catch {
      throw new Error("Decryption failed — the file is corrupted or was tampered with.");
    }

    if (index === 0) {
      const view = new DataView(plain);
      let off = 0;
      const nameLen = view.getUint16(off, true); off += 2;
      filename = new TextDecoder().decode(new Uint8Array(plain, off, nameLen)); off += nameLen;
      const mimeLen = view.getUint16(off, true); off += 2;
      mimeType = new TextDecoder().decode(new Uint8Array(plain, off, mimeLen));
    } else {
      contentParts.push(plain);
    }
    index++;
  }

  return { filename, mimeType, content: new Blob(contentParts, { type: mimeType }) };
}

/* ─── base64url helpers ─────────────────────────────── */

export function b64urlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (b64.length % 4)) % 4;
  const bin = atob(b64 + "=".repeat(padding));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ─── Passcode protection ───────────────────────────── */
/*
 * Files are always encrypted with a random AES-256-GCM key. Passcode protection
 * adds a layer ON TOP: that random key is itself wrapped (encrypted) with a key
 * derived from the passcode via PBKDF2. The link then carries only the *wrapped*
 * key + the KDF salt — useless without the passcode. This is all client-side;
 * the server never sees the passcode, the key, or the plaintext.
 */

export const PBKDF2_ITERATIONS = 210_000;

// Unambiguous alphabet — no 0/O/1/I/L to avoid transcription mistakes.
const PASSCODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generatePasscode(): string {
  const n = 10;
  const rnd = crypto.getRandomValues(new Uint8Array(n));
  let out = "";
  for (let i = 0; i < n; i++) out += PASSCODE_ALPHABET[rnd[i] % PASSCODE_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export async function derivePasscodeKey(passcode: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode.trim()),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Wrap a raw (base64url) file key with the passcode-derived key.
export async function wrapKey(rawKeyB64url: string, kek: CryptoKey): Promise<string> {
  const raw = b64urlDecode(rawKeyB64url);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, raw);
  const out = new Uint8Array(12 + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), 12);
  return b64urlEncode(out);
}

// Unwrap back to the raw (base64url) file key. Throws on a wrong passcode
// (AES-GCM authentication failure) — that's how we detect bad passcodes.
export async function unwrapKey(wrappedB64url: string, kek: CryptoKey): Promise<string> {
  const data = b64urlDecode(wrappedB64url);
  const iv = data.slice(0, 12);
  const cipher = data.slice(12);
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, cipher);
  return b64urlEncode(new Uint8Array(raw));
}
