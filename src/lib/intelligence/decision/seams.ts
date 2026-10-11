// SEAMS: the thin interfaces this module needs from other workstreams (customer memory, the product registry, the event bus). The null defaults below keep the
// pure pipeline and its tests free of any database; seams-live.ts holds the real implementations, wired in at the Wave 2 integration:
//
//   CustomerMemorySource      -> customer memory (CustomerMemoryItem via getMemoryForDecisions: confirmed / unconfirmed product stances, do-not-do items, disputes)
//   ComplaintCommitmentSource -> the service state (formal Complaint and Commitment: open complaints, overdue person-confirmed promises)
//   ProductRegistrySource     -> the product registry (cite(): only an approved, in-date, non-example product may be cited)
//   DecisionEventSink         -> the event spine (emit() for nba.decision.*)
//   MemoryWriteSink           -> customer memory ("do not recommend" is also written as a DO_NOT_DO memory item, besides the SuggestionDismissal)
import type { AssetClass } from "../constants";
import type { DoNotDoItem, OpenComplaintFact, OverdueCommitmentFact, ProductStance, RegistryBlock, RegistryCitations } from "./gate-context";

export type MemoryGateRead = { productStances: ProductStance[]; doNotDo: DoNotDoItem[]; doNotDoUnmapped: number; conflicts: { assetClass: AssetClass | null; because: string }[] };

export interface CustomerMemorySource {
  /** What memory says about this customer, as gate context: stances, authoritative do-not-do items and disputes. No evidence text. */
  read(clientId: string, now: Date): Promise<MemoryGateRead>;
}

export interface ComplaintCommitmentSource {
  /** Open complaint, or the latest complaint date, for the 14 day rule. */
  complaint(clientId: string): Promise<{ open: boolean; lastAt: Date | null; because: string | null }>;
  /** The formal state behind candidates: open complaints and overdue, person-confirmed promises. Facts only. */
  signals(clientId: string, now: Date): Promise<{ openComplaints: OpenComplaintFact[]; overdueCommitments: OverdueCommitmentFact[] }>;
}

export interface ProductRegistrySource {
  /** Classes or programmes that may not be recommended right now (retired, not open for this investor category, and so on). */
  blocks(clientId: string): Promise<RegistryBlock[]>;
  /** The cite guard: per asset class, which registry products may be cited right now (enforced only while the registry flag is on). */
  citations(now: Date): Promise<RegistryCitations>;
}

export type DecisionEvent = { type: "nba.decision.created" | "nba.decision.expired" | "nba.decision.feedback" | "nba.decision.outcome"; clientId: string; decisionId: string; correlationId: string; causationId?: string | null; payload: Record<string, string | number | boolean | null> };

export interface DecisionEventSink {
  emit(event: DecisionEvent): Promise<void>;
}

export interface MemoryWriteSink {
  /** A person said "do not recommend this". `scope` is the class or programme, `until` the expiry. */
  writeSuppression(input: { clientId: string; scope: string; assetClass: AssetClass | null; reason: string | null; until: Date; byUserId: string; byRole?: string; decisionId: string }): Promise<void>;
}

/** Defaults used until the real implementations land. */
export const nullMemorySource: CustomerMemorySource = { read: async () => ({ productStances: [], doNotDo: [], doNotDoUnmapped: 0, conflicts: [] }) };
export const nullRegistrySource: ProductRegistrySource = { blocks: async () => [], citations: async () => ({ enforced: false, citable: {}, refused: {} }) };
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
