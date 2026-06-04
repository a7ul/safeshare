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
} from "lucide-react";
import { encryptPayload, exportKey, generateKey } from "../lib/crypto";
import { uploadEncrypted } from "../lib/uploader";
import { encodeManifest, fmtSize, type ManifestItem } from "../lib/manifest";
import { fetchExpiry, formatExpiry } from "../lib/expiry";

type Mode = "file" | "note";
type Status = "idle" | "processing" | "done" | "error";

interface UploadState {
  name: string;
  status: "pending" | "active" | "done";
  progress: number;
}

export function SecureUploader() {
  const [mode, setMode] = useState<Mode>("file");
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [uploadStates, setUploadStates] = useState<UploadState[]>([]);
  const [shareUrl, setShareUrl] = useState("");
  const [expiryLabel, setExpiryLabel] = useState<string | null>(null);
  const [expiryExpired, setExpiryExpired] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
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
      const manifest: ManifestItem[] = [];

      if (mode === "note") {
        const key = await generateKey();
        const content = new TextEncoder().encode(note).buffer as ArrayBuffer;
        const encrypted = await encryptPayload(key, "note.txt", "text/plain", content);
        setUploadStates([{ name: "note.txt", status: "active", progress: 0 }]);

        const id = await uploadEncrypted(encrypted, {
          onProgress: (fraction) => {
            setUploadStates([{ name: "note.txt", status: "active", progress: fraction }]);
          },
          onError: (e) => { throw e; },
        });

        manifest.push({
          id,
          key: await exportKey(key),
          name: "note.txt",
          size: content.byteLength,
          mime: "text/plain",
        });
        setUploadStates([{ name: "note.txt", status: "done", progress: 1 }]);
      } else {
        const states: UploadState[] = files.map((f) => ({ name: f.name, status: "pending", progress: 0 }));
        setUploadStates(states);

        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          setUploadStates((s) => s.map((x, j) => j === i ? { ...x, status: "active", progress: 0 } : x));

          const key = await generateKey();
          const content = await f.arrayBuffer();
          const encrypted = await encryptPayload(
            key,
            f.name,
            f.type || "application/octet-stream",
            content,
          );

          const id = await uploadEncrypted(encrypted, {
            onProgress: (fraction) => {
              setUploadStates((s) => s.map((x, j) => j === i ? { ...x, progress: fraction } : x));
            },
            onError: (e) => { throw e; },
          });

          manifest.push({
            id,
            key: await exportKey(key),
            name: f.name,
            size: f.size,
            mime: f.type || "application/octet-stream",
          });

          setUploadStates((s) => s.map((x, j) => j === i ? { ...x, status: "done", progress: 1 } : x));
        }
      }

      const encoded = encodeManifest(manifest);
      setShareUrl(`${window.location.origin}/d/m#${encoded}`);

      // Fetch expiry from first uploaded file
      const exp = await fetchExpiry(manifest[0].id);
      if (exp) {
        const { label, expired } = formatExpiry(exp);
        setExpiryLabel(label);
        setExpiryExpired(expired);
      }

      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setMode("file");
    setFiles([]);
    setNote("");
    setStatus("idle");
    setUploadStates([]);
    setShareUrl("");
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
            <button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>
              Files
            </button>
            <button className={mode === "note" ? "active" : ""} onClick={() => setMode("note")}>
              Note
            </button>
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
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => addFiles(e.target.files)}
                />
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
                      <button className="remove-btn" onClick={() => removeFile(i)}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="add-more-btn" title="Add more files to this share" onClick={() => addFileRef.current?.click()}>
                  <input
                    ref={addFileRef}
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => addFiles(e.target.files)}
                  />
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
                {s.status === "active" && (
                  <span className="upload-progress-pct">{Math.round(s.progress * 100)}%</span>
                )}
              </div>
            ))}
          </div>
          <p className="status-hint">Files are encrypted in your browser. The server only receives ciphertext.</p>
        </div>
      )}

      {status === "done" && (
        <div className="status-block">
          <div className="status-icon success">
            <CheckCheck size={17} />
          </div>
          <h2 className="section-heading">
            {uploadStates.length > 1 ? `${uploadStates.length} files ready to share` : "Ready to share"}
          </h2>
          <div className="url-row">
            <input
              readOnly
              className="url-input"
              value={shareUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className={`btn-copy${copied ? " copied" : ""}`} onClick={copy}>
              {copied ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          </div>
          {expiryLabel && (
            <div className={`expiry-badge${expiryExpired ? " expired" : ""}`}>
              <Clock size={11} />
              {expiryLabel}
            </div>
          )}
          <div className="notice">
            <TriangleAlert size={12} />
            <span>The decryption key is in this link. Anyone with it can read the file{uploadStates.length > 1 ? "s" : ""}. Share over a trusted channel.</span>
          </div>
          <button className="btn-ghost" onClick={reset}>Share another</button>
        </div>
      )}
    </>
  );
}
