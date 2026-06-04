import { useCallback, useRef, useState } from "react";
import {
  CheckCheck,
  Copy,
  FileText,
  Lock,
  Plus,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { BrandRow } from "./BrandRow";
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

interface SecureUploaderProps {
  logoUrl?: string | null;
  title?: string | null;
  onDone?: () => void;
  onReset?: () => void;
}

export function SecureUploader({ logoUrl, title, onDone, onReset }: SecureUploaderProps = {}) {
  const [mode, setMode] = useState<Mode>("file");
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [expiry, setExpiry] = useState<ExpiryOption>("7d");
  const [status, setStatus] = useState<Status>("idle");
  const [uploadStates, setUploadStates] = useState<UploadState[]>([]);

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
      onDone?.();
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
    onReset?.();
  };

  const ready = mode === "file" ? files.length > 0 : note.trim().length > 0;
  const busy = status === "processing";

  return (
    <>
      {/* ── Idle / error ── */}
      {(status === "idle" || status === "error") && (
        <>
          {/* Mode tabs */}
          <div className="mode-tabs">
            <button className={`mode-tab${mode === "file" ? " active" : ""}`} onClick={() => setMode("file")}>Files</button>
            <button className={`mode-tab${mode === "note" ? " active" : ""}`} onClick={() => setMode("note")}>Note</button>
          </div>

          {/* Content area */}
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
                  <Upload size={28} className="drop-hint-icon" />
                  <strong>Drop files or click to browse</strong>
                  <span>Up to 500 MB per file · encrypted before upload</span>
                </div>
              </div>
            ) : (
              <>
                <span className="section-label" style={{ marginBottom: 8 }}>{files.length} file{files.length > 1 ? "s" : ""} selected</span>
                <div className="file-list" style={{ marginBottom: 8 }}>
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
                <button className="add-more-btn" onClick={() => addFileRef.current?.click()}>
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
                <span className="note-char-count">{note.length} character{note.length !== 1 ? "s" : ""}</span>
              )}
            </>
          )}

          {/* Expiry */}
          <div className="expiry-section">
            <span className="section-label">Expires after</span>
            <div className="expiry-options">
              {(Object.keys(EXPIRY_LABELS) as ExpiryOption[]).map((opt) => (
                <button key={opt} className={`expiry-opt${expiry === opt ? " active" : ""}`} onClick={() => setExpiry(opt)}>
                  {EXPIRY_LABELS[opt]}
                </button>
              ))}
            </div>
          </div>

          {status === "error" && (
            <div className="error-box" style={{ marginBottom: 12 }}>
              <TriangleAlert size={14} />
              <span>{error}</span>
            </div>
          )}

          <button className="btn-primary" onClick={handleShare} disabled={!ready}>
            <Lock size={14} />
            {files.length > 1 ? `Encrypt & share ${files.length} files` : "Encrypt & share"}
          </button>
        </>
      )}

      {/* ── Uploading ── */}
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
          <p className="status-hint">Encrypting in your browser. The server receives only the encrypted result.</p>
        </div>
      )}

      {/* ── Done ── */}
      {status === "done" && (
        <div className="share-block">
          {/* Full header replaces upload page header */}
          <BrandRow logoUrl={logoUrl ?? null} title={title ?? null} />
          <h1 className="page-heading">Ready to share.</h1>
          <p className="page-subtitle">
            {expiryLabel ?? "Active"} · Anyone with this link can access the file. You can delete it at any time.
          </p>

          {/* Card 1: unified link */}
          <div className="share-card">
            <p className="share-card-title">Direct link</p>
            <p className="share-card-desc">Send this one link. The recipient can open it directly, no extra steps.</p>
            <div className="share-url-row">
              <input readOnly className="share-url-input" value={unifiedUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button className={`btn-copy${copiedUnified ? " copied" : ""}`} onClick={makeCopier(unifiedUrl, setCopiedUnified)}>
                {copiedUnified ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
          </div>

          {/* Card 2: link + passcode separately */}
          <div className="share-card">
            <p className="share-card-title">Send separately</p>
            <p className="share-card-desc">Split the link and secret across two channels for extra security. e.g. link by email, secret by SMS.</p>
            <p className="share-field-label">Link</p>
            <div className="share-url-row" style={{ marginBottom: 10 }}>
              <input readOnly className="share-url-input" value={bareUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button className={`btn-copy${copiedLink ? " copied" : ""}`} onClick={makeCopier(bareUrl, setCopiedLink)}>
                {copiedLink ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
            <p className="share-field-label">Secret</p>
            <div className="share-url-row">
              <input readOnly className="share-url-input passcode-display" value={passcode} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button className={`btn-copy${copiedPasscode ? " copied" : ""}`} onClick={makeCopier(passcode, setCopiedPasscode)}>
                {copiedPasscode ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
          </div>

          <div className="share-actions" style={{ marginTop: 8 }}>
            <button className="btn-ghost" onClick={reset}>Share another</button>
          </div>
        </div>
      )}
    </>
  );
}
