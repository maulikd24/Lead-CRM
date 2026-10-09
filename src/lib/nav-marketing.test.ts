import { afterEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  const nav = await import("./nav-items");
  const desc = await import("./nav-descriptions");
  return { ...nav, NAV_DESCRIPTIONS: desc.NAV_DESCRIPTIONS };
}

describe("Marketing nav item", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is absent by default, in the menu and in the tour text", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING", "");
    const { NAV_ITEMS, NAV_DESCRIPTIONS } = await load();
    expect(NAV_ITEMS.some((i) => i.href === "/marketing")).toBe(false);
    expect(NAV_DESCRIPTIONS["/marketing"]).toBeUndefined();
  });

  it("appears for Admins and Managers only, under Insights, when NEXT_PUBLIC_MARKETING=1", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING", "1");
    const { NAV_ITEMS, NAV_DESCRIPTIONS } = await load();
    const item = NAV_ITEMS.find((i) => i.href === "/marketing");
    expect(item).toMatchObject({ label: "Marketing", category: "insights", roles: ["ADMIN", "MANAGER"] });
    expect(NAV_DESCRIPTIONS["/marketing"]).toMatch(/cost per lead/i);
  });

  it("is never one of a role's primary screens", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING", "1");
    const { primaryNavFor } = await load();
    for (const role of ["ADMIN", "MANAGER", "RM"] as const) expect(primaryNavFor(role).map((i) => i.href)).not.toContain("/marketing");
  });

  it("only turns on for the exact value 1", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING", "true");
    const { NAV_ITEMS } = await load();
    expect(NAV_ITEMS.some((i) => i.href === "/marketing")).toBe(false);
  });
});
