import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createMockReferralApi } from "@/lib/partners/mock-data";
import { dataStatus } from "@/lib/partners/status";
import { buildReferrerDetailVM } from "@/lib/partners/view-models";
import { PartnerLoading } from "./partner-loading";
import { AffiliateRail, PartnerSection, StatusCard } from "./partners-rail";

const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const api = createMockReferralApi();

describe("Partner workspace frame", () => {
  it("puts the section in the one labelled tabpanel, tied to its tab", () => {
    const out = html(<PartnerSection tab="payouts" rail={<aside>rail</aside>}><p>content</p></PartnerSection>);
    expect(out.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(out).toContain('aria-labelledby="partners-tab-payouts"');
    expect(out).toContain("content");
  });
  it("loading is a busy panel with still placeholders and no spinner or shimmer", () => {
    for (const tab of ["overview", "affiliates", "payouts"] as const) {
      const out = html(<PartnerLoading tab={tab} />);
      expect(out).toContain('aria-busy="true"');
      expect(out).not.toMatch(/animate-pulse|animate-spin/);
    }
  });
  it("the status card says where the data comes from and links nowhere", () => {
    const out = html(<StatusCard status={dataStatus({ status: "ok", data: 1, sample: false, source: "native" as const })} />);
    expect(out).toContain("Live from this CRM");
    expect(out).not.toMatch(/contract|href=/i);
  });
});

describe("Affiliate rail", async () => {
  const first = (await api.listReferrers({ limit: 1 })).items[0];
  const vm = buildReferrerDetailVM(await api.getReferrer(first.id), await api.listReferees({ referrerId: first.id, limit: 5 }));
  it("carries the totals and the verification of that affiliate", () => {
    const out = html(<AffiliateRail vm={vm} status={dataStatus({ status: "ok", data: 1, sample: true, source: "sample" as const })} />);
    for (const label of ["Lifetime earnings", "Available", "On hold", "Paid out", "KYC", "Status"]) expect(out).toContain(label);
    expect(out).toContain("Sample data");
    expect(out.toLowerCase()).not.toMatch(/bank|ifsc|\bpan\b/);
  });
});
