import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Campaign planner (needs a build with NEXT_PUBLIC_PLANNER=1 and NEXT_PUBLIC_MARKETING=1, and the seeded role users of prisma/seed-e2e.ts).
 * An Admin registers a destination and a creator without a SEBI number; Marketing plans a campaign (a promise on a channel landing on a
 * destination), gets tracked links with a campaign code and a QR code, and sends it for review; the four-eyes rule and the checklist hold at
 * the approval gate; an unregistered creator is blocked; the desk roles never see the planner.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const RUN = Date.now().toString(36);

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

async function asAdmin(browser: Browser, baseURL: string | undefined) {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await signIn(page, "admin@supportify.local");
  return { ctx, page };
}

test("Admin registers a destination and a creator; Marketing plans, links and submits; four-eyes and the checklist hold", async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const baseURL = info.project.use.baseURL;
  const admin = await asAdmin(browser, baseURL);

  // --- Admin: registries ------------------------------------------------------------------------------------------
  await admin.page.goto("/planner?tab=destinations");
  await expect(admin.page.getByRole("heading", { name: "Campaign planner" })).toBeVisible();
  await admin.page.getByRole("link", { name: "Add a destination" }).click();
  const dlg = admin.page.getByRole("dialog");
  await dlg.getByRole("textbox", { name: "Name", exact: true }).fill(`Retirement planner ${RUN}`);
  await dlg.getByLabel("URL").fill(`https://www.example.test/retirement-${RUN}`);
  await dlg.getByLabel("Status").selectOption("LIVE");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(admin.page.getByRole("list", { name: "Destinations" })).toContainText(`Retirement planner ${RUN}`, { timeout: 20_000 });

  await admin.page.goto("/planner?tab=creators");
  await admin.page.getByRole("link", { name: "Add a creator" }).click();
  const cdlg = admin.page.getByRole("dialog");
  await cdlg.getByRole("textbox", { name: "Name", exact: true }).fill(`Unregistered ${RUN}`);
  await cdlg.getByLabel("Handle").fill(`@unreg_${RUN}`);
  await cdlg.getByRole("button", { name: "Save" }).click();
  await expect(admin.page.getByRole("list", { name: "Creators" })).toContainText("Blocked: no SEBI registration", { timeout: 20_000 });

  // --- Marketing: a plan ------------------------------------------------------------------------------------------
  await signIn(page, "marketing@supportify.local");
  await page.goto("/planner");
  await expect(page.getByRole("tab", { name: "Board" })).toBeVisible();
  await page.getByRole("link", { name: "New plan" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Title").fill(`Retirement search ${RUN}`);
  await form.getByRole("combobox", { name: "Audience", exact: true }).selectOption({ label: "Salaried professionals" });
  await form.getByRole("combobox", { name: "Promise", exact: true }).selectOption({ label: "See if you are on track for retirement" });
  await form.getByLabel("Channel").selectOption("search_ad");
  await form.getByLabel("Destination").selectOption({ label: `Retirement planner ${RUN}` });
  await form.getByLabel("Owner").selectOption({ index: 1 });
  await form.getByLabel("Consent the follow-up relies on").selectOption("MARKETING_COMMS");
  await form.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByRole("heading", { name: `Retirement search ${RUN}` })).toBeVisible({ timeout: 30_000 });
  const planUrl = page.url();

  // Tracked links: the campaign code, the UTM names, a QR code, and no personal data.
  await page.getByRole("tab", { name: "Links" }).click();
  const link = page.getByTestId("tracked-url").first();
  await expect(link).toContainText("campaign_code=CP-");
  await expect(link).toContainText("utm_source=google");
  await expect(page.getByRole("img", { name: /QR code/ }).first()).toBeVisible();

  // Send for review (allowed: the promise passes), then the gates.
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByText("Status: Needs review")).toBeVisible({ timeout: 20_000 });

  await page.getByLabel("I have reviewed this plan").check();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /different person|second pair of eyes/i })).toBeVisible();

  await admin.page.goto(planUrl);
  await admin.page.getByLabel("I have reviewed this plan").check();
  await admin.page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(admin.page.getByRole("alert").filter({ hasText: /Cannot approve yet/i })).toBeVisible();
  await expect(admin.page.getByText("Status: Needs review")).toBeVisible();

  // --- The creator block ------------------------------------------------------------------------------------------
  await page.goto("/planner?new=1");
  const f2 = page.getByRole("dialog");
  await f2.getByLabel("Title").fill(`Video ${RUN}`);
  await f2.getByRole("combobox", { name: "Audience", exact: true }).selectOption({ label: "NRIs" });
  await f2.getByRole("combobox", { name: "Promise", exact: true }).selectOption({ label: "Invest from India as an NRI: what to know" });
  await f2.getByLabel("Channel").selectOption("short_video");
  await f2.getByLabel("Destination").selectOption({ label: `Retirement planner ${RUN}` });
  await f2.getByLabel("Creator (short video only)").selectOption({ label: `Unregistered ${RUN} (blocked: no SEBI registration)` });
  await f2.getByLabel("Owner").selectOption({ index: 1 });
  await f2.getByRole("button", { name: "Create plan" }).click();
  await expect(f2.getByRole("alert").filter({ hasText: /SEBI registration/i })).toBeVisible();

  await admin.ctx.close();
});

for (const email of ["manager@supportify.local", "rm@supportify.local", "finance@supportify.local", "partner1@supportify.local"]) {
  test(`${email.split("@")[0]} cannot open the planner and has no link to it`, async ({ page }) => {
    await signIn(page, email);
    await page.goto("/planner");
    await expect(page).not.toHaveURL(/\/planner/);
    await expect(page.getByRole("link", { name: "Campaign planner" })).toHaveCount(0);
  });
}

test("a signed-out visitor is sent to login", async ({ page }) => {
  await page.goto("/planner");
  await expect(page).toHaveURL(/\/login/);
});
