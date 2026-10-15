import { landingFor } from "../../src/lib/policy/workspace";
import { expect, test } from "../support/fixtures";
import { PASSWORD, ROLES, ROLE_KEYS } from "../support/roles";

// F1: sign-in and landing per role, sign-out, a generic error for a wrong password, signed-out deep links go to login.
// (The credentials form always lands on the role's own home. A deep link is not preserved across a password sign-in; only
// the single-sign-on path carries a callback, so this suite asserts the real behaviour rather than a return trip.)

for (const key of ROLE_KEYS) {
  test(`@critical ${key} signs in, lands on their home and signs out`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ROLES[key].email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`${landingFor(ROLES[key].role)}$`));
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(landingFor(ROLES[key].role));
    await expect(page).toHaveURL(/\/login/);
  });
}

test("@critical a wrong password shows one generic message and stays on the sign-in page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ROLES.rm.email);
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  // the same message for an address that does not exist: nothing reveals which part was wrong
  await page.getByLabel("Email").fill("nobody@example.invalid");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});

test("@critical signed-out visitors are sent to sign-in from any inner page", async ({ page }) => {
  for (const path of ["/clients", "/dashboard", "/marketing", "/settings/users", "/finance-console", "/partner-home"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login/);
  }
});

test("single sign-on is off by default: the password form is shown", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});
