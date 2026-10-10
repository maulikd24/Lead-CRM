import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
const html = (over: Partial<Parameters<typeof ConsentAdminView>[0]> = {}) =>
  renderToStaticMarkup(<ConsentAdminView policy={resolvePolicy({})} counts={counts} recent={recent} enforced={false} now={NOW} {...over} />);

describe("ConsentAdminView", () => {
  it("reads a lifted do-not-contact entry as lifted, and shows each bar's percentage as text", () => {
    const out = html({ recent: [{ id: "r3", purpose: "DO_NOT_CONTACT", channel: null, source: "RM_RECORDED", at: new Date("2026-10-08T08:00:00Z"), clientId: "c3", clientCode: "CL-00009" }] });
    expect(out).toContain("Do not contact (lifted)");
    expect(out).toContain("20%"); // marketing: 17 of 41
  });
  it("says plainly that enforcement is off, and on", () => {
    expect(html()).toContain("Enforcement off");
    expect(html()).toContain("Nothing is blocked yet");
    expect(html({ enforced: true })).toContain("Enforcement on");
  });
  it("shows the policy table with a mode for each purpose", () => {
    const out = html();
    expect(out).toContain("Opt-in required");
    expect(out).toContain("Allowed by default");
    expect(out).toContain("Do-not-contact applies");
  });
  it("shows record-only after an override", () => {
    expect(html({ policy: resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: "MARKETING_COMMS" }) })).toContain("Record only");
  });
  it("shows counts as real text and the legacy lead-form share", () => {
    const out = html();
    expect(out).toContain(">17<"); // 12 granted + 5 from the lead form
    expect(out).toContain("from the lead form");
    expect(out).toContain(">20<");
  });
  it("lists recent withdrawals by client code only, flags the last 24 hours, and links to the customer", () => {
    const out = html();
    expect(out).toContain("CL-00007");
    expect(out).toContain('href="/clients/c1"');
    expect(out.match(/Last 24 hours/g)).toHaveLength(1);
  });
  it("has no hard-coded colours and no external requests", () => {
    const out = html();
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
    expect(out).not.toMatch(/https?:\/\//);
  });
  it("shows an empty state for withdrawals", () => {
    expect(html({ recent: [] })).toContain("No withdrawals recorded");
  });
});
