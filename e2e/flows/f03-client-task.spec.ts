import { expect, test } from "../support/fixtures";

// F3: an RM opens a customer and adds a task; a manager sees the customer. Runs in the rm and manager projects.
// "Approve nothing external": the task form has an "Also create in ClickUp" box that is never ticked here, and the shared
// fixture fails the test if the page reaches any non-local host.

test("@critical RM opens an assigned customer and adds a task", async ({ page }, info) => {
  test.skip(info.project.name !== "rm", "RM flow");
  await page.goto("/clients");
  await page.getByRole("link", { name: /E2E Client 01/ }).first().click();
  // A plain click opens the quick view; "Open full profile" goes to the record.
  await page.getByRole("link", { name: "Open full profile" }).click();
  await expect(page).toHaveURL(/\/clients\/[^/?]+/);
  await expect(page.getByRole("heading", { name: /E2E Client 01/ }).first()).toBeVisible();

  const title = `E2E follow-up ${Date.now()}`;
  await page.goto(`${new URL(page.url()).pathname}?tab=tasks`);
  await page.getByLabel("New task").fill(title);
  await page.getByLabel("Due").fill("2031-01-15T10:00");
  // The duplicate is fixed (a PhoneSheet's form mounts once, see workspace/sheet.tsx); the visible filter is kept only as a guard.
  const clickUp = page.getByLabel("Also create in ClickUp").filter({ visible: true });
  await expect(clickUp).not.toBeChecked();
  await page.getByRole("button", { name: "Add Task" }).click();
  await expect(page.getByText(title).first()).toBeVisible();

  // the task is on the RM's own list too
  await page.goto("/tasks");
  await expect(page.getByText(title).first()).toBeVisible();
});

test("@critical a manager can open a customer of their team", async ({ page }, info) => {
  test.skip(info.project.name !== "manager", "manager flow");
  await page.goto("/clients");
  const link = page.getByRole("link", { name: /E2E Client 01/ }).first();
  await expect(link).toBeVisible();
  await link.click();
  // A plain click opens the quick view; "Open full profile" goes to the record.
  await expect(page.getByRole("link", { name: "Open full profile" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Open full profile" }).click();
  await expect(page).toHaveURL(/\/clients\/[^/?]+/);
});
