import { expect, test, type Page } from "@playwright/test";

/**
 * Autopilot. Needs a build with NEXT_PUBLIC_AUTOPILOT=1 against a seeded local database (admin@ from prisma/seed.ts, marketing@ from the e2e seed).
 * ADMIN and MARKETING open it and see the tabs; every other role is sent home and has no link to it. Approving goes through the canonical approval
 * service; nothing here can reach an ad account (applying is blocked, no connection exists).
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

for (const email of ["admin@supportify.local", "marketing@supportify.local"]) {
  test(`${email.split("@")[0]} opens Autopilot, sees its tabs and the weekly digest, and can preview a rule without saving it`, async ({ page }) => {
    await signIn(page, email);
    await page.goto("/autopilot");
    await expect(page.getByRole("heading", { name: "Autopilot" })).toBeVisible();
    for (const name of ["Audit", "Issues and actions", "Rules", "Weekly digest"]) await expect(page.getByRole("tab", { name })).toBeVisible();
    await page.getByRole("tab", { name: "Rules" }).click();
    await page.getByLabel("this limit").fill("1");
    await page.getByLabel("Name").fill("E2E preview rule");
    await page.getByRole("button", { name: /Preview on today/ }).click();
    await expect(page.getByRole("region", { name: "Rule preview" })).toContainText("Nothing is changed by a preview");
    await expect(page.getByText("E2E preview rule", { exact: true })).toHaveCount(0); // previewed, not saved
    await page.getByRole("tab", { name: "Weekly digest" }).click();
    await expect(page.getByRole("tabpanel")).toContainText("only after a person approves it");
  });
}

test("approving a proposal records it and does not apply anything to an ad account", async ({ page }) => {
  await signIn(page, "admin@supportify.local");
  await page.goto("/autopilot?tab=actions");
  const approve = page.getByRole("button", { name: "Approve" }).first();
  test.skip((await approve.count()) === 0, "the seeded account produced no open proposal");
  await approve.click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Apply to ad account" })).toHaveCount(0); // applying is switched off and blocked
});

for (const email of ["manager@supportify.local", "rm@supportify.local", "finance@supportify.local"]) {
  test(`${email.split("@")[0]} cannot open Autopilot and has no link to it`, async ({ page }) => {
    await signIn(page, email);
    await page.goto("/autopilot");
    await expect(page).not.toHaveURL(/\/autopilot/);
    await expect(page.getByRole("link", { name: "Autopilot" })).toHaveCount(0);
  });
}

test("a signed-out visitor is sent to login", async ({ page }) => {
  await page.goto("/autopilot");
  await expect(page).toHaveURL(/\/login/);
});
