import { useCallback, useRef, useState } from "react";
import {
  CheckCheck,
  Clock,
  Copy,
  FileText,
  Lock,
  Plus,
  TriangleAlert,
  Upload,
  X,
  // TriangleAlert kept for error-box
} from "lucide-react";
import {
  b64urlEncode,
  derivePasscodeKey,
  encryptPayload,
  exportKey,
  generateKey,
  generatePasscode,
  PBKDF2_ITERATIONS,
  wrapKey,
} from "../lib/crypto";
import { uploadEncrypted } from "../lib/uploader";
import { encodeManifest, fmtSize, type ManifestItem } from "../lib/manifest";
import { formatExpiry } from "../lib/expiry";

type Mode = "file" | "note";
type Status = "idle" | "processing" | "done" | "error";

interface UploadState {
  name: string;
  status: "pending" | "active" | "done";
  progress: number;
}

type ExpiryOption = "1h" | "24h" | "7d" | "30d";

const EXPIRY_LABELS: Record<ExpiryOption, string> = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

function expiryToDate(opt: ExpiryOption): Date {
  const ms: Record<ExpiryOption, number> = {
    "1h":  60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d":  7  * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(Date.now() + ms[opt]);
}

export function SecureUploader() {
  const [mode, setMode] = useState<Mode>("file");
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [expiry, setExpiry] = useState<ExpiryOption>("7d");
  const [status, setStatus] = useState<Status>("idle");
  const [uploadStates, setUploadStates] = useState<UploadState[]>([]);

  // After upload: unified link (all-in-one), bare link, and passcode separately
  const [unifiedUrl, setUnifiedUrl] = useState("");
  const [bareUrl, setBareUrl] = useState("");
  const [passcode, setPasscode] = useState("");

  const [copiedUnified, setCopiedUnified] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedPasscode, setCopiedPasscode] = useState(false);

  const [expiryLabel, setExpiryLabel] = useState<string | null>(null);
  const [expiryExpired, setExpiryExpired] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFileRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...arr.filter((f) => !seen.has(f.name + f.size))];
    });
  }, []);

  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      setMode("file");
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleShare = async () => {
    try {
      setStatus("processing");
      setError("");

      const expiresAt = expiryToDate(expiry).toISOString();
      const manifest: ManifestItem[] = [];

      if (mode === "note") {
        const key = await generateKey();
        const content = new TextEncoder().encode(note).buffer as ArrayBuffer;
        const encrypted = await encryptPayload(key, "note.txt", "text/plain", content);
        setUploadStates([{ name: "note.txt", status: "active", progress: 0 }]);

        const id = await uploadEncrypted(
          encrypted,
          {
            onProgress: (f) => setUploadStates([{ name: "note.txt", status: "active", progress: f }]),
            onError: (e) => { throw e; },
          },
          { expiresAt },
        );

        manifest.push({ id, key: await exportKey(key), name: "note.txt", size: content.byteLength, mime: "text/plain", expiresAt });
        setUploadStates([{ name: "note.txt", status: "done", progress: 1 }]);
      } else {
        setUploadStates(files.map((f) => ({ name: f.name, status: "pending", progress: 0 })));

        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          setUploadStates((s) => s.map((x, j) => j === i ? { ...x, status: "active", progress: 0 } : x));

          const key = await generateKey();
          const content = await f.arrayBuffer();
          const encrypted = await encryptPayload(key, f.name, f.type || "application/octet-stream", content);

          const id = await uploadEncrypted(
            encrypted,
            {
              onProgress: (fr) => setUploadStates((s) => s.map((x, j) => j === i ? { ...x, progress: fr } : x)),
              onError: (e) => { throw e; },
            },
            { expiresAt },
          );

          manifest.push({ id, key: await exportKey(key), name: f.name, size: f.size, mime: f.type || "application/octet-stream", expiresAt });
          setUploadStates((s) => s.map((x, j) => j === i ? { ...x, status: "done", progress: 1 } : x));
        }
      }

      // Always wrap keys with a generated passcode (PBKDF2 + AES-KW)
      const pc = generatePasscode();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const kek = await derivePasscodeKey(pc, salt);
      const wrapped = await Promise.all(
        manifest.map(async (it) => ({ ...it, key: await wrapKey(it.key, kek) })),
      );
      const envelope = {
        v: 2,
        protection: "passcode" as const,
        kdf: { salt: b64urlEncode(salt), iterations: PBKDF2_ITERATIONS },
        items: wrapped,
      };

      const encoded = encodeManifest(envelope);
      const bare = `${window.location.origin}/d/m#${encoded}`;
      const unified = `${bare}~${b64urlEncode(new TextEncoder().encode(pc))}`;

      setBareUrl(bare);
      setUnifiedUrl(unified);
      setPasscode(pc);

      const { label, expired } = formatExpiry(expiresAt);
      setExpiryLabel(label);
      setExpiryExpired(expired);

      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  };

  const makeCopier = (text: string, set: (v: boolean) => void) => async () => {
    await navigator.clipboard.writeText(text);
    set(true);
    setTimeout(() => set(false), 2000);
  };

  const reset = () => {
    setMode("file");
    setFiles([]);
    setNote("");
    setExpiry("7d");
    setStatus("idle");
    setUploadStates([]);
    setUnifiedUrl("");
    setBareUrl("");
    setPasscode("");
    setExpiryLabel(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
    if (addFileRef.current) addFileRef.current.value = "";
  };

  const ready = mode === "file" ? files.length > 0 : note.trim().length > 0;
  const busy = status === "processing";

  return (
    <>
      {(status === "idle" || status === "error") && (
        <>
          <div className="mode-toggle">
            <button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>Files</button>
            <button className={mode === "note" ? "active" : ""} onClick={() => setMode("note")}>Note</button>
          </div>

          {mode === "file" ? (
            files.length === 0 ? (
              <div
                className={`drop-zone${dragOver ? " drag-over" : ""}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
                <div className="drop-hint">
                  <Upload size={20} className="drop-hint-icon" />
                  <strong>Drop files or click to browse</strong>
                  <span>Multiple files · up to 500 MB each · encrypted before upload</span>
                </div>
              </div>
            ) : (
              <>
                <span className="eyebrow">{files.length} file{files.length > 1 ? "s" : ""} selected</span>
                <div className="file-list">
                  {files.map((f, i) => (
                    <div className="file-list-item" key={f.name + f.size}>
                      <FileText size={14} className="row-icon" />
                      <div className="row-body">
                        <div className="fname">{f.name}</div>
                        <div className="fsize">{fmtSize(f.size)}</div>
                      </div>
                      <button className="remove-btn" onClick={() => removeFile(i)}><X size={13} /></button>
                    </div>
                  ))}
                </div>
                <button className="add-more-btn" title="Add more files to this share" onClick={() => addFileRef.current?.click()}>
                  <input ref={addFileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
                  <Plus size={12} /> Add more files
                </button>
              </>
            )
          ) : (
            <>
              <textarea
                className="note-input"
                placeholder="Type your secure note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              {note.length > 0 && (
                <span className="eyebrow" style={{ textAlign: "right", marginTop: -6 }}>
                  {note.length} character{note.length !== 1 ? "s" : ""}
                </span>
              )}
            </>
          )}

          {/* Expiry picker */}
          <div className="expiry-row">
            <Clock size={11} className="expiry-row-icon" />
            <span className="expiry-row-label">Expires after</span>
            <div className="expiry-options">
              {(Object.keys(EXPIRY_LABELS) as ExpiryOption[]).map((opt) => (
                <button key={opt} className={`expiry-opt${expiry === opt ? " active" : ""}`} onClick={() => setExpiry(opt)}>
                  {EXPIRY_LABELS[opt]}
                </button>
              ))}
            </div>
          </div>

          {status === "error" && (
            <div className="error-box" style={{ marginBottom: 8 }}>
              <TriangleAlert size={14} />
              <span>{error}</span>
            </div>
          )}

          <button className="btn-primary" onClick={handleShare} disabled={!ready}>
            <Lock size={13} />
            {files.length > 1 ? `Encrypt & share ${files.length} files` : "Encrypt & share"}
          </button>
        </>
      )}

      {busy && (
        <div className="status-block">
          <div className="status-label">
            {mode === "note" ? "Encrypting & uploading…" : `Uploading ${uploadStates.length} file${uploadStates.length > 1 ? "s" : ""}…`}
          </div>
          <div className="upload-list">
            {uploadStates.map((s) => (
              <div className="upload-list-item" key={s.name}>
                <div className={`upload-status-dot ${s.status}`} />
                <span className="fname">{s.name}</span>
                {s.status === "active" && <span className="upload-progress-pct">{Math.round(s.progress * 100)}%</span>}
              </div>
            ))}
          </div>
          <p className="status-hint">Files are encrypted in your browser. The server only receives ciphertext.</p>
        </div>
      )}

      {status === "done" && (
        <div className="done-block">
          <h2 className="done-heading">Ready to share</h2>

          {/* Panel 1: single unified link */}
          <div className="share-panel">
            <div className="share-panel-title">Share this</div>
            <div className="url-row">
              <input readOnly className="url-input" value={unifiedUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button className={`btn-copy${copiedUnified ? " copied" : ""}`} onClick={makeCopier(unifiedUrl, setCopiedUnified)}>
                {copiedUnified ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
          </div>

          {/* Panel 2: link + passcode separately */}
          <div className="share-panel">
            <div className="share-panel-title">Or share separately</div>
            <div className="url-row" style={{ marginBottom: 6 }}>
              <input readOnly className="url-input" value={bareUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button className={`btn-copy${copiedLink ? " copied" : ""}`} onClick={makeCopier(bareUrl, setCopiedLink)}>
                {copiedLink ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Link</>}
              </button>
            </div>
            <div className="url-row">
              <input readOnly className="url-input passcode-display" value={passcode} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button className={`btn-copy${copiedPasscode ? " copied" : ""}`} onClick={makeCopier(passcode, setCopiedPasscode)}>
                {copiedPasscode ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Code</>}
              </button>
            </div>
          </div>

          {/* Footer strip: expiry + privacy note */}
          <div className={`share-footer${expiryExpired ? " expired" : ""}`}>
            <span>{expiryLabel ?? "Link active"} · Anyone with the link and code can read the file{uploadStates.length > 1 ? "s" : ""}.</span>
          </div>

          <button className="btn-ghost" onClick={reset}>Share another</button>
        </div>
      )}
    </>
  );
}
