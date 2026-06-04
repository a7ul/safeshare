import { useState } from "react";
import { Lock } from "lucide-react";

interface BrandRowProps {
  logoUrl: string | null;
  title: string | null;
}

export function BrandRow({ logoUrl, title }: BrandRowProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showLogo = logoUrl && !imgFailed;

  return (
    <div className="brand-row">
      {showLogo
        ? <img src={logoUrl} alt={title ?? ""} className="brand-logo" onError={() => setImgFailed(true)} />
        : <Lock size={15} className="brand-icon" />}
      {title && <span className="brand-name">{title}</span>}
    </div>
  );
}
