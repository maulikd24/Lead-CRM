import type { CrossSellFlag } from "@/lib/copilot/cross-sell";
import type { NextBestAction } from "@/lib/copilot/next-best-action";
import type { Suggestion } from "@/lib/outcomes/types";
import type { CustomerFacts } from "../../facts";
import type { NextBestActionV2 } from "../../nba";

/** Everything the candidate generators read, as plain data. The loader builds it; tests build it by hand. */
export type AdapterInput = {
  now: Date;
  facts: CustomerFacts | null;
  /** The legacy engine's stored or freshly computed opinion (lib/intelligence/nba.ts). */
  nba: NextBestActionV2 | null;
  /** The stage-gate recommendation (lib/copilot/next-best-action.ts). Normally facts.onboarding. */
  stageGate: NextBestAction | null;
  /** Outcomes rules (lib/outcomes/rules.ts) after evaluation, before dismissals (the engine applies those itself). */
  goalSuggestions: Suggestion[];
  /** Client.nextAction* (the manual or task-synced next step). */
  nextAction: { title: string; dueAt: Date | null } | null;
  /** Open AI drafts (AgentProposal in DRAFT). */
  proposals: { id: string; programme: string | null; channel: string; reason: string; createdAt: Date }[];
  crossSell: CrossSellFlag[];
  /** Latest holding snapshot date, for the freshness rule on portfolio-based candidates. */
  portfolioAsOf: Date | null;
};
