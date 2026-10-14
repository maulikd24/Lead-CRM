import { expect, test } from "../support/fixtures";

// F3b: the two-level navigation and Cmd+K, per role. Runs in every role project (flags-on build).
const RAIL: Record<string, string[]> = {
  admin: ["Today", "Customers", "Growth", "Service", "Partners", "Insights", "Admin"],
  manager: ["Today", "Customers", "Service", "Insights"],
  rm: ["Today", "Customers", "Service", "Insights"],
  finance: ["Today", "Partners"],
  partner: ["Today", "Partners"],
  marketing: ["Today", "Growth"], // Marketing's Insights items moved into Growth (lib/nav/model.test.ts pins this)
};
const ALL = ["Today", "Customers", "Growth", "Service", "Partners", "Insights", "Admin"];

test("the rail shows exactly the workspaces this role may use", async ({ page }, info) => {
  const want = RAIL[info.project.name];
  test.skip(!want, "no role expectation");
  await page.goto("/");
  await page.waitForLoadState("load");
  const rail = page.getByRole("navigation", { name: "Workspaces" });
  await expect(rail).toBeVisible();
  for (const label of want) await expect(rail.getByRole("link", { name: new RegExp(`^${label}`) })).toHaveCount(1);
  for (const label of ALL.filter((l) => !want.includes(l))) await expect(rail.getByRole("link", { name: new RegExp(`^${label}`) })).toHaveCount(0);
});

test("the rail and the panel work from the keyboard", async ({ page }, info) => {
  test.skip(!["rm", "admin"].includes(info.project.name), "one desk role and admin are enough");
  await page.goto("/dashboard");
  const rail = page.getByRole("navigation", { name: "Workspaces" });
  const first = rail.locator("[data-nav-item]").first();
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(rail.locator("[data-nav-item]").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const inPanel = await page.evaluate(() => !!document.activeElement?.closest('[data-nav-zone="panel"]'));
  expect(inPanel).toBe(true);
  await page.keyboard.press("ArrowLeft");
  await expect(rail.locator("[data-nav-item]").first()).toBeFocused();
});

test("All modules is an admin directory: everyone else is turned away", async ({ page }, info) => {
  const res = await page.goto("/modules");
  await page.waitForLoadState("load");
  const heading = page.getByRole("heading", { name: "All modules" });
  if (info.project.name === "admin") {
    await expect(heading).toBeVisible();
    await expect(page.getByText(/modules: \d+ active/)).toBeVisible();
  } else {
    expect(res?.status() === 404 || new URL(page.url()).pathname !== "/modules").toBe(true);
    await expect(heading).toHaveCount(0);
  }
});

test("Cmd+K never offers customers to a role that cannot open them", async ({ page }, info) => {
  await page.goto("/");
  await page.waitForLoadState("load");
  const box = page.getByRole("textbox", { name: "Search" });
  // One press is enough even before hydration: an inline script counts early presses and the palette opens for them (lib/palette/early-open.ts).
  await page.keyboard.press("Control+k");
  await expect(box).toBeVisible();
  await box.fill("E2E Client");
  await page.waitForTimeout(900);
  const customers = page.getByRole("group", { name: "Customers" });
  if (["admin", "manager", "rm"].includes(info.project.name)) await expect(customers).toBeVisible();
  else await expect(customers).toHaveCount(0);
  // Commands follow the registry: the customer commands exist only for the desk roles.
  await box.fill("Add task");
  const addTask = page.getByRole("button", { name: /Add task/ });
  if (["admin", "manager", "rm"].includes(info.project.name)) await expect(addTask).toBeVisible();
  else await expect(addTask).toHaveCount(0);
});
