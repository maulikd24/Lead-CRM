import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

import { ROLE_KEYS } from "./e2e/support/roles";

// A dedicated port so the suite never attaches to some other app already running on :3000.
// Set E2E_PORT to use another port (for example when several worktrees share a machine).
// Set E2E_REUSE_SERVER=1 to deliberately reuse a server you started yourself on this port.
//
// E2E_SERVER=dev    (default) boots `npm run dev`: convenient locally, slower, flags come from your .env.
// E2E_SERVER=start  boots `next start` on an already BUILT app (CI, and the fast local run): build first with
//                   `npm run ci:build:on`. Runtime flags come from E2E_FLAGS (default: ci/flags-all-on.env).
// E2E_AXE=1 adds the accessibility project (nightly). See docs/ci.md.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const START = (process.env.E2E_SERVER ?? "dev") === "start";

function flagEnv(): Record<string, string> {
  const file = START ? (process.env.E2E_FLAGS ?? "ci/flags-all-on.env") : process.env.E2E_FLAGS;
  if (!file) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

const authFile = (role: string) => `e2e/.auth/${role}.json`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? (process.env.CI ? 2 : 3)),
  retries: process.env.CI ? 1 : 0,
  timeout: START ? 30_000 : 90_000, // a cold dev server compiles each route on first hit
  expect: { timeout: START ? 7_500 : 45_000 },
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [
    // Signed-out: the original smoke tests and the sign-in flow (it signs in through the real form, once per role).
    { name: "public", testMatch: [/smoke\.spec\.ts/, /flows\/f01-.*\.spec\.ts/] },
    // One project per role, each starting from that role's saved session (made by global-setup through the real /login form).
    ...ROLE_KEYS.map((role) => ({
      name: role,
      testMatch: [/access-matrix\.spec\.ts/, /flows\/f0[36]-.*\.spec\.ts/],
      use: { storageState: authFile(role) },
    })),
    ...(process.env.E2E_AXE === "1"
      ? ROLE_KEYS.map((role) => ({ name: `axe-${role}`, testMatch: [/axe\.spec\.ts/, /axe-attribution\.spec\.ts/, /axe-closedloop\.spec\.ts/], use: { storageState: authFile(role) } }))
      : []),
  ],
  webServer: {
    command: START ? `npx next start -p ${PORT}` : `npm run dev -- -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 120_000,
    // .env pins NEXTAUTH_URL to :3000; auth must agree with the port the tests use.
    env: { NEXTAUTH_URL: BASE_URL, AUTH_URL: BASE_URL, AUTH_TRUST_HOST: "true", ...flagEnv() },
  },
});
