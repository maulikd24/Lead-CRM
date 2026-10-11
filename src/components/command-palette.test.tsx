import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/app/(dashboard)/command-search-actions", () => ({ searchClientsForPalette: async () => [] }));
vi.mock("@/app/(dashboard)/tasks/actions", () => ({ createTaskAction: async () => ({}) }));
vi.mock("@/app/(dashboard)/clients/actions", () => ({ recordRmContactAction: async () => ({}) }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
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

describe("quick actions", () => {
  it("renders the quick-action forms with labelled fields and a back control", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { QuickActionForm } = await import("./command-bar/quick-forms");
    const task = renderToStaticMarkup(<QuickActionForm kind="task" userId="u1" onBack={() => {}} onDone={() => {}} />);
    expect(task).toContain('aria-label="Add a task"');
    expect(task).toContain('aria-label="Back to search"');
    expect(task).toContain("Tomorrow");
    const call = renderToStaticMarkup(<QuickActionForm kind="call" userId="u1" onBack={() => {}} onDone={() => {}} />);
    expect(call).toContain('aria-label="Log a call"');
    expect(call).toContain("Wrong number");
  });
});
