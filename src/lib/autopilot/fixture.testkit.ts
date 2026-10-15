import { DEFAULT_SETTINGS, type AutopilotSnapshot, type CampaignOutcome, type DailyRow, type LeadRecord } from "./types";

/**
 * TEST FIXTURE ONLY (a .testkit file: the outcome boundary does not read it). It stands in for what the CampaignOutcomeProvider returns for a
 * synthetic account, computed naively from the synthetic leads and days. outcomes-contract.test.ts proves, against the real provider over the
 * same account, that these are the numbers the provider reports (same cost per funded customer and return on spend).
 */
export function fixtureOutcomes(days: DailyRow[], leads: LeadRecord[], campaignIds: string[], from: string | null = null, sla = 15): Record<string, CampaignOutcome> {
  const out: Record<string, CampaignOutcome> = {};
  for (const id of campaignIds) {
    const mine = leads.filter((l) => l.campaignId === id && (from === null || l.arrivedAt.slice(0, 10) >= from));
    const spend = days.filter((d) => d.campaignId === id && (from === null || d.date >= from)).reduce((a, d) => a + d.spend, 0);
    const funded = mine.filter((l) => l.funded).length;
    const revenue = mine.reduce((a, l) => a + l.revenue, 0);
    const inSla = mine.filter((l) => l.contactMinutes !== null && l.contactMinutes <= sla).length;
    out[id] = {
      spend: spend > 0 ? spend : null, leads: mine.length, contactedInSla: inSla, contactedInSlaRate: mine.length ? inSla / mine.length : null,
      kyc: mine.filter((l) => l.kycComplete).length, funded, revenue,
      costPerLead: spend > 0 && mine.length ? spend / mine.length : null, costPerFunded: spend > 0 && funded ? spend / funded : null, roas: spend > 0 && revenue > 0 ? revenue / spend : null,
      confidence: mine.length >= 10 ? "high" : "insufficient",
    };
  }
  return out;
}

/** A deterministic, synthetic account for tests and demos. No randomness, no clock, no real data. */
function lcg(seed: number) { let x = seed; return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296); }

export function demoSnapshot(opts: { asOf?: string; withOptional?: boolean } = {}): AutopilotSnapshot {
  const asOf = opts.asOf ?? "2026-10-11T06:00:00.000Z";
  const rnd = lcg(7);
  const campaigns: AutopilotSnapshot["campaigns"] = [
    { id: "m1", name: "Meta - Demat open", platform: "meta", status: "ACTIVE", plannedMonthlyBudget: 90000, geoCountries: ["IN"], landingUrl: "https://example.test/open", excludesExistingCustomers: true },
    { id: "m2", name: "Meta - Wealth leads", platform: "meta", status: "ACTIVE", plannedMonthlyBudget: 60000, geoCountries: ["IN"], landingUrl: "https://example.test/wealth", excludesExistingCustomers: false },
    { id: "g1", name: "Google - Search brand", platform: "google", status: "ACTIVE", plannedMonthlyBudget: 45000, geoCountries: ["IN"], landingUrl: "https://example.test/brand", negativeKeywordCount: 0, lostImpressionShareBudget: 0.22, excludesExistingCustomers: true },
  ];
  const days: DailyRow[] = [];
  const plan: Record<string, { spend: number; ctr: number; l: number }> = { m1: { spend: 3200, ctr: 0.012, l: 0.07 }, m2: { spend: 2400, ctr: 0.004, l: 0.03 }, g1: { spend: 1500, ctr: 0.05, l: 0.09 } };
  for (let i = 0; i < 28; i++) {
    const date = new Date(Date.UTC(2026, 8, 14 + i)).toISOString().slice(0, 10);
    for (const c of campaigns) {
      const p = plan[c.id]; const spend = Math.round(p.spend * (0.9 + rnd() * 0.2));
      const impressions = Math.round(spend * 45); const clicks = Math.round(impressions * p.ctr);
      days.push({ campaignId: c.id, date, spend, impressions, clicks, leads: Math.round(clicks * p.l) });
    }
  }
  const leads: LeadRecord[] = [];
  const cities = ["Mumbai", "Pune", "Delhi", "Jaipur", "Surat"]; const states = ["Maharashtra", "Maharashtra", "Delhi", "Rajasthan", "Gujarat"];
  for (let i = 0; i < 360; i++) {
    const cid = i % 3 === 0 ? "m2" : i % 3 === 1 ? "m1" : "g1";
    const day = Math.floor(rnd() * 28); const hour = Math.floor(rnd() * 24);
    const night = hour >= 21 || hour < 7;
    const k = Math.floor(rnd() * 5);
    const funded = cid !== "m2" && rnd() < (night ? 0.01 : 0.14);
    const contact = rnd() < (night ? 0.55 : 0.95) ? (night ? 90 + Math.round(rnd() * 400) : 3 + Math.round(rnd() * 25)) : null;
    leads.push({ campaignId: i % 11 === 0 ? null : cid, arrivedAt: new Date(Date.UTC(2026, 8, 14 + day, hour - 5, 30 - 0)).toISOString(), contactMinutes: contact, kycComplete: funded || rnd() < 0.2, funded, revenue: funded ? 1500 : 0, aum: funded ? 250000 + Math.round(rnd() * 400000) : 0, city: cities[k], state: states[k] });
  }
  const snap: AutopilotSnapshot = { asOf, dataThrough: "2026-10-10T18:30:00.000Z", window: { since: "2026-09-14", until: "2026-10-11" }, campaigns, days, outcomes: {}, windowOutcomes: {}, leads, settings: { ...DEFAULT_SETTINGS, targetCostPerFunded: 4000 } };
  const ids = campaigns.map((c) => c.id);
  snap.outcomes = fixtureOutcomes(days, leads, ids);
  for (const w of [1, 7, 14, 28]) snap.windowOutcomes[String(w)] = fixtureOutcomes(days, leads, ids, new Date(Date.parse(snap.window.until) - (w - 1) * 86_400_000).toISOString().slice(0, 10));
  if (opts.withOptional) {
    snap.searchTerms = [{ campaignId: "g1", term: "demat account free jobs", spend: 2400, clicks: 40, leads: 0 }, { campaignId: "g1", term: "open demat account online", spend: 5200, clicks: 120, leads: 14 }];
    snap.keywords = [{ campaignId: "g1", keyword: "free trading tips", qualityScore: 3, spend: 1800, leads: 0 }, { campaignId: "g1", keyword: "demat account", qualityScore: 8, spend: 6000, leads: 20 }];
    snap.placements = [{ campaignId: "m1", placement: "Audience Network", spend: 3000, impressions: 90000, clicks: 200, leads: 0 }, { campaignId: "m1", placement: "Instagram Feed", spend: 20000, impressions: 400000, clicks: 6000, leads: 300 }];
    snap.hours = Array.from({ length: 7 * 24 }, (_, i) => ({ campaignId: "m1", dow: Math.floor(i / 24), hour: i % 24, spend: 250, clicks: 4, conversions: (i % 24 >= 22 || i % 24 < 6) ? 0 : 2 }));
    snap.audienceOverlap = [{ campaignA: "m1", campaignB: "m2", overlapPct: 0.42 }];
    snap.regionSpend = [{ kind: "city", name: "Mumbai", spend: 30000, clicks: 3000 }, { kind: "city", name: "Pune", spend: 20000, clicks: 2000 }, { kind: "city", name: "Delhi", spend: 20000, clicks: 2100 }, { kind: "city", name: "Jaipur", spend: 15000, clicks: 1500 }, { kind: "city", name: "Surat", spend: 15000, clicks: 1400 }];
    snap.auction = [{ campaignId: "g1", competitor: "You", impressionShare: 0.58, overlapRate: 1, positionAboveRate: 0, outrankingShare: 0 }, { campaignId: "g1", competitor: "rival-broker.example", impressionShare: 0.44, overlapRate: 0.61, positionAboveRate: 0.38, outrankingShare: 0.5 }];
    snap.adFatigue = [{ campaignId: "m1", adId: "a1", adName: "Carousel A", ctrLast7: 0.006, ctrPrior14: 0.012, impressionsLast7: 40000 }];
    snap.tracking = { events: [{ name: "Lead", platform: "meta", expected: true, fires7d: 240, uniqueIds7d: 120, withoutId7d: 0 }, { name: "Funded", platform: "meta", expected: true, fires7d: 0, uniqueIds7d: 0, withoutId7d: 0 }], offlineImports: [{ platform: "google", lastAttemptAt: "2026-10-10T00:00:00.000Z", lastSuccessAt: "2026-10-01T00:00:00.000Z", sent7d: 10, rejected7d: 10, lastError: "INVALID_GCLID" }] };
  }
  return snap;
}
