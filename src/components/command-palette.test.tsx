import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/app/(dashboard)/command-search-actions", () => ({ searchClientsForPalette: async () => [] }));
vi.mock("@/app/(dashboard)/intelligence/actions", () => ({ askSystemAction: async () => ({ ok: false, error: "" }) }));

import { CommandPalette } from "./command-palette";

describe("command palette trigger", () => {
  const out = renderToString(<CommandPalette role="ADMIN" userId="u1" />);
  it("is a prominent, named search button that says what Command K does", () => {
    expect(out).toContain("<button");
    expect(out).toContain('aria-label="Search clients, pages and actions (Command K)"');
    expect(out).toContain("Search clients, pages, actions");
    expect(out).toContain("⌘K");
  });
  it("is full width up to a comfortable maximum and 40px tall", () => {
    expect(out).toContain("h-10");
    expect(out).toContain("max-w-md");
  });
  it("does not render the dialog until it is opened", () => {
    expect(out).not.toContain('role="dialog"');
  });
});
