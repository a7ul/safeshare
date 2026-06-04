export async function fetchExpiry(id: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/meta/${id}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { expiresAt?: string };
    return data.expiresAt ?? null;
  } catch {
    return null;
  }
}

export function formatExpiry(expiresAt: string): { label: string; expired: boolean } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { label: "Expired", expired: true };
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor(diff / 3_600_000);
  if (days > 1) return { label: `Expires in ${days} days`, expired: false };
  if (days === 1) return { label: "Expires in 1 day", expired: false };
  if (hours > 1) return { label: `Expires in ${hours} hours`, expired: false };
  return { label: "Expires soon", expired: false };
}
