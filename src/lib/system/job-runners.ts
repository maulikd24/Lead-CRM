/**
 * The functions behind the jobs an Admin may re-run by hand: exactly the jobs the registry marks `safeToRun` (idempotent by design). Loaded
 * lazily so the control plane page does not import every job. A test pins this list to the registry.
 */
export const JOB_RUNNERS: Record<string, () => Promise<unknown>> = {
  retryFailedLeads: async () => (await import("@/lib/leads/retry")).retryFailedLeads(),
  "merge-suggestions": async () => (await import("@/lib/identity/suggestion-job-db")).runMergeSuggestions(),
  refreshStaleIntelligence: async () => (await import("@/lib/intelligence/refresh")).refreshStaleIntelligence(),
  pruneSecurityTables: async () => (await import("@/lib/security/webhook-dedupe")).pruneSecurityTables(),
  pruneJobRuns: async () => (await import("./job-retention-db")).runPruneJobRuns(),
  runDailyAuditChainCheck: async () => (await import("@/lib/audit/verify-chain")).runDailyAuditChainCheck(),
  "meta-ads-sync": async () => (await import("@/lib/marketing/sync-meta")).syncMetaAds(),
  "google-ads-sync": async () => (await import("@/lib/marketing/sync-google")).syncGoogleAds(),
  "event-consumers": async () => (await import("@/lib/events/consumers-db")).runEventConsumers(),
  "data-health": async () => (await import("@/lib/data-health/job-db")).runDataHealth(),
  "ai-run-retention": async () => (await import("@/lib/ai/gateway/retention-wiring")).runAgentRunRetention(),
  "autopilot-daily-audit": async () => (await import("@/lib/autopilot/audit-db")).runDailyAuditJob(),
  "backoffice-import": async () => (await import("@/lib/backoffice-import/job")).runBackOfficeImport(),
};
