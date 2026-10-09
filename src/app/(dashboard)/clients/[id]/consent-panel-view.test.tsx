import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./consent-actions", () => ({ changeConsentAction: vi.fn() }));
import { ConsentPanelView, type HistoryItem } from "./consent-panel-view";
import { buildPanelRows } from "@/lib/consent/view";
import { resolvePolicy } from "@/lib/consent/policy";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { CountUp } from "@/components/consent/count-up";

const NOW = new Date("2026-10-09T10:00:00Z");
const rows = buildPanelRows(
  [
    { id: "1", purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: new Date("2026-09-01"), source: "LEAD_FORM", noticeVersion: "v1" },
    { id: "2", purpose: "MARKETING_COMMS", channel: null, status: "WITHDRAWN", capturedAt: new Date("2026-09-20"), source: "WHATSAPP_KEYWORD", noticeVersion: null },
    { id: "3", purpose: "DO_NOT_CONTACT", channel: "sms", status: "GRANTED", capturedAt: new Date("2026-09-21"), source: "RM_RECORDED", noticeVersion: null },
  ],
  null, NOW, resolvePolicy({}),
);
const history: HistoryItem[] = [
  { id: "2", at: new Date("2026-09-20"), purpose: "MARKETING_COMMS", channel: null, status: "WITHDRAWN", source: "WHATSAPP_KEYWORD", by: null, reason: "Customer sent an opt-out keyword on WhatsApp" },
  { id: "1", at: new Date("2026-09-01"), purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", source: "LEAD_FORM", by: "Asha", reason: null },
];
const html = (canEdit: boolean) => renderToStaticMarkup(<ConsentPanelView rows={rows} history={history} canEdit={canEdit} clientId="c1" />);

describe("ConsentPanelView", () => {
  it("shows every purpose with state, source and date as text (not colour alone)", () => {
    const out = html(true);
    for (const label of ["Marketing messages", "Service messages", "AI processing of chats", "Call recording", "Sharing with partners", "Do not contact"]) expect(out).toContain(label);
    expect(out).toContain("Withdrawn");
    expect(out).toContain("whatsapp keyword");
    expect(out).toContain("Do not contact");
    expect(out).toContain("sms");
    expect(out).toContain("Not recorded");
    expect(out).toContain("Opt-in required");
    expect(out).toContain("Allowed by default");
  });
  it("lists history with who and why", () => {
    const out = html(true);
    expect(out).toContain("History (2)");
    expect(out).toContain("Asha");
    expect(out).toContain("opt-out keyword");
  });
  it("offers the record/withdraw action only to people allowed to use it", () => {
    expect(html(true)).toContain("Record consent or withdrawal");
    expect(html(false)).not.toContain("Record consent or withdrawal");
  });
  it("is labelled for assistive tech", () => {
    expect(html(false)).toContain('aria-labelledby="consent-heading"');
    expect(html(false)).toContain('id="consent-heading"');
  });
  it("has no hard-coded colours", () => {
    expect(html(true)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });
  it("shows an empty history politely", () => {
    const out = renderToStaticMarkup(<ConsentPanelView rows={rows} history={[]} canEdit={false} clientId="c1" />);
    expect(out).toContain("Nothing has been recorded");
  });
});

describe("small consent pieces", () => {
  it("the banner is a status region with the text", () => {
    const out = renderToStaticMarkup(<ConsentBanner text="This customer withdrew consent for marketing messages." />);
    expect(out).toContain('role="status"');
    expect(out).toContain("withdrew consent");
  });
  it("CountUp hides the drawn number from assistive tech and carries the real value as text", () => {
    const out = renderToStaticMarkup(<CountUp value={42} />);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("--consent-n:42");
    expect(out).toContain(">42<");
  });
});
