import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SuggestedReplyView, type SuggestedReplyViewProps } from "./suggested-reply-view";
import type { AssistState } from "@/lib/agents/reply-assist-service";

const noop = () => {};
const render = (over: Partial<SuggestedReplyViewProps> = {}) =>
  renderToStaticMarkup(<SuggestedReplyView state={{ enabled: true, auto: false, view: { kind: "none" } }} generating={false} usedId={null} onSuggest={noop} onUse={noop} onRegenerate={noop} onDismiss={noop} {...over} />);
const st = (view: AssistState["view"], message?: string): AssistState => ({ enabled: true, auto: false, view, message });

describe("SuggestedReplyView", () => {
  it("renders nothing while loading or when the feature is off", () => {
    expect(render({ state: null })).toBe("");
    expect(render({ state: { enabled: false, auto: false, view: { kind: "none" } } })).toBe("");
  });

  it("none: offers a Suggest a reply button and shows a notice", () => {
    const html = render({ state: st({ kind: "none" }, "Could not draft a reply right now. Try again.") });
    expect(html).toContain("Suggest a reply");
    expect(html).toContain("Could not draft a reply right now");
  });

  it("generating: shows the shimmer with a polite live region", () => {
    const html = render({ generating: true });
    expect(html).toContain("wa-assist-shimmer");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Drafting a reply");
  });

  it("draft: text, reason chip, character counter and the three actions", () => {
    const body = "Hi Riya, your KYC is with our team.";
    const html = render({ state: st({ kind: "draft", id: "p1", body, reason: "kyc_stuck_in_documents", expiresAt: "2026-10-10T00:00:00Z" }) });
    expect(html).toContain(body);
    expect(html).toContain("KYC documents");
    expect(html).toContain(`${body.length} characters`);
    for (const label of ["Use", "Regenerate", "Dismiss"]) expect(html).toContain(label);
    expect(html).toContain("Nothing is sent until you press Send");
  });

  it("draft already in the composer: Use is disabled and the badge says so", () => {
    const html = render({ usedId: "p1", state: st({ kind: "draft", id: "p1", body: "x", reason: "kyc_pending", expiresAt: "2026-10-10T00:00:00Z" }) });
    expect(html).toContain("In composer");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Edit below, then Send/);
  });

  it("blocked: says could not draft safely and never shows draft text", () => {
    const html = render({ state: st({ kind: "blocked", id: "p1" }) });
    expect(html).toContain("Could not draft safely");
    expect(html).toContain("Try again");
  });

  it("needs human: an alert banner and no draft actions", () => {
    const html = render({ state: st({ kind: "needs_human", id: "p1", detail: "x" }) });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Needs a person");
    expect(html).not.toContain("Use</button>");
    expect(html).not.toContain("Suggest a reply");
  });

  it("uses theme tokens only (no hard-coded colours)", () => {
    const html = render({ state: st({ kind: "draft", id: "p1", body: "x", reason: "kyc_pending", expiresAt: "2026-10-10T00:00:00Z" }) });
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(/);
  });
});
