import { expect, test as base } from "@playwright/test";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * `test` with one extra guarantee: nothing the app does in the browser may reach outside this machine. A request to any
 * other host fails the test, so a flow can never quietly send, post or call an external service (CI has no credentials
 * and no outbound path; "approve nothing external").
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const external: string[] = [];
    page.on("request", (req) => {
      const u = new URL(req.url());
      if ((u.protocol === "http:" || u.protocol === "https:") && !LOCAL.has(u.hostname)) external.push(`${req.method()} ${u.origin}`);
    });
    await use(page);
    expect(external, "the page tried to reach a non-local host").toEqual([]);
  },
});

export { expect };
