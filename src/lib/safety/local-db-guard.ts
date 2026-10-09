const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
// The pg driver prefers these query parameters over the URL's own host, so they can redirect the connection.
const HOST_OVERRIDE_PARAMS = new Set(["host", "hostaddr", "service"]);

/** Seed and load-test scripts create fake people. They must never run against a real database. */
export function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is not set");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  for (const key of parsed.searchParams.keys()) {
    if (HOST_OVERRIDE_PARAMS.has(key.toLowerCase())) {
      throw new Error(`Refusing to run: unsupported "${key}" parameter in DATABASE_URL (could point at a non-local database)`);
    }
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) throw new Error("Refusing to run against a non-local database (no host in DATABASE_URL)");
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to run against a non-local database (${host})`);
}
