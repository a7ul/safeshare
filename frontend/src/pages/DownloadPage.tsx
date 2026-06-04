import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCheck,
  Clock,
  Download,
  FileText,
  Lock,
  TriangleAlert,
} from "lucide-react";
import { decryptPayload, importKey } from "../lib/crypto";
import { decodeManifest, fmtSize, type ManifestItem } from "../lib/manifest";
import { fetchExpiry, formatExpiry } from "../lib/expiry";
import { useConfig } from "../hooks/useConfig";

type PageStatus = "loading" | "decrypting" | "ready" | "error";
type FileStatus = "idle" | "downloading" | "done";

interface FileEntry extends ManifestItem {
  dlStatus: FileStatus;
  _blob?: Blob;
  _text?: string;
}

export function DownloadPage() {
  const { id } = useParams<{ id: string }>();
  const [pageStatus, setPageStatus] = useState<PageStatus>("loading");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expiryLabel, setExpiryLabel] = useState<string | null>(null);
  const [expiryExpired, setExpiryExpired] = useState(false);
  const [error, setError] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);
  const cancelRef = useRef(false);
  const { logoUrl, title } = useConfig();

  useEffect(() => {
    let cancelled = false;
    cancelRef.current = false;

    const run = async () => {
      try {
        const hash = window.location.hash.slice(1);
        if (!hash) throw new Error("No decryption key found in the URL.");
        if (!id) throw new Error("Invalid link.");

        if (id === "m") {
          // Manifest format: hash is base64 JSON array
          const manifest = decodeManifest(hash);
          if (cancelled) return;
          setEntries(manifest.map((m) => ({ ...m, dlStatus: "idle" })));
          setPageStatus("ready");

          // Auto-fetch and decrypt single text note for preview
          if (manifest.length === 1 && manifest[0].mime === "text/plain") {
            const item = manifest[0];
            const res = await fetch(`/api/files/${item.id}`);
            if (!cancelled && res.ok) {
              const encrypted = await res.arrayBuffer();
              const key = await importKey(item.key);
              const dec = await decryptPayload(key, encrypted);
              if (!cancelled) {
                const blob = new Blob([dec.content], { type: dec.mimeType });
                const text = new TextDecoder().decode(dec.content);
                setEntries([{ ...item, dlStatus: "idle", _blob: blob, _text: text }]);
              }
            }
          }

          // Read expiry directly from manifest — no server round-trip needed
          const embeddedExpiry = manifest[0].expiresAt;
          if (!cancelled && embeddedExpiry) {
            const { label, expired } = formatExpiry(embeddedExpiry);
            setExpiryLabel(label);
            setExpiryExpired(expired);
          }
        } else {
          // Legacy: id is UUID, hash is raw key
          setPageStatus("loading");
          const res = await fetch(`/api/files/${id}`);
          if (!res.ok) {
            throw new Error(
              res.status === 404
                ? "File not found. It may have been deleted or the link is invalid."
                : res.status === 410
                  ? "This link has expired."
                  : `Server error (${res.status}).`,
            );
          }
          const encrypted = await res.arrayBuffer();
          if (cancelled) return;
          setPageStatus("decrypting");

          const key = await importKey(hash);
          const dec = await decryptPayload(key, encrypted);
          if (cancelled) return;

          const blob = new Blob([dec.content], { type: dec.mimeType });
          const text = dec.mimeType.startsWith("text/")
            ? new TextDecoder().decode(dec.content)
            : undefined;

          setEntries([{
            id,
            key: hash,
            name: dec.filename,
            size: dec.content.byteLength,
            mime: dec.mimeType,
            expiresAt: "",
            dlStatus: "idle",
            _blob: blob,
            _text: text,
          }]);
          setPageStatus("ready");

          const exp = await fetchExpiry(id);
          if (!cancelled && exp) {
            const { label, expired } = formatExpiry(exp);
            setExpiryLabel(label);
            setExpiryExpired(expired);
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to decrypt.");
        setPageStatus("error");
      }
    };

    run();
    return () => { cancelled = true; cancelRef.current = true; };
  }, [id]);

  const triggerBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const downloadOne = async (entry: FileEntry, idx: number) => {
    setEntries((e) => e.map((x, i) => i === idx ? { ...x, dlStatus: "downloading" } : x));

    if (entry._blob) {
      triggerBlob(entry._blob, entry.name);
    } else {
      const res = await fetch(`/api/files/${entry.id}`);
      if (!res.ok) throw new Error(`Server error (${res.status}).`);
      const encrypted = await res.arrayBuffer();
      const key = await importKey(entry.key);
      const dec = await decryptPayload(key, encrypted);
      triggerBlob(new Blob([dec.content], { type: dec.mimeType }), dec.filename);
    }

    setEntries((e) => e.map((x, i) => i === idx ? { ...x, dlStatus: "done" } : x));
  };

  const downloadAll = async () => {
    setBulkRunning(true);
    cancelRef.current = false;
    for (let i = 0; i < entries.length; i++) {
      if (cancelRef.current) break;
      if (entries[i].dlStatus === "done") continue;
      try {
        await downloadOne(entries[i], i);
        await new Promise((r) => setTimeout(r, 350));
      } catch { /* continue */ }
    }
    setBulkRunning(false);
  };

  const singleEntry = entries.length === 1 ? entries[0] : null;
  const allDone = entries.length > 0 && entries.every((e) => e.dlStatus === "done");

  return (
    <div className="page">
      <div className="card">
        {/* Header */}
        <div className="brand-row">
          {logoUrl
            ? <img src={logoUrl} alt={title ?? ""} className="brand-logo" />
            : <Lock size={14} className="brand-icon" />}
          {title && <span className="card-title">{title}</span>}
        </div>

        {/* ── Loading ── */}
        {(pageStatus === "loading" || pageStatus === "decrypting") && (
          <>
            <h1 className="card-heading" style={{ marginBottom: 4 }}>
              {pageStatus === "decrypting" ? "Decrypting…" : "Fetching…"}
            </h1>
            <p className="card-subtitle">
              {pageStatus === "decrypting"
                ? "Decrypting in your browser. The server never sees the contents."
                : "Downloading encrypted file from server."}
            </p>
            <div className="progress-track">
              <div className="progress-bar" style={{ width: pageStatus === "decrypting" ? "70%" : "30%" }} />
            </div>
          </>
        )}

        {/* ── Ready ── */}
        {pageStatus === "ready" && entries.length > 0 && (
          <>
            <h1 className="card-heading" style={{ marginBottom: 4 }}>
              {entries.length === 1 ? "Your file is ready." : `${entries.length} files ready.`}
            </h1>
            <p className="card-subtitle" style={{ marginBottom: expiryLabel ? 8 : 20 }}>
              Decrypted entirely in your browser.
            </p>

            {expiryLabel && (
              <div className={`expiry-badge${expiryExpired ? " expired" : ""}`} style={{ marginBottom: 16 }}>
                <Clock size={11} />
                {expiryLabel}
              </div>
            )}

            {/* Single text note */}
            {singleEntry?._text ? (
              <>
                <div className="file-card" style={{ marginBottom: 10 }}>
                  <FileText size={15} className="file-card-icon" />
                  <div className="file-card-meta">
                    <div className="fname">{singleEntry.name}</div>
                    <div className="fsize">{fmtSize(singleEntry.size)}</div>
                  </div>
                </div>
                <textarea readOnly className="note-preview" value={singleEntry._text} />
              </>
            ) : singleEntry ? (
              /* Single file */
              <div className="file-card" style={{ marginBottom: 10 }}>
                <FileText size={15} className="file-card-icon" />
                <div className="file-card-meta">
                  <div className="fname">{singleEntry.name}</div>
                  <div className="fsize">{fmtSize(singleEntry.size)}</div>
                </div>
              </div>
            ) : (
              /* Multiple files */
              <div className="download-file-list" style={{ marginBottom: 10 }}>
                {entries.map((e, i) => (
                  <div className="download-file-item" key={e.id}>
                    <FileText size={14} className="file-icon" />
                    <div className="file-meta">
                      <div className="fname">{e.name}</div>
                      {e.size > 0 && <div className="fsize">{fmtSize(e.size)}</div>}
                    </div>
                    <button
                      className={`btn-dl${e.dlStatus === "done" ? " done" : ""}`}
                      onClick={() => downloadOne(e, i)}
                      disabled={e.dlStatus === "downloading" || bulkRunning}
                    >
                      {e.dlStatus === "done"
                        ? <><CheckCheck size={11} /> Done</>
                        : e.dlStatus === "downloading"
                          ? <span>…</span>
                          : <><Download size={11} /> Save</>}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {entries.length === 1 ? (
              <button
                className="btn-primary"
                onClick={() => downloadOne(entries[0], 0)}
                disabled={entries[0].dlStatus === "downloading"}
              >
                <Download size={13} />
                {entries[0].dlStatus === "done" ? "Downloaded" : (singleEntry?._text ? "Download note" : "Download file")}
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={downloadAll}
                disabled={bulkRunning || allDone}
              >
                <Download size={13} />
                {bulkRunning ? "Downloading…" : allDone ? "All downloaded" : `Download all ${entries.length} files`}
              </button>
            )}

            <p className="status-hint" style={{ marginTop: 10 }}>
              The server never saw the contents of {entries.length === 1 ? "this file" : "these files"}.
            </p>
          </>
        )}

        {/* ── Error ── */}
        {pageStatus === "error" && (
          <>
            <h1 className="card-heading" style={{ marginBottom: 4 }}>Something went wrong.</h1>
            <p className="card-subtitle">We couldn't decrypt this link.</p>
            <div className="error-box">
              <TriangleAlert size={14} />
              <span>{error}</span>
            </div>
            <p className="status-hint" style={{ marginTop: 10 }}>
              Make sure you have the full link including the key after #.
            </p>
          </>
        )}

        {/* ── Footer CTA ── */}
        <div style={{ borderTop: "1px solid var(--pebble)", marginTop: 24, paddingTop: 20 }}>
          <a href="/" className="btn-outline" style={{ display: "flex", textDecoration: "none", marginTop: 0 }}>
            <Lock size={13} /> Share your own file securely
          </a>
        </div>
      </div>
    </div>
  );
}
