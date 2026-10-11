import { loadBriefs } from "@/lib/creative/briefs-db";

import { BriefsView } from "./briefs-view";
import { Rail, type RailFact } from "./rail";
import { TabLayout } from "./tab-layout";

/** Compliant creative briefs and copy drafts: one brief, a master hook and USP, a checked variant per channel, per-variant approval. */
export async function BriefsTab({ viewerId, isAdmin, today }: { viewerId: string; isAdmin: boolean; today: string }) {
  const data = await loadBriefs();
  const variants = data.briefs.flatMap((b) => b.variants);
  const count = (s: string) => variants.filter((v) => v.status === s).length;
  const facts: RailFact[] = [
    { key: "briefs", label: "Briefs", value: { n: data.briefs.length, kind: "count" } },
    { key: "review", label: "Needs review", value: { n: count("NEEDS_REVIEW"), kind: "count" }, tone: count("NEEDS_REVIEW") > 0 ? "warning" : undefined },
    { key: "approved", label: "Approved", value: { n: count("APPROVED"), kind: "count" }, tone: count("APPROVED") > 0 ? "success" : undefined },
    { key: "brand", label: "Brand profile", value: data.brand.version === 0 ? "Defaults" : `Version ${data.brand.version}`, hint: data.brand.profile.disclaimers.registration ? undefined : "Registration line not set", tone: data.brand.profile.disclaimers.registration ? undefined : "warning" },
  ];
  return <TabLayout tab="briefs" rail={<Rail facts={facts} />} main={<BriefsView data={data} viewerId={viewerId} isAdmin={isAdmin} today={today} />} />;
}
