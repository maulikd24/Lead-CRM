import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "rm@supportify.local";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

test("an RM can sign in and reach the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // Clients now lives under the collapsible "Work" sidebar category.
  await page.getByRole("button", { name: "Work" }).click();
  await expect(page.getByRole("link", { name: "Clients" })).toBeVisible();
});

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("defaults to the dark theme", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);
});
