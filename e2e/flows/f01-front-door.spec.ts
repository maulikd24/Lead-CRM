import AxeBuilder from "@axe-core/playwright";
import pg from "pg";

import { TRUST_ITEMS, trustStatementHash } from "../../src/lib/front-door/trust-config";

import { expect, test } from "../support/fixtures";

// The signed-out front door: landing at the root and the redesigned sign-in page (needs the build with NEXT_PUBLIC_LANDING=1,
// which ci/flags-all-on.env sets). Also guarded by the shared fixture: nothing here may reach a non-local host.

test.describe("landing (signed out)", () => {
  test("shows the headline, a sign-in route, a skip link and the footer credit", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Know every customer.");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Know what to do next.");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeAttached();
    await expect(page.getByText("Allvest Customer OS").last()).toBeVisible();
    // Licence credit lives in the app (About) and docs, not on the public pages.
    await expect(page.getByText("Supportify")).toHaveCount(0);
    // Semantic headings: one h1, then h2 sections.
    expect(await page.locator("h1").count()).toBe(1);
    expect(await page.locator("main h2").count()).toBeGreaterThanOrEqual(4);
  });

  test("no horizontal scroll at 375px and at 1440px", async ({ page }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await page.locator("footer").scrollIntoViewIfNeeded();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `overflow at ${width}`).toBeLessThanOrEqual(0);
    }
  });

  test("the scroll story advances with scroll and the preview follows (evidence appears at step 3)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const steps = page.locator(".fd-step");
    await expect(steps).toHaveCount(6);
    await steps.nth(0).scrollIntoViewIfNeeded();
    await expect(page.locator('.fd-step[data-active="true"]')).toContainText("Start with the whole customer.");
    await expect(page.getByRole("complementary", { name: "Evidence" })).toHaveCount(0);
    await steps.nth(2).scrollIntoViewIfNeeded();
    await expect(page.locator('.fd-step[data-active="true"]')).toContainText("Choose one next step");
    await expect(page.getByRole("complementary", { name: "Evidence" })).toBeVisible();
    await expect(page.getByText("Fix the complaint").first()).toBeVisible();
    await steps.nth(5).scrollIntoViewIfNeeded();
    await expect(page.getByText("Waiting for RM approval")).toBeVisible();
  });

  test("the role switcher proves segregation: Marketing never sees customers, an RM never sees ad spend", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator("#roles").scrollIntoViewIfNeeded();
    const tab = (name: string) => page.getByRole("tab", { name });
    await expect(tab("RM")).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("navigation", { name: "RM sidebar" })).toContainText("Clients");
    await expect(panel.getByRole("navigation", { name: "RM sidebar" })).not.toContainText("Marketing");
    await expect(panel.getByText("Ad spend and campaigns").locator("..")).toContainText("No");

    await tab("Marketing").click();
    await expect(tab("Marketing")).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("navigation", { name: "Marketing sidebar" })).not.toContainText("Clients");
    await expect(panel.getByText("Customer names and records").locator("..")).toContainText("No");
    await expect(panel.getByText("Ad spend and campaigns").locator("..")).toContainText("Yes");
    for (const name of ["Rahul", "Meera", "Arjun", "Neha"]) await expect(panel.getByText(name)).toHaveCount(0);

    // Keyboard: arrow keys move and select.
    await tab("Marketing").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab("Management")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tab("Control plane")).toHaveAttribute("aria-selected", "true");
  });

  test("Ask is a labelled scripted demo with fixed answers", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator("#ask").scrollIntoViewIfNeeded();
    await expect(page.getByText("Scripted answers. No live AI call.")).toBeVisible();
    await page.getByRole("button", { name: /Why was Rahul not sent the PMS follow-up/ }).click();
    await expect(page.getByText("do not sell while a complaint is open", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Sources")).toBeVisible();
  });

  test("prefers-reduced-motion: no animation is running", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("/");
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    expect(running).toBe(0);
    await ctx.close();
  });

  test("makes no request to any other host and loads no third-party script", async ({ page }) => {
    const hosts = new Set<string>();
    page.on("request", (r) => hosts.add(new URL(r.url()).hostname));
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("footer").scrollIntoViewIfNeeded();
    expect([...hosts].filter((h) => !["localhost", "127.0.0.1"].includes(h))).toEqual([]);
  });
});

test.describe("sign-in page (signed out)", () => {
  test("is the designed page: logo, one h1, labelled fields, a way back, no Google button while the flag is off", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to Customer OS");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue with Google/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Back to Allvest Customer OS/ })).toHaveAttribute("href", "/");
  });

  test("a wrong password shows one calm error and keeps the form (no user enumeration)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("rm@supportify.local");
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();
    const first = await page.getByRole("alert").filter({ hasText: "Invalid" }).innerText();
    await page.getByLabel("Email").fill("nobody@example.invalid");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();
    expect(await page.getByRole("alert").filter({ hasText: "Invalid" }).innerText()).toBe(first);
  });

  test("keyboard only: tab reaches the fields and the form submits with Enter", async ({ page }) => {
    await page.goto("/login");
    await page.keyboard.press("Tab"); // skip link
    await expect(page.getByRole("link", { name: "Skip to sign in" })).toBeFocused();
    await page.getByLabel("Email").focus();
    await page.keyboard.type("rm@supportify.local");
    await page.keyboard.press("Tab");
    await page.keyboard.type("definitely-not-the-password");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();
  });

  test("an old-style error code never reveals why: the page shows the plain form", async ({ page }) => {
    await page.goto("/login?error=AccessDenied");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByText("unknown user")).toHaveCount(0);
  });
});


async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const clearSignoff = () => withDb((c) => c.query(`delete from "IntegrationConfig" where provider='landing_trust_signoff'`));
const recordSignoff = (hash: string) =>
  withDb((c) =>
    c.query(
      `insert into "IntegrationConfig"(id, provider, mode, settings, "isEnabled", "updatedAt") values ('e2e-trust','landing_trust_signoff','live',$1,true,now()) on conflict (provider) do update set settings=excluded.settings`,
      [JSON.stringify({ statementHash: hash, reviewerName: "E2E Reviewer", reviewedOn: "2026-10-11", recordedById: "e2e", recordedAt: new Date().toISOString() })],
    ),
  );

test.describe("trust strip compliance gate", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(clearSignoff);
  test.afterAll(clearSignoff);

  test("without a recorded sign-off the strip and its nav link render nothing", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#trust")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Trust", exact: true })).toHaveCount(0);
    await expect(page.getByText("Consent ledger")).toHaveCount(0);
  });
  test("a sign-off for OLD wording does not show it", async ({ page }) => {
    await recordSignoff("some-older-wording-hash");
    await page.goto("/");
    await expect(page.locator("#trust")).toHaveCount(0);
  });
  test("with the sign-off recorded for the current wording the strip renders, in both themes, without axe violations", async ({ page }) => {
    await recordSignoff(trustStatementHash(TRUST_ITEMS));
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await page.locator("#trust").scrollIntoViewIfNeeded();
      await expect(page.locator("#trust h3")).toHaveCount(4);
      await expect(page.getByRole("link", { name: "Trust", exact: true })).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).include("#trust").withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(violations.map((v) => v.id), scheme).toEqual([]);
    }
  });
});

test.describe("theme toggle", () => {
  test("light by default; follows the system on the first visit; the choice is remembered; works with storage blocked", async ({ browser }) => {
    const theme = (p: import("@playwright/test").Page) => p.evaluate(() => document.documentElement.getAttribute("data-fd-theme"));
    // No preference: light.
    let ctx = await browser.newContext({ colorScheme: "no-preference" });
    let page = await ctx.newPage();
    await page.goto("/");
    expect(await theme(page)).toBe("light");
    await expect(page.locator("html")).toHaveCSS("background-color", "rgb(241, 244, 240)");
    // Toggle to dark, reload: remembered.
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    expect(await theme(page)).toBe("dark");
    await expect(page.locator("html")).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await page.reload();
    expect(await theme(page)).toBe("dark");
    await page.goto("/login");
    expect(await theme(page)).toBe("dark");
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    expect(await theme(page)).toBe("light");
    await ctx.close();
    // First visit with a dark system: dark.
    ctx = await browser.newContext({ colorScheme: "dark" });
    page = await ctx.newPage();
    await page.goto("/");
    expect(await theme(page)).toBe("dark");
    await ctx.close();
    // Storage blocked: still works for the page.
    ctx = await browser.newContext({ colorScheme: "light" });
    page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
    });
    await page.goto("/");
    expect(await theme(page)).toBe("light");
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    expect(await theme(page)).toBe("dark");
    await ctx.close();
  });
  test("no flash: the theme attribute is set before first paint", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      new MutationObserver((muts) => {
        for (const m of muts) if (m.attributeName === "data-fd-theme") (window as unknown as { __first?: string }).__first ??= (m.target as HTMLElement).getAttribute("data-fd-theme") ?? "";
      }).observe(document, { attributes: true, subtree: true });
    });
    await page.goto("/");
    expect(await page.evaluate(() => (window as unknown as { __first?: string }).__first)).toBe("dark");
    await ctx.close();
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    for (const path of ["/", "/login"]) {
      test(`no serious or critical violation on ${path}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(path, { waitUntil: "load" });
        await page.locator("footer, #login-main").first().scrollIntoViewIfNeeded();
        if (path === "/") {
          // Reveal the lazy sections first so axe sees them.
          for (const id of ["#story", "#roles", "#ask"]) {
            await page.locator(id).scrollIntoViewIfNeeded();
            await page.waitForTimeout(250);
          }
          await expect(page.getByRole("tablist", { name: "Choose a role" })).toBeVisible();
        }
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
        expect(violations.filter((v) => v.impact === "moderate").map((v) => v.id)).toEqual([]);
      });
    }
  });
}
