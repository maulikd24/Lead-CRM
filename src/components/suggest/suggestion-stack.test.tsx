import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { SuggestionStack } from "./suggestion-stack";

const items = [
  { id: "c1:contact_client", title: "Contact client", subject: "Riya Shah", reason: "New lead waiting 20 minutes", href: "/clients/c1" },
  { id: "c2:follow_up_kyc", title: "Follow up KYC", subject: "Kabir Mehta", reason: "KYC pending for 3 days" },
  { id: "c3:submit_kyc", title: "Submit KYC", subject: "Meera Iyer", reason: "All documents verified" },
  { id: "c4:x", title: "Fourth", subject: "Four", reason: "r" },
];

describe("SuggestionStack", () => {
  const out = renderToStaticMarkup(<SuggestionStack items={items} storageKey="k" onAccept={async () => {}} />);
  it("shows the top suggestion with its reason, and peeks two more beneath it", () => {
    expect(out).toContain("Contact client");
    expect(out).toContain("Why: ");
    expect(out).toContain("New lead waiting 20 minutes");
    expect(out.match(/data-depth="/g)?.length).toBe(3);
    expect(out).not.toContain("Fourth");
  });
  it("offers accept, snooze and dismiss as real buttons, so keyboard and screen reader users are not left out", () => {
    expect(out).toContain('aria-label="Create task: Contact client"');
    expect(out).toContain('aria-label="Snooze until tomorrow: Contact client"');
    expect(out).toContain('aria-label="Dismiss: Contact client"');
  });
  it("says it is draft-only", () => {
    expect(out).toContain("nothing is sent to a customer");
  });
  it("has a polite live region and hides the cards behind the top one from assistive tech", () => {
    expect(out).toMatch(/role="status"[^>]*aria-live="polite"/);
    expect(out).toContain('aria-hidden="true"');
  });
  it("shows a calm empty line when there is nothing to suggest", () => {
    expect(renderToStaticMarkup(<SuggestionStack items={[]} storageKey="k" onAccept={async () => {}} />)).toContain("all caught up");
  });
});
