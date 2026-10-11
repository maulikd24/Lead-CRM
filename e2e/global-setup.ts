import { mkdirSync } from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";

import { PASSWORD, ROLES, ROLE_KEYS } from "./support/roles";

/** Signs every role in once through the real /login form (no auth bypass) and saves the session for its project. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3100";
  mkdirSync("e2e/.auth", { recursive: true });
  // The server is up here only when webServer has started it (playwright starts it before globalSetup).
  const browser = await chromium.launch();
  try {
    for (const key of ROLE_KEYS) {
      const ctx = await browser.newContext({ baseURL });
      const page = await ctx.newPage();
      await page.goto("/login", { timeout: 120_000 });
      await page.getByLabel("Email").fill(ROLES[key].email);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
      await ctx.storageState({ path: `e2e/.auth/${key}.json` });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}
