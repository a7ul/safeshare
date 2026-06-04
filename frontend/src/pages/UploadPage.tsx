import { Lock } from "lucide-react";
import { SecureUploader } from "../components/SecureUploader";
import { useConfig } from "../hooks/useConfig";

export function UploadPage() {
  const { logoUrl, title } = useConfig();

  return (
    <div className="page">
      <div className="card">
        <div className="brand-row">
          {logoUrl
            ? <img src={logoUrl} alt={title ?? ""} className="brand-logo" />
            : <Lock size={14} className="brand-icon" />}
          {title && <span className="card-title">{title}</span>}
        </div>
        <h1 className="card-heading">Share files, notes and secrets securely.</h1>
        <p className="card-subtitle">End-to-end encrypted between your browser and the receiver. No information is visible to the server.</p>
        <SecureUploader />
      </div>
    </div>
  );
}
