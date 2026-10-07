export type StepName = "ingest" | "export" | "publish" | "verify" | "sync";

export type PipelineSteps = {
  /** Creates a run and returns its id. */
  ingest: () => Promise<string>;
  export: (runId: string) => Promise<void>;
  /** Resolves "skipped" when nothing changed since the previous published run. */
  publish: (runId: string) => Promise<void | "skipped">;
  verify: (runId: string) => Promise<void>;
  sync: (runId: string) => Promise<void>;
};

export type PipelineResult = { ok: boolean; runId?: string | undefined; summary: string };

const ORDER = ["export", "publish", "verify", "sync"] as const;

/**
 * Runs ingest -> export -> publish -> verify -> sync for one run id, stopping at the first failure,
 * or successfully after publish when it skipped an unchanged run.
 */
export async function runPipeline(steps: PipelineSteps): Promise<PipelineResult> {
  const done: StepName[] = [];
  let runId: string | undefined;
  let current: StepName = "ingest";
  const label = () => (runId ? `run ${runId}` : "run");
  try {
    runId = await steps.ingest();
    done.push("ingest");
    for (const name of ORDER) {
      current = name;
      if ((await steps[name](runId)) === "skipped")
        return {
          ok: true,
          runId,
          summary: `${label()}: completed ${done.join(", ")}; ${name} skipped (nothing changed), so verify and sync were not run`,
        };
      done.push(name);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      runId,
      summary: `${label()}: completed ${done.join(", ") || "none"}; failed at ${current}: ${msg}`,
    };
  }
  return { ok: true, runId, summary: `${label()}: completed ${done.join(", ")}` };
}
