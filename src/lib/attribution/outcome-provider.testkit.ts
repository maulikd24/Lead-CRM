import { buildImpact, type ImpactClient, type SpendFreshness, type SpendInput } from "./impact";
import { createOutcomeProvider, type CampaignOutcomeProvider, type OutcomeChannel } from "./outcome-provider";

/**
 * A provider over a fixture, for other modules' tests (Autopilot, creative, planner, closed-loop, director reports). It is the real provider
 * over an in-memory source, so a module tested against it reads the same definitions the production provider uses.
 */
export type OutcomeFixture = {
  clients: ImpactClient[];
  spend: SpendInput[];
  slaMinutes?: number;
  currency?: string;
  freshness?: { channel: OutcomeChannel; label: string; value: SpendFreshness }[];
  truncated?: boolean;
  now?: Date;
};

const FRESH: SpendFreshness = { lastSuccessAt: new Date("2027-04-20T02:00:00Z"), ageLabel: "4 hours ago", stale: false, partial: false, coveredDays: 30, expectedDays: 30, messages: [] };

export function createFakeOutcomeProvider(fixture: OutcomeFixture): CampaignOutcomeProvider {
  return createOutcomeProvider(
    {
      load: async () => ({
        report: buildImpact({ clients: fixture.clients, spend: fixture.spend, slaMinutes: fixture.slaMinutes ?? 15, currency: fixture.currency ?? "INR" }),
        freshness: fixture.freshness ?? [{ channel: "meta", label: "Meta", value: FRESH }, { channel: "google", label: "Google", value: FRESH }],
        truncated: fixture.truncated ?? false,
        clients: fixture.clients,
      }),
      now: () => fixture.now ?? new Date("2027-04-20T06:00:00Z"),
    },
    "fake",
  );
}
