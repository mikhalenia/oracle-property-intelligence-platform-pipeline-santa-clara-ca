import { daysBetween } from "./dates";

export type PermitStatus = "active" | "under_inspection" | "expired";
export type PermitState = "open" | "expired_unfinaled" | "finaled";

export function derivePermitState(input: { status: PermitStatus; finalDate: string | null }): PermitState {
  if (input.finalDate) return "finaled";
  return input.status === "expired" ? "expired_unfinaled" : "open";
}

export function daysOpen(input: {
  state: PermitState;
  issueDate: string | null;
  finalDate: string | null;
  asOf: string;
}): number | null {
  if (!input.issueDate) return null;
  if (input.state === "finaled") return input.finalDate ? daysBetween(input.issueDate, input.finalDate) : null;
  return daysBetween(input.issueDate, input.asOf);
}
