import { expect, test, type Page } from "@playwright/test";

/**
 * Control plane (first slice). Needs a build with NEXT_PUBLIC_CONTROL_PLANE=1 against a seeded local database
 * (admin@, manager@, rm@ from prisma/seed.ts; finance@ from the layout-budget seed). ADMIN only: every other role is sent home.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

test("an Admin sees the four tabs and can switch between them", async ({ page }) => {
  await signIn(page, "admin@supportify.local");
  await page.goto("/settings/control-plane");
  await expect(page.getByRole("heading", { name: "Control plane" })).toBeVisible();
  for (const name of ["Health", "Jobs", "Failures", "Integrations"]) await expect(page.getByRole("tab", { name })).toBeVisible();
  await page.getByRole("tab", { name: "Jobs" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Scheduled jobs");
  await page.getByRole("tab", { name: "Integrations" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Settings");
});

for (const email of ["manager@supportify.local", "rm@supportify.local", "finance@supportify.local"]) {
  test(`${email.split("@")[0]} cannot open the control plane and has no link to it`, async ({ page }) => {
    await signIn(page, email);
    await page.goto("/settings/control-plane");
    await expect(page).not.toHaveURL(/control-plane/);
    await expect(page.getByRole("link", { name: "Control plane" })).toHaveCount(0);
  });
}

test("a signed-out visitor is sent to login", async ({ page }) => {
  await page.goto("/settings/control-plane");
  await expect(page).toHaveURL(/\/login/);
});
