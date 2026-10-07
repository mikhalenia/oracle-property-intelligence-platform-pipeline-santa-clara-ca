import { daysBetween } from "./dates";

export type RoofAge = {
  roofDate: string;
  roofAgeYears: number;
  anchor: "final_date" | "approval_complete_issue_date";
  confidence: "high" | "medium";
};

export function deriveRoofAge(input: {
  isRoofing: boolean;
  approvals: string | null;
  issueDate: string | null;
  finalDate: string | null;
  asOf: string;
}): RoofAge | null {
  if (!input.isRoofing) return null;
  let roofDate: string | null = null;
  let anchor: RoofAge["anchor"] = "final_date";
  if (input.finalDate) {
    roofDate = input.finalDate;
  } else if (input.issueDate && /\bComplete\b/i.test(input.approvals ?? "")) {
    roofDate = input.issueDate;
    anchor = "approval_complete_issue_date";
  }
  if (!roofDate) return null;
  const years = Math.floor(daysBetween(roofDate, input.asOf) / 365.25);
  return { roofDate, roofAgeYears: years, anchor, confidence: anchor === "final_date" ? "high" : "medium" };
}
