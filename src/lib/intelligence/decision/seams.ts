// SEAMS: the thin interfaces this module needs from work that other Wave 1 and Wave 2 agents own. Each has a default implementation
// that works today from tables that already exist, and a documented place where the real implementation plugs in later.
// Nothing here edits another workstream's area.
//
//   CustomerMemorySource      -> allvest/w2-memory   (CustomerMemoryItem: confirmed / unconfirmed product stances, do-not-do items)
//   ComplaintCommitmentSource -> allvest/w2-memory   (formal Complaint and Commitment models; today: ConversationInsight + SupportTicket)
//   ProductRegistrySource     -> allvest/w2-attention (governed Product and Eligibility Registry; today: nothing blocks)
//   DecisionEventSink         -> allvest/w1-events   (emit() for nba.decision.*; today: audit-log rows only)
//   MemoryWriteSink           -> allvest/w2-memory   ("do not recommend" as a suppression memory item; today: SuggestionDismissal only)
import type { AssetClass } from "../constants";
import type { ProductStance, RegistryBlock } from "./gate-context";

export interface CustomerMemorySource {
  productStances(clientId: string): Promise<ProductStance[]>;
}

export interface ComplaintCommitmentSource {
  /** Open complaint, or the latest complaint date, for the 14 day rule. */
  complaint(clientId: string): Promise<{ open: boolean; lastAt: Date | null; because: string | null }>;
}

export interface ProductRegistrySource {
  /** Classes or programmes that may not be recommended right now (retired, not open for this investor category, and so on). */
  blocks(clientId: string): Promise<RegistryBlock[]>;
}

export type DecisionEvent = { type: "nba.decision.created" | "nba.decision.feedback" | "nba.decision.outcome"; clientId: string; decisionId: string; correlationId: string; causationId?: string | null; payload: Record<string, string | number | boolean | null> };

export interface DecisionEventSink {
  emit(event: DecisionEvent): Promise<void>;
}

export interface MemoryWriteSink {
  /** A person said "do not recommend this". `scope` is the class or programme, `until` the expiry. */
  writeSuppression(input: { clientId: string; scope: string; assetClass: AssetClass | null; reason: string | null; until: Date; byUserId: string; decisionId: string }): Promise<void>;
}

/** Defaults used until the real implementations land. */
export const nullMemorySource: CustomerMemorySource = { productStances: async () => [] };
export const nullRegistrySource: ProductRegistrySource = { blocks: async () => [] };
export const nullEventSink: DecisionEventSink = { emit: async () => {} };
export const nullMemoryWriteSink: MemoryWriteSink = { writeSuppression: async () => {} };

export type DecisionSeams = {
  memory: CustomerMemorySource;
  complaints: ComplaintCommitmentSource | null;
  registry: ProductRegistrySource;
  events: DecisionEventSink;
  memoryWrite: MemoryWriteSink;
};

export const defaultSeams = (): DecisionSeams => ({ memory: nullMemorySource, complaints: null, registry: nullRegistrySource, events: nullEventSink, memoryWrite: nullMemoryWriteSink });
