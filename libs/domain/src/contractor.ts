import { createHash } from "node:crypto";

const LEGAL_SUFFIX = /\b(INC|INCORPORATED|LLC|L L C|CORP|CORPORATION|CO|COMPANY|LTD|LP)\b\.?/g;

export function splitContractor(raw: string): { companyName: string | null; contactName: string | null } {
  const text = raw.replace(/\s+$/, "");
  if (text.trim() === "") return { companyName: null, contactName: null };
  const idx = text.indexOf("  ");
  if (idx === -1) return { companyName: text.trim(), contactName: null };
  const company = text.slice(0, idx).trim();
  const contact = text.slice(idx).trim();
  return { companyName: company || null, contactName: contact || null };
}

export function normalizeCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,'"()&/-]/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contractorId(companyName: string): string {
  return createHash("sha256").update(normalizeCompanyName(companyName)).digest("hex").slice(0, 16);
}
