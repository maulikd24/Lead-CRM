import { landingFor } from "../../src/lib/policy/workspace";
import { expect, test } from "../support/fixtures";
import { openAndSettle } from "../support/redirect";
import { ROLES, type RoleKey } from "../support/roles";

// A signed-in person never sees the landing page: "/" sends each role to its own landing screen, exactly as before the front door.
test("@critical signed-in people go straight to their own landing screen from the root", async ({ page }, info) => {
  const key = info.project.name as RoleKey;
  test.skip(!(key in ROLES), "role projects only");
  const { landedOn } = await openAndSettle(page, "/");
  expect(landedOn).toBe(landingFor(ROLES[key].role));
  await expect(page.getByRole("heading", { level: 1, name: /Know every customer/ })).toHaveCount(0);
});

test("@critical a signed-in person who opens /login still gets the sign-in page (nothing changes)", async ({ page }, info) => {
  test.skip(!(info.project.name in ROLES), "role projects only");
  const res = await page.goto("/login");
  expect(res?.status()).toBe(200);
});
