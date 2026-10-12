/** Feature switches for the Marketing module. Kept free of server-only imports so client code (the sidebar) can read them. */

/** The sync job runs only when this is exactly "1". Off by default. */
export function metaAdsSyncEnabled(): boolean {
  return process.env.META_ADS_SYNC_ENABLED === "1";
}

/** The /marketing page and its menu item show only when this build-time flag is exactly "1". Off by default. */
export function marketingPageEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_MARKETING === "1";
}

/** Google Ads reporting (the sync job and Google's place in the Marketing workspace) runs only when this is exactly "1". Off by default. */
export function googleAdsReportingEnabled(): boolean {
  return process.env.GOOGLE_ADS_REPORTING_ENABLED === "1";
}

/** The social post drafts calendar shows, and its actions work, only when this is exactly "1". Off by default. Nothing it holds is ever published automatically. */
export function socialDraftsEnabled(): boolean {
  return process.env.SOCIAL_DRAFTS_ENABLED === "1";
}
