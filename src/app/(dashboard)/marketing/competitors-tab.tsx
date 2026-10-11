import { prisma } from "@/lib/db/prisma";
import { listCompetitorAds, listCompetitors } from "@/lib/creative/competitor-db";
import { sortByDaysLive } from "@/lib/creative/competitor";

import { CompetitorsView } from "./competitors-view";
import { Rail, type RailFact } from "./rail";
import { TabLayout } from "./tab-layout";

/** Competitor ads, entered by hand or from a CSV: cards sorted by days live, with hook and offer tags and a way to use one as a brief reference. */
export async function CompetitorsTab({ today }: { today: string }) {
  const [ads, competitors, briefs] = await Promise.all([listCompetitorAds(), listCompetitors(), prisma.creativeBrief.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, title: true } })]);
  const sorted = sortByDaysLive(ads, today);
  const facts: RailFact[] = [
    { key: "competitors", label: "Competitors", value: { n: competitors.length, kind: "count" } },
    { key: "ads", label: "Ads saved", value: { n: ads.length, kind: "count" } },
    { key: "source", label: "Source", value: "Manual and CSV", hint: "No scraper or vendor connected" },
  ];
  return <TabLayout tab="competitors" rail={<Rail facts={facts} />} main={<CompetitorsView ads={sorted} competitors={competitors.map((c) => ({ id: c.id, name: c.name, ads: c._count.ads }))} briefs={briefs} today={today} />} />;
}
