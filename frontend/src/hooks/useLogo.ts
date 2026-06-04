import { useEffect, useState } from "react";

let cachedLogoUrl: string | null | undefined = undefined;

export function useLogo(): string | null {
  const [logoUrl, setLogoUrl] = useState<string | null>(cachedLogoUrl ?? null);

  useEffect(() => {
    if (cachedLogoUrl !== undefined) return;
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        cachedLogoUrl = (cfg.logoUrl as string | null | undefined) ?? null;
        setLogoUrl(cachedLogoUrl);
      })
      .catch(() => { cachedLogoUrl = null; });
  }, []);

  return logoUrl;
}
