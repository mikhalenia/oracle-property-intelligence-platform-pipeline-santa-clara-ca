export function normalizeApn(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || /[eE]/.test(trimmed)) return null;
  const digits = trimmed.replace(/-/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
}
