const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/;

export function parseUsDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = US_DATE.exec(raw.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.floor(ms / 86_400_000);
}
