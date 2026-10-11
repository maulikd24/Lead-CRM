import { randomUUID } from "node:crypto";

import { agentEnabled } from "@/lib/agents/enabled";
import { checkConsent, consentEnforced, defaultEnforceDeps } from "@/lib/consent/enforce";
import type { ConsentChannel, ConsentPurpose } from "@/lib/consent/policy";
import { basePrisma } from "@/lib/db/prisma";
import { createProvider } from "@/lib/ai/provider";

import { isProviderConfigured } from "./config";
import { NotConfiguredError, type AgentRunRecord, type GatewayDeps } from "./types";

/** Production wiring: the real provider switch, the consent ledger, the kill-switch settings and the AgentRun table. */
const warned = new Set<string>();

export function defaultGatewayDeps(env: NodeJS.ProcessEnv = process.env): GatewayDeps {
  return {
    env,
    now: () => new Date(),
    newId: () => randomUUID(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    providerFor: (route) => {
      if (!route.apiKey && !isProviderConfigured(route.provider, env)) throw new NotConfiguredError(route.provider);
      return createProvider(route.provider, route.model, route.apiKey);
    },
    agentEnabled: (key) => agentEnabled(key, env, (k) => basePrisma.agentSetting.findUnique({ where: { agentKey: k }, select: { enabled: true } })),
    consent: async (clientId, purpose, channel) => {
      // The same env that drives the rest of the gateway decides whether consent is enforced (CONSENT_ENFORCEMENT=1).
      const d = await checkConsent(clientId, purpose as ConsentPurpose, channel as ConsentChannel | null, { ...defaultEnforceDeps(), enforced: () => consentEnforced(env) });
      return { allowed: d.allowed, reason: d.reason };
    },
    spentToday: async (purposeId, dayStart) => {
      const r = await basePrisma.agentRun.aggregate({ where: { purposeId, createdAt: { gte: dayStart } }, _sum: { costUsdEstimate: true } });
      return Number(r._sum.costUsdEstimate ?? 0);
    },
    record: async (run: AgentRunRecord) => {
      const row = await basePrisma.agentRun.create({
        data: {
          ...run,
          status: run.status.toUpperCase() as "OK" | "ABSTAINED" | "FAILED" | "BLOCKED",
          redactionSummary: run.redactionSummary ?? undefined,
        },
        select: { id: true },
      });
      return row.id;
    },
    warn: (m) => { if (!warned.has(m)) { warned.add(m); console.warn(m); } },
  };
}
