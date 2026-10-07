const ROOFING = /\b(re-?roof|roof(ing)?|shingle)\b/i;

export function isRoofingWork(parts: {
  workDescription?: string;
  subtype?: string;
  folderName?: string;
}): boolean {
  return [parts.workDescription, parts.subtype, parts.folderName].some(
    (p) => typeof p === "string" && ROOFING.test(p),
  );
}
