import { FakeProvider, type LlmProvider } from "@/lib/ai/provider";

import type { AgentRunRecord, GatewayDeps } from "./types";

/** Shared by the gateway tests: deterministic deps, no network, no database. */
export function makeDeps(over: Partial<GatewayDeps> & { provider?: LlmProvider } = {}) {
  const records: AgentRunRecord[] = [];
  const warnings: string[] = [];
  const sleeps: number[] = [];
  const { provider, ...rest } = over;
  const fake = provider ?? new FakeProvider("hello");
  let n = 0;
  const deps: GatewayDeps = {
    env: { AI_BUDGET_DEFAULT_USD: "100" },
    now: () => new Date("2026-10-12T10:00:00Z"),
    newId: () => `id-${++n}`,
    sleep: async (ms) => { sleeps.push(ms); },
    providerFor: () => fake,
    agentEnabled: async () => true,
    consent: async () => ({ allowed: true, reason: "ENFORCEMENT_OFF" }),
    spentToday: async () => 0,
    record: async (r) => { records.push(r); return `run-${records.length}`; },
    warn: (m) => { warnings.push(m); },
    ...rest,
  };
  return { deps, records, warnings, sleeps, fake };
}
