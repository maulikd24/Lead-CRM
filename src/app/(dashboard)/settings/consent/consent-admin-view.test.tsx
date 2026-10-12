import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const nav = vi.hoisted(() => ({ tab: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.tab ? `tab=${nav.tab}` : ""),
  usePathname: () => "/settings/consent",
}));

import { ConsentAdminView } from "./consent-admin-view";
import { resolvePolicy } from "@/lib/consent/policy";

const NOW = new Date("2026-10-09T10:00:00Z");
const counts = [
  { purpose: "MARKETING_COMMS", granted: 12, withdrawn: 3, expired: 1, notRecorded: 20, legacyGranted: 5 },
  { purpose: "SERVICE_COMMS", granted: 0, withdrawn: 0, expired: 0, notRecorded: 41, legacyGranted: 0 },
  { purpose: "AI_PROCESSING_OF_CHATS", granted: 2, withdrawn: 0, expired: 0, notRecorded: 39, legacyGranted: 0 },
  { purpose: "CALL_RECORDING", granted: 0, withdrawn: 0, expired: 0, notRecorded: 41, legacyGranted: 0 },
  { purpose: "DATA_SHARING_PARTNERS", granted: 0, withdrawn: 0, expired: 0, notRecorded: 41, legacyGranted: 0 },
  { purpose: "DO_NOT_CONTACT", granted: 2, withdrawn: 1, expired: 0, notRecorded: 38, legacyGranted: 0 },
];
const recent = [
  { id: "r1", purpose: "MARKETING_COMMS", channel: "whatsapp", source: "WHATSAPP_KEYWORD", at: new Date("2026-10-09T08:00:00Z"), clientId: "c1", clientCode: "CL-00007" },
  { id: "r2", purpose: "MARKETING_COMMS", channel: null, source: "RM_RECORDED", at: new Date("2026-09-01T08:00:00Z"), clientId: "c2", clientCode: "CL-00002" },
];
const html = (tab = "", over: Partial<Parameters<typeof ConsentAdminView>[0]> = {}) => {
  nav.tab = tab;
  return renderToStaticMarkup(<ConsentAdminView policy={resolvePolicy({})} counts={counts} recent={recent} enforced={false} now={NOW} {...over} />);
};

describe("ConsentAdminView workspace", () => {
  it("has four tabs and exactly one panel, overview first", () => {
    const out = html();
    expect(out).toContain('role="tablist"');
    for (const label of ["Overview", "Ledger", "Withdrawals", "Policy and export"]) expect(out).toContain(label);
    expect(out.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(out).toMatch(/id="consent-tab-overview"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="consent-tab-overview"/);
  });
  it("keeps the export link in the header", () => {
    expect(html()).toContain("/api/consent/export");
  });
  it("shows only the active section", () => {
    expect(html()).not.toContain("Where things stand");
    expect(html("ledger")).toContain("Where things stand");
    expect(html("ledger")).not.toContain("CL-00007");
    expect(html("withdrawals")).toContain("CL-00007");
    expect(html("policy")).toContain("Do-not-contact applies");
    expect(html("nope")).toContain("Share granted by purpose"); // falls back to overview
  });
  it("puts the key facts in the rail", () => {
    const out = html();
    for (const label of ["Enforcement", "Do not contact, in force", "Withdrawn, last 24 hours", "Purposes needing an opt-in"]) expect(out).toContain(label);
  });
});

describe("ConsentAdminView sections", () => {
  it("overview shows each bar's percentage as text", () => {
    expect(html()).toContain("41%"); // marketing: 17 of 41
  });
  it("says plainly that enforcement is off, and on", () => {
    expect(html()).toContain("Enforcement off");
    expect(html()).toContain("Nothing is blocked yet");
    expect(html("", { enforced: true })).toContain("Enforcement on");
  });
  it("reads a lifted do-not-contact entry as lifted", () => {
    const out = html("withdrawals", { recent: [{ id: "r3", purpose: "DO_NOT_CONTACT", channel: null, source: "RM_RECORDED", at: new Date("2026-10-08T08:00:00Z"), clientId: "c3", clientCode: "CL-00009" }] });
    expect(out).toContain("Do not contact (lifted)");
  });
  it("policy shows a mode for each purpose", () => {
    const out = html("policy");
    expect(out).toContain("Opt-in required");
    expect(out).toContain("Allowed by default");
  });
  it("shows record-only after an override", () => {
    expect(html("policy", { policy: resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: "MARKETING_COMMS" }) })).toContain("Record only");
  });
  it("ledger shows counts as real text and the legacy lead-form share", () => {
    const out = html("ledger");
    expect(out).toContain(">17<"); // 12 granted + 5 from the lead form
    expect(out).toContain("from the lead form");
    expect(out).toContain(">20<");
  });
  it("lists recent withdrawals by client code only, flags the last 24 hours, and links to the customer", () => {
    const out = html("withdrawals");
    expect(out).toContain("CL-00007");
    expect(out).toContain('href="/clients/c1"');
    expect(out.match(/Last 24 hours/g)).toHaveLength(1);
  });
  it("has no hard-coded colours and no external requests", () => {
    for (const tab of ["", "ledger", "withdrawals", "policy"]) {
      const out = html(tab).replace(/ xmlns="[^"]*"/g, ""); // the SVG namespace is not a request
      expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
      expect(out).not.toMatch(/https?:\/\//);
    }
  });
  it("shows an empty state for withdrawals", () => {
    expect(html("withdrawals", { recent: [] })).toContain("No withdrawals recorded");
  });
});
