/** Feature switches for the Marketing module. Kept free of server-only imports so client code (the sidebar) can read them. */

/** The sync job runs only when this is exactly "1". Off by default. */
export function metaAdsSyncEnabled(): boolean {
  return process.env.META_ADS_SYNC_ENABLED === "1";
}

/** The /marketing page and its menu item show only when this build-time flag is exactly "1". Off by default. */
export function marketingPageEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_MARKETING === "1";
}
