import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadsPage } from "./LeadsPage";
import * as api from "../api";

vi.mock("../api");

const snapshot = { runId: "r1", manifestCid: "bafymanifestcid000000000001", syncedAt: "t" };
const lead = (over: Partial<api.Lead>): api.Lead => ({
  apn: "A-1",
  situsAddress: "1 MAIN ST",
  situsCity: "SAN JOSE",
  lat: 37.33,
  lon: -121.88,
  roofDate: null,
  roofAgeYears: null,
  roofAgeAnchor: null,
  roofAgeConfidence: null,
  roofAgePermit: null,
  permitNumber: null,
  permitState: null,
  approvalsComplete: false,
  daysOpen: null,
  issueDate: null,
  contractorCompany: null,
  cslbLicenseNumber: null,
  ownerName: null,
  distanceMiles: 0.42,
  provenance: {
    propertySourceUrl: "https://data.sccgov.org/parcels",
    permitSourceUrl: "https://data.sanjoseca.gov/permits",
    permitSourceVersion: "v",
    fetchedAt: "t",
  },
  ...over,
});

beforeEach(() => {
  vi.mocked(api.getAgedRoofs).mockResolvedValue({
    snapshot,
    items: [
      lead({
        apn: "B-2",
        situsAddress: "200 OLD ROOF AV",
        roofAgeYears: 22,
        roofAgeAnchor: "approval_complete_issue_date",
        roofAgeConfidence: "medium",
        ownerName: "SMITH JOHN",
      }),
    ],
  });
  vi.mocked(api.getOpenPermits).mockResolvedValue({
    snapshot,
    items: [
      lead({
        apn: "C-3",
        situsAddress: "300 STALLED ST",
        permitNumber: "2015-1-RS",
        permitState: "expired_unfinaled",
        daysOpen: 4000,
        contractorCompany: "ACME ROOFING INC",
      }),
    ],
  });
});

describe("LeadsPage", () => {
  it("queries both endpoints with the form values and renders both tables", async () => {
    render(<LeadsPage />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: /^Stalled/ }));
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(api.getAgedRoofs).toHaveBeenCalledWith({
        lat: 37.3382,
        lon: -121.8863,
        radiusMiles: 5,
        minRoofAgeYears: 15,
      }),
    );
    expect(api.getOpenPermits).toHaveBeenCalledWith({
      lat: 37.3382,
      lon: -121.8863,
      radiusMiles: 5,
      state: "expired_unfinaled",
    });
    expect(await screen.findByText("200 OLD ROOF AV")).toBeInTheDocument();
    expect(
      screen.getByText(/22 y · issue date \(approvals Complete\) · medium/),
    ).toBeInTheDocument();
    expect(screen.getByText("2015-1-RS · expired_unfinaled · 4000 d")).toBeInTheDocument();
    expect(screen.getByText("ACME ROOFING INC")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "permit source" })[0]).toHaveAttribute(
      "href",
      "https://data.sanjoseca.gov/permits",
    );
    expect(screen.getAllByText(/manifest bafymanife/).length).toBe(2);
  });

  it("says when a result was cut at the request limit", async () => {
    vi.mocked(api.getOpenPermits).mockResolvedValue({ snapshot, items: [lead({ apn: "C-3" })], truncated: true });
    render(<LeadsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/Showing the first 1 matches; the request limit was reached/)).toBeInTheDocument();
    expect(screen.getAllByText(/the request limit was reached/).length).toBe(1);
  });

  it("shows API errors", async () => {
    vi.mocked(api.getAgedRoofs).mockRejectedValue(new Error("/api/leads/aged-roofs responded 500"));
    render(<LeadsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/responded 500/)).toBeInTheDocument();
  });
});
