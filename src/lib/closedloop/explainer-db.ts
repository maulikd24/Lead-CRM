import { prisma } from "@/lib/db/prisma";

import { closedLoopEnabled, killSwitchOn } from "./config";
import { loadAdsConsent, loadDestinationContexts, loadGlobalSettings } from "./db";
import { explainCustomer, type Explainer } from "./explainer";

const noFetch = async () => ({ status: 0, ok: false, json: async () => ({}) });

/** Null while the module is off, so Customer 360 shows nothing new. Reads one customer; returns reasons only. */
export async function loadCustomerExplainer(clientId: string, db: typeof prisma = prisma): Promise<Explainer | null> {
  if (!closedLoopEnabled()) return null;
  const c = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, email: true, mobile: true, leadAttribution: true, createdAt: true, kycRecord: { select: { status: true, completionDate: true } }, fundingRecord: { select: { status: true, fundingDate: true, amount: true } } },
  });
  if (!c) return null;
  const [consent, global, contexts] = await Promise.all([loadAdsConsent([clientId], db), loadGlobalSettings(db), loadDestinationContexts(noFetch, process.env, db)]);
  const attribution = c.leadAttribution && typeof c.leadAttribution === "object" && !Array.isArray(c.leadAttribution) ? (c.leadAttribution as Record<string, unknown>) : null;
  return explainCustomer({
    rows: consent.get(clientId) ?? [],
    facts: {
      clientId,
      kyc: c.kycRecord ? { status: c.kycRecord.status, completionDate: c.kycRecord.completionDate } : null,
      funding: c.fundingRecord ? { status: c.fundingRecord.status, fundingDate: c.fundingRecord.fundingDate, amount: c.fundingRecord.amount == null ? null : Number(c.fundingRecord.amount) } : null,
      aum: null,
      aumAsOf: null,
    },
    email: c.email,
    mobile: c.mobile,
    attribution,
    createdAt: c.createdAt,
    destinations: [...contexts.entries()].filter(([, x]) => x.settings.enabled).map(([key, x]) => ({ key, label: x.destination.key === "fake" ? "Demo destination" : key === "meta_capi" ? "Meta Conversions API" : "Google Ads", platform: x.destination.platform, settings: x.settings })),
    killSwitch: killSwitchOn(process.env, global),
    now: new Date(),
    aumBands: null,
  });
}
