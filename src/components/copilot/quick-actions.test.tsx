import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CopilotQuickActions } from "./quick-actions";

vi.mock("@/app/(dashboard)/tasks/actions", () => ({ createTaskAction: vi.fn() }));

const base = {
  clientId: "c1",
  clientName: "Asha Rao",
  assignedToId: null,
  suggestedFollowUp: { title: "Call about renewal", dueAtIso: "2026-10-20T09:00:00.000Z" },
  users: [{ id: "u1", name: "Priya" }],
};

const suggestion = {
  channel: "whatsapp" as const,
  templateId: "tpl-42",
  templateName: "Follow-up",
  variables: { name: "Asha" },
};

describe("CopilotQuickActions row", () => {
  it("renders the primary Follow-up button with its visible text and a More button named for the client", () => {
    const out = renderToStaticMarkup(<CopilotQuickActions {...base} messageSuggestion={suggestion} />);
    expect(out).toContain(">Follow-up<");
    expect(out).toContain('aria-label="More actions for Asha Rao"');
    expect(out).toContain(">More<");
  });

  it("does not show a second Message button on the row", () => {
    const out = renderToStaticMarkup(<CopilotQuickActions {...base} messageSuggestion={suggestion} />);
    expect(out).not.toContain(">Message<");
    expect(out.match(/Follow-up/g)?.length).toBe(1);
  });

  it("shows only Follow-up when there is no suggested message", () => {
    const out = renderToStaticMarkup(<CopilotQuickActions {...base} messageSuggestion={null} />);
    expect(out).toContain(">Follow-up<");
    expect(out).not.toContain("More actions for");
  });
});
