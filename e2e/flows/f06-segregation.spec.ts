import { expect, test } from "../support/fixtures";
import { openAndSettle } from "../support/redirect";

// F6: segregation, hand-written canaries (the generated matrix could hide a registry bug, these cannot).
// Marketing never sees customer or admin screens; the desk roles never see marketing; nobody below admin sees system settings.

const CANARIES: Record<string, { denied: string[]; home: string }> = {
  marketing: { denied: ["/clients", "/inbox", "/settings/users", "/dashboard", "/finance-console"], home: "/marketing" },
  manager: { denied: ["/marketing", "/settings/users", "/settings/system", "/finance-console"], home: "/clients" },
  rm: { denied: ["/marketing", "/settings/users", "/settings/system", "/reports", "/finance-console"], home: "/clients" },
  finance: { denied: ["/clients", "/marketing", "/settings/users"], home: "/finance-console" },
  partner: { denied: ["/clients", "/marketing", "/settings/users", "/finance-console"], home: "/partner-home" },
};

test("@critical segregation canaries", async ({ page }, info) => {
  const c = CANARIES[info.project.name];
  test.skip(!c, "no canaries for this role");
  for (const path of c.denied) {
    const { landedOn } = await openAndSettle(page, path);
    expect(landedOn, `${info.project.name} on ${path}`).toBe(c.home);
  }
  expect((await openAndSettle(page, c.home)).landedOn).toBe(c.home);
});

test("@critical marketing sees no customer or RM identities in the marketing workspace", async ({ page }, info) => {
  test.skip(info.project.name !== "marketing", "marketing only");
  await page.goto("/marketing");
  const body = await page.locator("body").innerText();
  for (const probe of ["E2E Client", "RM Raj", "RM Rita", "e2e.client", "9000100"]) expect(body, probe).not.toContain(probe);
});
