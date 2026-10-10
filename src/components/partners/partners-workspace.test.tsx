import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createMockReferralApi } from "@/lib/partners/mock-data";
import { buildContractVM, dataStatus } from "@/lib/partners/status";
import { buildReferrerDetailVM } from "@/lib/partners/view-models";
import { ContractView } from "./contract-view";
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
  it("the status card leaves out its own link when you are already on the contract check", () => {
    expect(html(<StatusCard link={false} status={dataStatus({ status: "not_connected" })} />)).not.toContain("/partners/contract");
  });
  it("loading is a busy panel with still placeholders and no spinner or shimmer", () => {
    for (const tab of ["overview", "affiliates", "contract"] as const) {
      const out = html(<PartnerLoading tab={tab} />);
      expect(out).toContain('aria-busy="true"');
      expect(out).not.toMatch(/animate-pulse|animate-spin/);
    }
  });
  it("the status card says what the data is and links to the contract check", () => {
    const out = html(<StatusCard status={dataStatus({ status: "ok", data: 1, sample: false, contractVerified: false, source: "external" as const })} />);
    expect(out).toContain("Contract not verified");
    expect(out).toContain('href="/partners/contract"');
  });
});

describe("Affiliate rail", async () => {
  const first = (await api.listReferrers({ limit: 1 })).items[0];
  const vm = buildReferrerDetailVM(await api.getReferrer(first.id), await api.listReferees({ referrerId: first.id, limit: 5 }));
  it("carries the totals and the verification of that affiliate", () => {
    const out = html(<AffiliateRail vm={vm} status={dataStatus({ status: "ok", data: 1, sample: true, contractVerified: false, source: "sample" as const })} />);
    for (const label of ["Lifetime earnings", "Available", "On hold", "Paid out", "KYC", "Status"]) expect(out).toContain(label);
    expect(out).toContain("Sample data");
    expect(out.toLowerCase()).not.toMatch(/bank|ifsc|\bpan\b/);
  });
});

describe("Contract check section", () => {
  const info = { state: "live" as const, verified: false, verifiedAt: null, version: "2026-10-r1" };
  it("shows status, next steps, the command and what the check covers", () => {
    const out = html(<ContractView vm={buildContractVM(info, { isAdmin: true })} />);
    expect(out).toContain("Contract not verified");
    expect(out).toContain("What to do next");
    expect(out).toContain("partner-contract-check.ts");
    expect(out).toContain("What the check covers");
    expect(out).toContain('href="/settings/integrations?tab=data"');
  });
  it("hides the Settings link from a role that cannot use it and never shows a secret", () => {
    const out = html(<ContractView vm={buildContractVM(info, { isAdmin: false })} />);
    expect(out).not.toContain("/settings/integrations");
    expect(out).toContain("&lt;view-only token&gt;");
    expect(out).not.toMatch(/Bearer|sk-/);
  });
  it("is read-only: no buttons that change anything", () => {
    expect(html(<ContractView vm={buildContractVM(info, { isAdmin: true })} />)).not.toContain("<button");
  });
});
