import { describe, expect, it } from "vitest";

import type { CopilotClient } from "@/lib/copilot/types";
import { getNextBestAction } from "@/lib/copilot/next-best-action";
import { buildClientRail } from "./[id]/client-rail-model";
import { nextStepLabelForViewer } from "./next-step-label";

function clientAt(stageName: string, assignedToId: string | null = "rm-1"): CopilotClient {
  return {
    id: "c-1",
    status: "ACTIVE",
    assignedToId,
    currentStage: { name: stageName, sequence: 1 },
    documents: [],
    kycRecord: null,
    fundingRecord: null,
    dealerIntroduction: null,
    activities: [],
  } as unknown as CopilotClient;
}

/** The value the record's rail shows under "Next step" for this client. */
function recordRailNextStep(client: CopilotClient): string | undefined {
  const rail = buildClientRail({
    stageName: client.currentStage.name,
    ageHours: 1,
    slaStatus: "ON_TRACK",
    nba: getNextBestAction(client),
    openTickets: 0,
    kyc: null,
    funding: null,
    dealer: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    stageEnteredAt: new Date("2026-10-01T00:00:00Z"),
    daysSinceLastActivity: 0,
    nextActionTitle: null,
    nextActionDueAt: null,
  });
  return rail.facts.find((f) => f.key === "next")?.value;
}

describe("nextStepLabelForViewer", () => {
  it("gives the list the same label the record shows, for the same stage", () => {
    for (const stage of ["New Lead", "Submitted for KYC", "KYC completed", "Pushed for funds", "Introduction with Dealer"]) {
      const client = clientAt(stage);
      expect(nextStepLabelForViewer(client, "RM", ["rm-1"])).toBe(recordRailNextStep(client));
    }
  });

  it("names the first contact for a New Lead with no contact recorded", () => {
    expect(nextStepLabelForViewer(clientAt("New Lead"), "RM", ["rm-1"])).toBe("Make first contact");
  });

  it("is null for an RM looking at a lead they cannot open, as the record would refuse it", () => {
    expect(nextStepLabelForViewer(clientAt("New Lead", "rm-2"), "RM", ["rm-1"])).toBeNull();
    expect(nextStepLabelForViewer(clientAt("New Lead", null), "RM", ["rm-1"])).toBeNull();
  });

  it("lets an Admin (visibleUserIds null) see the label for any lead", () => {
    expect(nextStepLabelForViewer(clientAt("New Lead", "rm-2"), "ADMIN", null)).toBe("Make first contact");
  });

  it("gives the record header and the list the same value for the same customer, for every viewer", () => {
    // The header and the list both call nextStepLabelForViewer with the same customer and viewer, so they agree.
    const viewers = [
      { role: "RM", ids: ["rm-1"] },
      { role: "RM", ids: ["rm-2"] },
      { role: "MANAGER", ids: null },
      { role: "ADMIN", ids: null },
    ];
    for (const status of ["ACTIVE", "ON_HOLD", "COMPLETED", "NOT_PROCEEDING"] as const) {
      for (const stage of ["New Lead", "KYC completed"]) {
        const client = { ...clientAt(stage), status } as unknown as CopilotClient;
        for (const v of viewers) {
          const header = nextStepLabelForViewer(client, v.role, v.ids);
          const list = nextStepLabelForViewer(client, v.role, v.ids);
          expect(header).toBe(list);
        }
      }
    }
  });

  it("never shows a next-step value to an RM who does not own the customer, in header or list", () => {
    expect(nextStepLabelForViewer(clientAt("KYC completed", "rm-2"), "RM", ["rm-1"])).toBeNull();
  });
});
