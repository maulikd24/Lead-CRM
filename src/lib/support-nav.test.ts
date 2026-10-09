import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Support SLA nav item", () => {
  it("is absent unless NEXT_PUBLIC_SUPPORT_SLA=1", async () => {
    const { NAV_ITEMS } = await import("./nav-items");
    expect(NAV_ITEMS.some((i) => i.href === "/support")).toBe(false);
  });
  it("is added for admins and managers only when the flag is on, with a description", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_SLA", "1");
    vi.resetModules();
    const { NAV_ITEMS } = await import("./nav-items");
    const { NAV_DESCRIPTIONS } = await import("./nav-descriptions");
    const item = NAV_ITEMS.find((i) => i.href === "/support");
    expect(item).toMatchObject({ label: "Support SLA", roles: ["ADMIN", "MANAGER"], category: "insights" });
    expect(NAV_DESCRIPTIONS["/support"]).toBeTruthy();
  });
});
