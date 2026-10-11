import { expect, test, type Page } from "@playwright/test";

/**
 * Decision Engine v2 (shadow). Needs a build with NEXT_PUBLIC_DECISION_DRAWER=1 against a seeded local database
 * (admin@, manager@, rm@, marketing@, finance@). The review list is Admin and Manager; the shadow report is Admin only; an RM, marketing
 * and finance have no link and are sent home. There are no stored decisions in the e2e database, so the lists show their empty state.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

test("an Admin opens the review list and the shadow report with its exit criteria", async ({ page }) => {
  await signIn(page, "admin@supportify.local");
  await page.goto("/decisions");
  await expect(page.getByRole("heading", { name: "Decision review" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Decisions" })).toBeVisible();
  await page.goto("/settings/decision-shadow");
  await expect(page.getByRole("heading", { name: "Decision Engine shadow report" })).toBeVisible();
  await expect(page.getByRole("tabpanel")).toContainText("No material suppression regressions");
  await expect(page.getByRole("tabpanel")).toContainText("Consent-policy agreement is 100%");
});

test("a Manager can review decisions but not open the admin report", async ({ page }) => {
  await signIn(page, "manager@supportify.local");
  await page.goto("/decisions");
  await expect(page.getByRole("heading", { name: "Decision review" })).toBeVisible();
  await page.goto("/settings/decision-shadow");
  await expect(page).not.toHaveURL(/decision-shadow/);
});

for (const email of ["rm@supportify.local", "marketing@supportify.local", "finance@supportify.local"]) {
  test(`${email.split("@")[0]} cannot open the review list or the report and has no link to either`, async ({ page }) => {
    await signIn(page, email);
    for (const path of ["/decisions", "/settings/decision-shadow"]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(new RegExp(path.replace("/", "\\/")));
    }
    await expect(page.getByRole("link", { name: "Decision review" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Decision shadow report" })).toHaveCount(0);
  });
}

test("a signed-out visitor is sent to login", async ({ page }) => {
  await page.goto("/decisions");
  await expect(page).toHaveURL(/\/login/);
});
