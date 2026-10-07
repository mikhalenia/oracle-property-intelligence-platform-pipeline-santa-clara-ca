import { describe, expect, it } from "vitest";
import { runPipeline, type StepName } from "./run";

function fakes(failAt?: StepName) {
  const calls: string[] = [];
  const step = (name: StepName) => async (runId: string) => {
    calls.push(`${name}:${runId}`);
    if (name === failAt) throw new Error(`${name} boom`);
  };
  return {
    calls,
    steps: {
      ingest: async () => {
        calls.push("ingest");
        return "run-1";
      },
      export: step("export"),
      publish: step("publish"),
      verify: step("verify"),
      sync: step("sync"),
    },
  };
}

describe("runPipeline", () => {
  it("runs all steps in order with the run id from ingest", async () => {
    const f = fakes();
    const res = await runPipeline(f.steps);
    expect(f.calls).toEqual([
      "ingest",
      "export:run-1",
      "publish:run-1",
      "verify:run-1",
      "sync:run-1",
    ]);
    expect(res).toMatchObject({ ok: true, runId: "run-1" });
    expect(res.summary).toBe("run run-1: completed ingest, export, publish, verify, sync");
  });

  it("stops at the first failure and summarizes completed steps", async () => {
    const f = fakes("publish");
    const res = await runPipeline(f.steps);
    expect(f.calls).toEqual(["ingest", "export:run-1", "publish:run-1"]);
    expect(res.ok).toBe(false);
    expect(res.summary).toBe(
      "run run-1: completed ingest, export; failed at publish: publish boom",
    );
  });

  it("reports failure of ingest with no completed steps", async () => {
    const f = fakes();
    f.steps.ingest = async () => {
      throw new Error("nope");
    };
    const res = await runPipeline(f.steps);
    expect(res.ok).toBe(false);
    expect(res.summary).toBe("run: completed none; failed at ingest: nope");
  });

  it("ends successfully after export when publish reports nothing changed", async () => {
    const f = fakes();
    f.steps.publish = async (runId: string) => {
      f.calls.push(`publish:${runId}`);
      return "skipped" as const;
    };
    const res = await runPipeline(f.steps);
    expect(f.calls).toEqual(["ingest", "export:run-1", "publish:run-1"]);
    expect(res).toMatchObject({ ok: true, runId: "run-1" });
    expect(res.summary).toBe(
      "run run-1: completed ingest, export; publish skipped (nothing changed), so verify and sync were not run",
    );
  });

  it("syncs the last published run when publish is skipped and the marker is behind", async () => {
    const f = fakes();
    const steps = {
      ...f.steps,
      publish: async () => "skipped" as const,
      unsyncedPublishedRun: async () => "run-0",
    };
    const res = await runPipeline(steps);
    expect(f.calls).toEqual(["ingest", "export:run-1", "sync:run-0"]);
    expect(res.ok).toBe(true);
    expect(res.summary).toContain("synced earlier published run run-0");
    const none = fakes();
    await runPipeline({
      ...none.steps,
      publish: async () => "skipped",
      unsyncedPublishedRun: async () => null,
    });
    expect(none.calls).toEqual(["ingest", "export:run-1"]);
  });
});
