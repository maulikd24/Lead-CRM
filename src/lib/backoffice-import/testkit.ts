import { createMemoryRepo } from "@/lib/portfolio-feed/memory-repo";
import type { IdentityHits } from "@/lib/portfolio-feed/match";

import type { ClientProfile, ClientRepo, RunDeps, RunRecord, RunsRepo } from "./runner";

/** In-memory dependencies for tests: synthetic clients only. */
export function createMemoryRuns(): RunsRepo & { rows: (RunRecord & { id: string; seq: number })[] } {
  const rows: (RunRecord & { id: string; seq: number })[] = [];
  return {
    rows,
    async hasCompleted(checksum, kind) {
      return rows.some((r) => r.checksum === checksum && r.kind === kind && !r.dryRun && (r.status === "SUCCESS" || r.status === "PARTIAL"));
    },
    async hasRunning(checksum, kind) {
      return rows.some((r) => r.checksum === checksum && r.kind === kind && !r.dryRun && r.status === "RUNNING");
    },
    async start(input) {
      const row = { ...input, status: "RUNNING" as const, id: `run-${rows.length + 1}`, seq: rows.length + 1 };
      rows.push(row);
      return { id: row.id, seq: row.seq };
    },
    async finish(id, result) {
      Object.assign(rows.find((r) => r.id === id)!, result);
    },
  };
}

export function createMemoryClients(initial: Record<string, Partial<ClientProfile> & { pan?: string; mobile?: string | null; email?: string | null }>) {
  const clients = new Map(Object.entries(initial).map(([code, p]) => [code, { id: `id-${code}`, profile: { name: "", email: null, mobile: null, city: null, state: null, clientType: null, investmentCategory: null, ...p } as ClientProfile, pan: p.pan ?? null }]));
  const byId = new Map([...clients.values()].map((c) => [c.id, c]));
  const updates: { id: string; data: Partial<ClientProfile> }[] = [];
  const repo: ClientRepo = {
    async getProfiles(ids) {
      return new Map(ids.flatMap((id) => (byId.has(id) ? [[id, { ...byId.get(id)!.profile }] as const] : [])));
    },
    async update(id, data) {
      updates.push({ id, data });
      Object.assign(byId.get(id)!.profile, data);
    },
  };
  const lookup: RunDeps["lookup"] = async (identities) =>
    identities.map((i): IdentityHits => {
      const hits: IdentityHits = {};
      if (i.clientCode) hits.clientCode = clients.has(i.clientCode) ? [clients.get(i.clientCode)!.id] : [];
      if (i.pan) hits.pan = [...clients.values()].filter((c) => c.pan === i.pan).map((c) => c.id);
      return hits;
    });
  return { repo, lookup, updates, clients };
}

export function createDeps(clientsInit: Parameters<typeof createMemoryClients>[0] = { "CL-1": { name: "Asha", pan: "ABCDE1234F" }, "CL-2": { name: "Bala" } }) {
  const feedRepo = createMemoryRepo();
  const clients = createMemoryClients(clientsInit);
  const runs = createMemoryRuns();
  const audits: unknown[] = [];
  const deps: RunDeps = { lookup: clients.lookup, feedRepo, clientRepo: clients.repo, runs, audit: async (a) => void audits.push(a), now: () => Date.parse("2026-10-09T00:00:00Z") };
  return { deps, feedRepo, clients, runs, audits };
}
