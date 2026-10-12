import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "rm@supportify.local";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

test("an RM can sign in and reach the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // A cold dev server compiles the dashboard on first hit, which can take longer than the default 5s.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 45_000 });
  // The first visit starts a guided tour (a dialog that blocks clicks, and expands every sidebar group). Dismiss it.
  const tour = page.getByRole("dialog");
  if (await tour.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) {
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();
  }
  // Clients lives under the collapsible "Work" sidebar category; open it only if it is closed.
  const clients = page.getByRole("link", { name: "Clients" });
  if (!(await clients.isVisible())) await page.getByRole("button", { name: "Work" }).click();
  await expect(clients).toBeVisible();
});

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("defaults to the dark theme", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);
});
