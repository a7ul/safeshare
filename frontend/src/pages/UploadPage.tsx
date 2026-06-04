import { Lock } from "lucide-react";
import { SecureUploader } from "../components/SecureUploader";
import { useLogo } from "../hooks/useLogo";

export function UploadPage() {
  const logoUrl = useLogo();

  return (
    <div className="page">
      <div className="card">
        <div className="brand-row">
          {logoUrl
            ? <img src={logoUrl} alt="logo" className="brand-logo" />
            : <Lock size={14} className="brand-icon" />}
          {!logoUrl && <span className="card-title">Secure File Share</span>}
        </div>
        {logoUrl && <span className="card-title" style={{ marginBottom: 2 }}>Secure File Share</span>}
        <h1 className="card-heading">Share anything, privately.</h1>
        <p className="card-subtitle">End-to-end encrypted — the server never sees your content.</p>
        <SecureUploader />
      </div>
    </div>
  );
}
