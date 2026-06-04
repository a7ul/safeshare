import { HelpCircle, Lock } from "lucide-react";
import { SecureUploader } from "../components/SecureUploader";
import { BrandRow } from "../components/BrandRow";
import { useConfig } from "../hooks/useConfig";

export function UploadPage() {
  const { logoUrl, title } = useConfig();

  return (
    <div className="page">
      <div className="card">
        <BrandRow logoUrl={logoUrl} title={title} />
        <span className="section-label">Secure sharing</span>
        <h1 className="page-heading">Share files, notes<br />and secrets securely.</h1>
        <p className="page-subtitle">
          End-to-end encrypted in your browser. The server only ever stores ciphertext — it cannot read what you send.
        </p>
        <SecureUploader />
        <div className="how-link-row">
          <a href="/how-it-works" className="text-link">
            <HelpCircle size={12} /> How it works
          </a>
        </div>
      </div>
    </div>
  );
}
