import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCheck,
  Clock,
  Download,
  FileText,
  HelpCircle,
  KeyRound,
  Lock,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  b64urlDecode,
  decryptPayload,
  derivePasscodeKey,
  importKey,
  unwrapKey,
} from "../lib/crypto";
import { decodeManifest, fmtSize, type Manifest, type ManifestItem } from "../lib/manifest";
import { fetchExpiry, formatExpiry } from "../lib/expiry";
import { useConfig } from "../hooks/useConfig";

type PageStatus = "loading" | "decrypting" | "ready" | "error" | "deleted" | "passcode";
type FileStatus = "idle" | "downloading" | "done";
type DeleteStatus = "idle" | "confirm" | "deleting" | "error";

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
  const [deleteStatus, setDeleteStatus] = useState<DeleteStatus>("idle");
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [lockedCount, setLockedCount] = useState(0);
  const cancelRef = useRef(false);
  const lockedRef = useRef<{ items: ManifestItem[]; kdf: Manifest["kdf"] } | null>(null);
  const { logoUrl, title } = useConfig();

  // Render entries from raw (unwrapped) manifest items and, for a single text
  // note, fetch + decrypt a preview. Used by both the open and passcode paths.
  const revealEntries = async (rawItems: ManifestItem[]) => {
    setEntries(rawItems.map((m) => ({ ...m, dlStatus: "idle" })));
    setPageStatus("ready");

    if (rawItems.length === 1 && rawItems[0].mime === "text/plain") {
      try {
        const item = rawItems[0];
        const res = await fetch(`/api/files/${item.id}`);
        if (!cancelRef.current && res.ok) {
          const encrypted = await res.arrayBuffer();
          const key = await importKey(item.key);
          const dec = await decryptPayload(key, encrypted);
          if (!cancelRef.current) {
            const blob = new Blob([dec.content], { type: dec.mimeType });
            const text = new TextDecoder().decode(dec.content);
            setEntries([{ ...item, dlStatus: "idle", _blob: blob, _text: text }]);
          }
        }
      } catch { /* preview is best-effort */ }
    }
  };

  // Derive the key from the passcode, unwrap every file key, then reveal.
  // A wrong passcode makes unwrapKey throw (AES-GCM auth failure).
  const unlock = async (passcode: string, fromLink = false) => {
    const locked = lockedRef.current;
    if (!locked || !locked.kdf) return;
    setUnlocking(true);
    setPasscodeError("");
    try {
      const kek = await derivePasscodeKey(passcode, b64urlDecode(locked.kdf.salt));
      const rawItems = await Promise.all(
        locked.items.map(async (it) => ({ ...it, key: await unwrapKey(it.key, kek) })),
      );
      await revealEntries(rawItems);
    } catch {
      if (fromLink) {
        setError("This link's passcode is invalid or the link is corrupted.");
        setPageStatus("error");
      } else {
        setPasscodeError("Incorrect passcode. Check it and try again.");
      }
    } finally {
      setUnlocking(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    cancelRef.current = false;

    const run = async () => {
      try {
        const rawHash = window.location.hash.slice(1);
        if (!rawHash) throw new Error("No decryption key found in the URL.");
        if (!id) throw new Error("Invalid link.");

        if (id === "m") {
          // Manifest format. Fragment is "<manifest>" or, for a unified link,
          // "<manifest>~<passcode>". Neither half is ever sent to the server.
          const [manifestPart, passPart] = rawHash.split("~");
          const manifest = decodeManifest(manifestPart);
          const items = manifest.items;
          if (!items || items.length === 0) throw new Error("This link is empty or malformed.");
          if (cancelled) return;

          // Expiry is in the manifest (cleartext) — show it without a round-trip.
          const embeddedExpiry = items[0].expiresAt;
          if (embeddedExpiry) {
            const { label, expired } = formatExpiry(embeddedExpiry);
            setExpiryLabel(label);
            setExpiryExpired(expired);
          }

          if (manifest.protection === "passcode") {
            lockedRef.current = { items, kdf: manifest.kdf };
            setLockedCount(items.length);
            if (passPart) {
              // Unified link — passcode travels in the URL; unlock automatically.
              const pass = new TextDecoder().decode(b64urlDecode(passPart));
              await unlock(pass, true);
            } else {
              // Plain passcode — ask the recipient for it.
              setPageStatus("passcode");
            }
          } else {
            await revealEntries(items);
          }
        } else {
          // Legacy: id is a UUID, hash is the raw key.
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

          const key = await importKey(rawHash);
          const dec = await decryptPayload(key, encrypted);
          if (cancelled) return;

          const blob = new Blob([dec.content], { type: dec.mimeType });
          const text = dec.mimeType.startsWith("text/")
            ? new TextDecoder().decode(dec.content)
            : undefined;

          setEntries([{
            id,
            key: rawHash,
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

  // Delete the whole share. Anyone with the link holds every id in the
  // manifest, so holding the link is exactly what authorises deletion.
  const deleteShare = async () => {
    if (deleteStatus === "idle") {
      setDeleteStatus("confirm");
      return;
    }
    setDeleteStatus("deleting");
    cancelRef.current = true; // stop any in-flight bulk download
    try {
      const results = await Promise.all(
        entries.map((e) => fetch(`/api/files/${e.id}`, { method: "DELETE" })),
      );
      // 404 counts as success — the goal state (gone) is reached either way.
      const ok = results.every((r) => r.ok || r.status === 404);
      if (!ok) throw new Error("Some files couldn't be deleted. Please try again.");
      setPageStatus("deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
      setDeleteStatus("error");
    }
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

        {/* ── Passcode prompt ── */}
        {pageStatus === "passcode" && (
          <>
            <div className="trust-anchor">
              <ShieldCheck size={15} className="trust-anchor-icon" />
              <div className="trust-anchor-body">
                <strong>Privately shared with you</strong>
                <span>This share is passcode-protected. Enter the passcode the sender gave you to unlock it — it's checked entirely in your browser.</span>
              </div>
            </div>
            <h1 className="card-heading" style={{ marginTop: 16, marginBottom: 4 }}>Enter passcode</h1>
            <p className="card-subtitle">
              {lockedCount === 1 ? "1 file is" : `${lockedCount} files are`} waiting behind a passcode.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); if (passcodeInput.trim()) unlock(passcodeInput); }}>
              <input
                className="passcode-entry"
                autoFocus
                placeholder="Passcode — e.g. ABCDE-FGHIJ"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value.toUpperCase())}
              />
              {passcodeError && (
                <div className="error-box" style={{ marginBottom: 10 }}>
                  <TriangleAlert size={14} />
                  <span>{passcodeError}</span>
                </div>
              )}
              <button
                type="submit"
                className="btn-primary"
                disabled={unlocking || passcodeInput.trim().length === 0}
              >
                <KeyRound size={13} />
                {unlocking ? "Unlocking…" : "Unlock"}
              </button>
            </form>
            {expiryLabel && (
              <div className={`expiry-badge${expiryExpired ? " expired" : ""}`} style={{ marginTop: 12 }}>
                <Clock size={11} />
                {expiryLabel}
              </div>
            )}
          </>
        )}

        {/* ── Ready ── */}
        {pageStatus === "ready" && entries.length > 0 && (
          <>
            <div className="trust-anchor">
              <ShieldCheck size={15} className="trust-anchor-icon" />
              <div className="trust-anchor-body">
                <strong>Privately shared with you</strong>
                <span>End-to-end encrypted — decrypted only here in your browser. The server never saw the contents.</span>
              </div>
            </div>

            <h1 className="card-heading" style={{ marginTop: 16, marginBottom: 4 }}>
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

            {/* ── Delete control ── */}
            <div className="delete-row">
              {deleteStatus === "error" && (
                <div className="error-box" style={{ marginBottom: 10 }}>
                  <TriangleAlert size={14} />
                  <span>{error}</span>
                </div>
              )}
              {deleteStatus === "confirm" ? (
                <div className="delete-confirm">
                  <span className="delete-confirm-text">
                    Delete permanently? This removes {entries.length === 1 ? "the file" : `all ${entries.length} files`} from
                    the server for everyone — this can't be undone.
                  </span>
                  <div className="delete-confirm-actions">
                    <button className="btn-ghost" onClick={() => setDeleteStatus("idle")}>
                      Cancel
                    </button>
                    <button className="btn-danger" onClick={deleteShare}>
                      <Trash2 size={13} /> Delete forever
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn-delete-link"
                  onClick={deleteShare}
                  disabled={deleteStatus === "deleting"}
                >
                  <Trash2 size={12} />
                  {deleteStatus === "deleting" ? "Deleting…" : "Delete this link"}
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Deleted ── */}
        {pageStatus === "deleted" && (
          <>
            <div className="status-icon success" style={{ margin: "6px 0 16px" }}>
              <CheckCheck size={18} />
            </div>
            <h1 className="card-heading" style={{ marginBottom: 4 }}>Link deleted.</h1>
            <p className="card-subtitle">
              {entries.length === 1 ? "The file has" : "These files have"} been permanently removed
              from the server. This link no longer works.
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
          <div className="how-link-row">
            <a href="/how-it-works" className="text-link">
              <HelpCircle size={12} /> How it works
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
