/**
 * Synthetic data for the creative and director-report screens (layout-budget and screenshots): a marketing user, ad delivery
 * for eight ads and five campaigns, leads that carry ad ids and fund at different rates (so some ads win and one tires),
 * briefs in every status with checked variants, tags, competitor ads, experiments, a brand profile, share links and a digest
 * draft. Local database only. Nothing here is a real person or a real advertiser. Idempotent: does nothing when the first
 * brief already exists.
 *
 *   npm run layout-budget:seed      (after `npx tsx prisma/seed.ts`)
 */
import "dotenv/config";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("Refusing a non-local database");

/** Small deterministic generator, so the data is the same on every run. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { basePrisma: db } = await import("../../src/lib/db/prisma");
  if ((await db.creativeBrief.count()) > 0) {
    console.log("creative seed already present");
    return;
  }
  const rand = rng(20261011);
  const now = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const day = (n: number) => new Date(`${ymd(new Date(now.getTime() - n * 86_400_000))}T00:00:00Z`);
  const stage = await db.stage.findFirstOrThrow();
  const admin = await db.user.findFirstOrThrow({ where: { email: "admin@supportify.local" }, omit: { passwordHash: false } });
  const marketing = await db.user.upsert({ where: { email: "marketing@supportify.local" }, update: { role: "MARKETING" }, create: { name: "Marketing Tester", email: "marketing@supportify.local", passwordHash: admin.passwordHash, role: "MARKETING" } });
  const synced = new Date(now.getTime() - 5 * 3_600_000);

  // ---- Ad delivery ---------------------------------------------------------------------------------------------
  const google = [
    { id: "gad-1", name: "Demat explained, video", campaign: ["g-c1", "Search: account basics"], format: "VIDEO", ctr: 0.034, cpc: 24, leads: 15, funded: 5 },
    { id: "gad-2", name: "How KYC works, step by step", campaign: ["g-c1", "Search: account basics"], format: "RESPONSIVE_SEARCH_AD", ctr: 0.041, cpc: 31, leads: 13, funded: 3 },
    { id: "gad-3", name: "Portfolio review call", campaign: ["g-c2", "Display: reviews"], format: "IMAGE", ctr: 0.012, cpc: 44, leads: 10, funded: 1 },
    { id: "gad-4", name: "Myth or fact: SIP is risky?", campaign: ["g-c2", "Display: reviews"], format: "IMAGE", ctr: 0.026, cpc: 28, leads: 12, funded: 2, tires: true },
    { id: "gad-5", name: "A checklist for first-time investors", campaign: ["g-c3", "Video: education"], format: "VIDEO", ctr: 0.03, cpc: 27, leads: 9, funded: 3 },
    { id: "gad-6", name: "Open an account in minutes", campaign: ["g-c3", "Video: education"], format: "VIDEO", ctr: 0.019, cpc: 52, leads: 8, funded: 0 },
    { id: "gad-7", name: "Wealth planning basics", campaign: ["g-c1", "Search: account basics"], format: "RESPONSIVE_SEARCH_AD", ctr: 0.022, cpc: 36, leads: 7, funded: 1 },
    { id: "gad-8", name: "Understand mutual funds", campaign: ["g-c3", "Video: education"], format: "CAROUSEL", ctr: 0.024, cpc: 33, leads: 8, funded: 1 },
  ];
  const meta = [
    { id: "m-c1", name: "Demat basics: awareness", spend: 2100, ctr: 0.018, leads: 30, funded: 8, freq: 2.2 },
    { id: "m-c2", name: "Hinglish explainer", spend: 1500, ctr: 0.024, leads: 24, funded: 4, freq: 3.9 },
    { id: "m-c3", name: "Account opening: retarget", spend: 900, ctr: 0.031, leads: 14, funded: 2, freq: 2.6 },
  ];
  const DAYS = 35;
  for (const ad of google) {
    for (let i = DAYS - 1; i >= 0; i--) {
      const tired = ad.tires && i < 10;
      const impressions = Math.round(3600 * (0.8 + rand() * 0.5));
      const clicks = Math.round(impressions * ad.ctr * (tired ? 0.5 : 1) * (0.85 + rand() * 0.3));
      const spend = Math.round(clicks * ad.cpc * (tired ? 1.35 : 1));
      const leads = Math.round((ad.leads / DAYS) * (tired ? 0.45 : 1) * (0.5 + rand() * 1.1) + (rand() < 0.3 ? 1 : 0));
      await db.adCreativeDaily.create({ data: { provider: "google", accountId: "demo-acct", campaignId: ad.campaign[0], campaignName: ad.campaign[1], adId: ad.id, adName: ad.name, format: ad.format, date: day(i), spendMinor: BigInt(spend * 100), currency: "INR", impressions, clicks, leads, syncedAt: synced } });
    }
  }
  const gCampaigns = [...new Map(google.map((a) => [a.campaign[0], a.campaign[1]])).entries()];
  for (const [cid, cname] of gCampaigns) {
    for (let i = DAYS - 1; i >= 0; i--) {
      const rows = await db.adCreativeDaily.findMany({ where: { campaignId: cid, date: day(i) } });
      const spend = rows.reduce((a, r) => a + Number(r.spendMinor), 0);
      await db.adCampaignDaily.create({ data: { provider: "google", accountId: "demo-acct", campaignId: cid, campaignName: cname, date: day(i), spendMinor: BigInt(spend), currency: "INR", impressions: rows.reduce((a, r) => a + r.impressions, 0), clicks: rows.reduce((a, r) => a + r.clicks, 0), reach: 0, leads: rows.reduce((a, r) => a + r.leads, 0), accountTimezone: "Asia/Kolkata", syncedAt: synced } });
    }
  }
  for (const c of meta) {
    for (let i = DAYS - 1; i >= 0; i--) {
      const impressions = Math.round(9000 * (0.8 + rand() * 0.4));
      const reach = Math.round(impressions / (c.freq * (0.9 + rand() * 0.2)));
      await db.adCampaignDaily.create({ data: { provider: "meta", accountId: "demo-acct", campaignId: c.id, campaignName: c.name, date: day(i), spendMinor: BigInt(Math.round(c.spend * (0.8 + rand() * 0.4)) * 100), currency: "INR", impressions, clicks: Math.round(impressions * c.ctr), reach, leads: Math.round(c.leads / DAYS + rand()), accountTimezone: "Asia/Kolkata", syncedAt: synced } });
    }
  }
  for (const provider of ["meta", "google"]) await db.adSyncRun.create({ data: { provider, accountId: "demo-acct", status: "SUCCESS", rowsUpserted: 120, campaignsSeen: 3, windowsOk: 1, startedAt: new Date(synced.getTime() - 60_000), finishedAt: synced } });

  // ---- Leads that carry the ad or campaign, and what they became ------------------------------------------------
  let n = 0;
  const lead = async (source: "google" | "meta", attribution: Record<string, unknown>, funded: boolean, kyc: boolean) => {
    const age = 3 + Math.floor(rand() * 28);
    const c = await db.client.create({ data: { clientCode: `CRV-${1000 + n}`, name: `Seed Lead ${n}`, mobile: String(9_600_000_000 + n), currentStageId: stage.id, leadSource: source === "google" ? "Google Ads" : "Meta Ads", leadAttribution: attribution as never, createdAt: new Date(now.getTime() - age * 86_400_000) } });
    if (kyc || funded) await db.kycRecord.create({ data: { clientId: c.id, status: "APPROVED", completionDate: new Date(now.getTime() - (age - 1) * 86_400_000) } });
    if (funded) {
      await db.fundingRecord.create({ data: { clientId: c.id, status: "FULLY_FUNDED", amount: "150000", fundingDate: new Date(now.getTime() - (age - 2) * 86_400_000) } });
      await db.revenueEvent.create({ data: { sourceSystem: "seed", externalRef: `crv-${n}`, clientId: c.id, revenueType: "BROKERAGE", grossRevenueAmount: String(Math.round(900 + rand() * 4200)), eventDate: new Date(now.getTime() - (age - 3) * 86_400_000), rawPayload: {} } });
    }
    n++;
  };
  for (const ad of google) {
    for (let i = 0; i < ad.leads; i++) await lead("google", { gclid: `g${n}`, utm_source: "google", campaign: ad.campaign[1], campaign_id: ad.campaign[0], ad_id: ad.id, ad: ad.name }, i < ad.funded, i < ad.funded + 2);
  }
  for (const c of meta) {
    for (let i = 0; i < c.leads; i++) await lead("meta", { utm_source: "facebook", campaign: c.name, campaign_id: c.id, fbclid: `f${n}` }, i < c.funded, i < c.funded + 4);
  }

  // ---- Brand profile, briefs, variants -----------------------------------------------------------------------------
  const { DEFAULT_BRAND_PROFILE } = await import("../../src/lib/creative/brand");
  const profile = { ...DEFAULT_BRAND_PROFILE, regulatedClaims: ["tax saving"], disclaimers: { ...DEFAULT_BRAND_PROFILE.disclaimers, registration: "Example Wealth Pvt Ltd, registered with the regulator, registration number INZ000000000 (sample, not real)" } };
  await db.brandProfileVersion.create({ data: { version: 1, profile: profile as never, createdById: admin.id } });
  const { creativeService } = await import("../../src/lib/creative/store");
  const { briefInputSchema, generateKit } = await import("../../src/lib/creative/kit");
  const svc = creativeService();
  const mk = async (title: string, topic: string, language: "en" | "hinglish", hookType: "question" | "process" | "myth_fact" | "checklist", formats: string[]) => {
    const input = briefInputSchema.parse({ title, topic, audience: language === "en" ? "First-time investors" : "Hinglish-speaking professionals", language, hookType, formats });
    const r = await svc.createFromKit({ input, kit: generateKit(input, profile), source: "STAFF", actor: { id: marketing.id, role: "MARKETING" } });
    if (!r.ok) throw new Error(r.error);
    return db.creativeVariant.findMany({ where: { briefId: r.briefId }, orderBy: { createdAt: "asc" } });
  };
  const a = await mk("Demat basics", "opening a demat account", "en", "question", ["meta_feed", "google_rsa", "linkedin_single"]);
  for (const v of a) await svc.transition(v.id, "submit", { id: marketing.id, role: "MARKETING" });
  for (const v of a.slice(0, 2)) await svc.transition(v.id, "approve", { id: admin.id, role: "ADMIN" }, { confirmed: true });
  const b = await mk("KYC in plain words", "completing KYC", "hinglish", "process", ["meta_feed", "youtube_video", "tiktok_feed"]);
  await svc.transition(b[0].id, "submit", { id: marketing.id, role: "MARKETING" });
  // One draft with a failing rule, so the checklist shows a matched phrase.
  const failing = (await mk("Retargeting test", "first investment checklist", "en", "checklist", ["meta_feed"]))[0];
  await svc.editVariant(failing.id, { fields: { ...(failing.fields as Record<string, string[]>), headline: ["Guaranteed returns, act now"] } }, { id: marketing.id, role: "MARKETING" });
  await mk("Myth or fact on SIPs", "starting a SIP", "en", "myth_fact", ["google_rsa", "meta_feed"]);

  // ---- Tags, competitors, experiments, settings, share links, digest --------------------------------------------------
  const tagRows: [string, string, string, string, string][] = [
    ["google:gad-1", "hook", "question", "CONFIRMED", "HUMAN"], ["google:gad-1", "format", "video", "CONFIRMED", "HUMAN"], ["google:gad-1", "offer", "call", "CONFIRMED", "HUMAN"],
    ["google:gad-2", "hook", "process", "CONFIRMED", "HUMAN"], ["google:gad-2", "format", "text", "CONFIRMED", "HUMAN"],
    ["google:gad-3", "hook", "number", "CONFIRMED", "HUMAN"], ["google:gad-3", "format", "image", "CONFIRMED", "HUMAN"],
    ["google:gad-4", "hook", "myth_fact", "DRAFT", "RULE"], ["google:gad-4", "format", "image", "DRAFT", "RULE"],
    ["google:gad-5", "hook", "checklist", "CONFIRMED", "HUMAN"], ["google:gad-5", "format", "video", "CONFIRMED", "HUMAN"], ["google:gad-5", "offer", "call", "CONFIRMED", "HUMAN"],
    ["google:gad-6", "hook", "number", "CONFIRMED", "HUMAN"], ["google:gad-6", "format", "video", "CONFIRMED", "HUMAN"],
    ["google:gad-7", "hook", "process", "DRAFT", "RULE"], ["google:gad-8", "hook", "question", "DRAFT", "AI"],
  ];
  for (const [adKey, tagType, value, status, source] of tagRows) {
    const [channel, adId] = adKey.split(":");
    await db.creativeTag.create({ data: { adKey, channel, adId, adName: google.find((g) => g.id === adId)?.name, tagType, value, status, source } });
  }
  const rivals = ["Sample Rival Capital", "Example Advisors", "Demo Wealth Co"];
  const copies = [
    ["Is your portfolio working, or just sitting?", "video", 62, "free_review"], ["Free portfolio review this week", "image", 11, "free_review"], ["How to start investing in 3 steps", "carousel", 48, null],
    ["Myth: you need a lot of money to begin", "image", 25, null], ["Book a call with a planner", "video", 90, "call"], ["A checklist before your first SIP", "carousel", 33, null],
    ["Why wait? Start today", "image", 5, null], ["Understand the risks before you invest", "video", 71, null],
  ] as const;
  for (const r of rivals) await db.competitorWatch.create({ data: { name: r, pageId: `page-${r.length}`, createdById: marketing.id } });
  const watch = await db.competitorWatch.findMany({ orderBy: { name: "asc" } });
  for (let i = 0; i < copies.length; i++) {
    const [copy, format, days, offer] = copies[i];
    await db.competitorAd.create({ data: { competitorId: watch[i % watch.length].id, copy, format, startDate: day(days), link: `https://example.com/ad/${i}`, thumbnailRef: i % 2 ? `thumb-${i}` : null, hookTag: /\?/.test(copy) ? "question" : /^Myth/.test(copy) ? "myth_fact" : /checklist/i.test(copy) ? "checklist" : null, offerTag: offer, tagStatus: i < 4 ? "DRAFT" : "CONFIRMED", tagSource: i < 4 ? "RULE" : "HUMAN", importedById: marketing.id } });
  }
  await db.experiment.createMany({
    data: [
      { name: "Question hook vs process hook", hypothesis: "A question hook lifts the lead-to-funded rate because it speaks to the reader's doubt.", metric: "funded_rate", baselineRate: 0.14, mde: 0.3, mdeKind: "relative", visitorsPerDay: 25, sampleSizePerArm: 3500, startAt: day(10), status: "RUNNING", campaignIds: ["g-c1"], createdById: marketing.id },
      { name: "Hinglish copy on the explainer", hypothesis: "Hinglish copy lowers cost per lead for the urban professional audience.", metric: "lead_rate", baselineRate: 0.04, mde: 0.2, mdeKind: "relative", visitorsPerDay: 400, sampleSizePerArm: 9500, status: "PLANNED", campaignIds: ["m-c2"], createdById: marketing.id },
      { name: "Checklist carousel vs single image", hypothesis: "A checklist carousel earns more clicks than a single image.", metric: "click_rate", baselineRate: 0.02, mde: 0.25, mdeKind: "relative", startAt: day(60), endAt: day(30), status: "DECIDED", decision: "ADOPT", learning: "The carousel earned about a fifth more clicks; the sample was small, so we adopted it on a trial basis and will re-check at 90 days.", campaignIds: ["g-c3"], createdById: marketing.id },
    ],
  });
  await db.creativeSetting.create({ data: { key: "digest", value: JSON.stringify({ enabled: true, recipients: ["admin@supportify.local", "director@example.test"] }), updatedById: admin.id } });

  const { loadDirectorReport, createShare } = await import("../../src/lib/director/db");
  const { buildDigestEmail, previousWeeks } = await import("../../src/lib/director/digest");
  const weeks = previousWeeks(now);
  const report = await loadDirectorReport(weeks.current.from, weeks.current.to, now);
  const share = await createShare({ report, userId: admin.id, expiryDays: 7, label: "Board pack, last week" });
  await createShare({ report, userId: admin.id, expiryDays: 1, label: "Old link", now: new Date(now.getTime() - 5 * 86_400_000) });
  await db.reportShare.update({ where: { id: share.id }, data: { viewCount: 3, lastViewedAt: now } });
  const email = buildDigestEmail(report, ["admin@supportify.local", "director@example.test"]);
  await db.directorDigest.create({ data: { weekStart: new Date(`${weeks.weekStart}T00:00:00Z`), report: report as never, subject: email.subject, bodyText: email.bodyText, recipients: email.recipients } });
  console.log(`creative seed done: ${n} leads, ${google.length} ads, 4 briefs`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
