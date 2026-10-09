import { defineConfig } from "@playwright/test";

// A dedicated port so the suite never attaches to some other app already running on :3000.
// Set E2E_REUSE_SERVER=1 to deliberately reuse a server you started yourself on this port.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: BASE_URL },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 120_000,
    // .env pins NEXTAUTH_URL to :3000; auth must agree with the port the tests use.
    env: { NEXTAUTH_URL: BASE_URL, AUTH_URL: BASE_URL },
  },
});
