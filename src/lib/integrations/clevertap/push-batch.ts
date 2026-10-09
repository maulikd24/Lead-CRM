import { basePrisma, prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { loadCustomerFacts } from "@/lib/intelligence/facts";
import { computeIntelligence } from "@/lib/intelligence/refresh";
import { checkedAfter, runBatch, type BatchResult } from "./batch-loop";
import { selectBatch } from "./select-batch";
import { getLastHash, recordChecked, recordFailure, recordSuccess } from "./ledger";
import { signalsFromIntelligence } from "./mapping";
import { pushCustomerSignals, type PusherDeps } from "./pusher";
import { clevertapHost, isIndiaRegion, writesEnabled } from "./region";
import { pickIdentity } from "./signals";
import { consentEnforced } from "@/lib/consent/enforce";
import { coarseMarketingWhere } from "@/lib/consent/coarse";
import { applyPushStance, pushStanceFor } from "@/lib/consent/push";

const ZERO: BatchResult = { pushed: 0, unchanged: 0, skipped: 0, retry: 0, failed: 0 };

/**
 * Pushes changed customer signals to CleverTap. Off unless CLEVERTAP_PUSH_ENABLED=1, and then still a no-op unless the
 * integration is enabled, live, and on the India region. Credentials are decrypted in memory and never logged or returned.
 */
export async function pushStaleSignals(limit = 25): Promise<BatchResult> {
  if (!writesEnabled()) return { ...ZERO };

  const config = await prisma.integrationConfig.findUnique({ where: { provider: "clevertap" } });
  if (!config || !config.isEnabled || config.mode !== "live" || !config.credentials) return { ...ZERO };

  const credentials = decryptJson<Record<string, unknown>>(config.credentials as string);
  const region = credentials.region ? String(credentials.region) : undefined;
  if (!isIndiaRegion(region)) return { ...ZERO };
  const accountId = String(credentials.accountId ?? "");
  const passcode = String(credentials.passcode ?? "");
  if (!accountId || !passcode) return { ...ZERO };
  const url = `https://${clevertapHost(region ?? "")}/1/upload`;

  // CONSENT_ENFORCEMENT=1 only: customers without marketing consent are left out, and a customer who withdrew (or asked
  // not to be contacted) is pushed with the existing av_sales_paused signal set so campaigns suppress them.
  const consent = consentEnforced();

  const deps: PusherDeps = {
    region,
    mode: "live",
    load: async (clientId) => {
      const facts = await loadCustomerFacts(clientId);
      if (!facts) return null;
      const client = await prisma.client.findUnique({ where: { id: clientId }, select: { email: true, mobile: true } });
      if (!client) return null;
      // computeIntelligence is pure: unlike refreshCustomerIntelligence it writes nothing and can fire no journeys.
      const loaded = { identity: pickIdentity(client), signals: signalsFromIntelligence(computeIntelligence(facts)) };
      return consent ? applyPushStance(loaded, await pushStanceFor(clientId)) : loaded;
    },
    lastHash: (clientId) => getLastHash(basePrisma, clientId),
    record: (clientId, hash) => recordSuccess(basePrisma, clientId, hash),
    recordError: (clientId, message) => recordFailure(basePrisma, clientId, message),
    send: async (payload) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "X-CleverTap-Account-Id": accountId, "X-CleverTap-Passcode": passcode, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, status: res.status };
    },
  };

  const ids = await selectBatch(basePrisma, limit, consent ? coarseMarketingWhere() : undefined);
  const push = checkedAfter((id) => pushCustomerSignals(id, deps), (id) => recordChecked(basePrisma, id));
  return runBatch(ids, push);
}
