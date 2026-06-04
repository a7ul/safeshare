import { HelpCircle } from "lucide-react";
import { SecureUploader } from "../components/SecureUploader";
import { BrandRow } from "../components/BrandRow";
import { useConfig } from "../hooks/useConfig";

export function UploadPage() {
  const { logoUrl, title } = useConfig();

  return (
    <div className="page">
      <div className="card">
        <BrandRow logoUrl={logoUrl} title={title} />
        <h1 className="card-heading">Share files, notes and secrets securely.</h1>
        <p className="card-subtitle">End-to-end encrypted between your browser and the receiver. No information is visible to the server.</p>
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
