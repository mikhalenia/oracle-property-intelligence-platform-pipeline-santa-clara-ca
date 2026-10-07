export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Groups tuples into size-bound statements and statements into files. */
export class Chunker {
  private pending: string[] = [];
  constructor(private readonly perFile: number) {}
  /** Adds a statement; returns a file body when enough statements have accumulated. */
  add(stmt: string): string | undefined {
    this.pending.push(stmt);
    return this.pending.length >= this.perFile ? this.take() : undefined;
  }
  take(): string | undefined {
    if (this.pending.length === 0) return undefined;
    const out = `${this.pending.join("\n")}\n`;
    this.pending = [];
    return out;
  }
}

/** Accumulates tuples under `head`/`tail`, emitting a statement when the size or row bound is hit. */
export class Batcher {
  private tuples: string[] = [];
  private size: number;
  constructor(
    private readonly head: string,
    private readonly tail: string,
    private readonly maxRows: number,
    private readonly maxBytes: number,
  ) {
    this.size = head.length + 1;
  }
  add(tuple: string): string | undefined {
    let out: string | undefined;
    if (
      this.tuples.length > 0 &&
      (this.size + tuple.length + 2 > this.maxBytes || this.tuples.length >= this.maxRows)
    )
      out = this.flush();
    this.tuples.push(tuple);
    this.size += tuple.length + 2;
    return out;
  }
  flush(): string | undefined {
    if (this.tuples.length === 0) return undefined;
    const out = `${this.head}${this.tuples.join(",\n")}${this.tail}`;
    this.tuples = [];
    this.size = this.head.length + 1;
    return out;
  }
}
