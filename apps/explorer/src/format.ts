export const num = (n: number) => n.toLocaleString("en-US");
export const shortCid = (cid: string) =>
  cid.length > 18 ? `${cid.slice(0, 10)}…${cid.slice(-6)}` : cid;
export const shortHash = (h: string) => h.slice(0, 12);
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KiB", "MiB", "GiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}
