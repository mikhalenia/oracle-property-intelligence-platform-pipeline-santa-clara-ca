import { describe, expect, it } from "vitest";
import {
  type LeadRow,
  type PermitRow,
  type RoofAgeRow,
  toLead,
  toPermit,
  toRoofAge,
} from "./mappers";

const nulls = <T>() => new Proxy({}, { get: () => null }) as T;
const lead = (o: Partial<LeadRow>) => toLead({ ...nulls<LeadRow>(), ...o }, 1);
const permit = (o: Partial<PermitRow>) => toPermit({ ...nulls<PermitRow>(), ...o });
const roof = (o: Partial<RoofAgeRow>) => toRoofAge({ ...nulls<RoofAgeRow>(), ...o });

describe("human-readable labels", () => {
  it("permitStateLabel on leads and permits", () => {
    const cases: [string | null, string | null][] = [
      ["open", "Open"],
      ["expired_unfinaled", "Stalled (expired without a final inspection)"],
      ["finaled", "Completed"],
      [null, null],
    ];
    for (const [state, label] of cases) {
      expect(lead({ permit_state: state }).permitStateLabel).toBe(label);
      expect(permit({ permit_state: state }).permitStateLabel).toBe(label);
      expect(permit({ permit_state: state }).permitState).toBe(state);
    }
  });

  it("roofAgeBasisLabel and roofAgeConfidenceLabel on leads", () => {
    const l = lead({ roof_age_anchor: "final_date", roof_age_confidence: "high" });
    expect(l.roofAgeBasisLabel).toBe("final inspection date");
    expect(l.roofAgeConfidenceLabel).toBe("high confidence");
    expect(l.roofAgeAnchor).toBe("final_date");
    const m = lead({
      roof_age_anchor: "approval_complete_issue_date",
      roof_age_confidence: "medium",
    });
    expect(m.roofAgeBasisLabel).toBe("approval completed (issue date)");
    expect(m.roofAgeConfidenceLabel).toBe("estimated");
    const n = lead({});
    expect(n.roofAgeBasisLabel).toBeNull();
    expect(n.roofAgeConfidenceLabel).toBeNull();
  });

  it("labels on roofAge detail", () => {
    const r = roof({ anchor: "approval_complete_issue_date", confidence: "medium" });
    expect(r?.roofAgeBasisLabel).toBe("approval completed (issue date)");
    expect(r?.roofAgeConfidenceLabel).toBe("estimated");
    expect(r?.anchor).toBe("approval_complete_issue_date");
  });
});
