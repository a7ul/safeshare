import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { SecureUploader } from "../components/SecureUploader";
import { BrandRow } from "../components/BrandRow";
import { useConfig } from "../hooks/useConfig";

export function UploadPage() {
  const { logoUrl, title } = useConfig();
  const [isDone, setIsDone] = useState(false);

  return (
    <div className="page">
      <div className="card">
        {isDone ? (
          <SecureUploader
            logoUrl={logoUrl}
            title={title}
            onDone={() => setIsDone(true)}
            onReset={() => setIsDone(false)}
          />
        ) : (
          <>
            <BrandRow logoUrl={logoUrl} title={title} />
            <h1 className="page-heading">Share files, notes<br />and secrets securely.</h1>
            <p className="page-subtitle">
              End-to-end encrypted in your browser. The server only ever stores ciphertext. It cannot read what you send.
            </p>
            <SecureUploader
              logoUrl={logoUrl}
              title={title}
              onDone={() => setIsDone(true)}
              onReset={() => setIsDone(false)}
            />
            <div className="how-link-row">
              <a href="/how-it-works" className="text-link">
                <HelpCircle size={12} /> How it works
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
