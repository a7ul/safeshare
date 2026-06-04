import { useEffect, useState } from "react";

interface AppConfig {
  logoUrl: string | null;
  title: string | null;
}

let cached: AppConfig | undefined;

export function useConfig(): AppConfig {
  const [config, setConfig] = useState<AppConfig>(
    cached ?? { logoUrl: null, title: null },
  );

  useEffect(() => {
    if (cached !== undefined) return;
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        cached = {
          logoUrl: (cfg.logoUrl as string | null | undefined) ?? null,
          title: (cfg.title as string | null | undefined) ?? null,
        };
        setConfig(cached);
      })
      .catch(() => {
        cached = { logoUrl: null, title: null };
      });
  }, []);

  return config;
}
