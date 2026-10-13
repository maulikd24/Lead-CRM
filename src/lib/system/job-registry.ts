/**
 * The single list of every scheduled job and every inbound webhook route the control plane records. Prisma-free.
 *
 * Keys are the names the cron tick already passes to runJob("..."), unchanged (the access policy and the Go-Live page key on them),
 * so the camelCase/kebab-case mix stays; `label` is the human name. job-registry.test.ts fails if the tick runs a key that is not
 * here, or this list has a cron job the tick never runs.
 *
 * `safeToRun` means "idempotent by design: running it twice does no harm", and is the ONLY thing that lets an Admin re-run a failed
 * job from the Failures tab. Every job that can send a message or an email is false.
 */
export type Cadence =
  | { every: "tick" }
  | { every: "day" }
  | { every: "week" }
  | { every: "month" }
  | { everyHours: number }
  | { onEvent: true };

export type JobKind = "CRON" | "WEBHOOK";

export type JobSpec = {
  key: string;
  label: string;
  owner: string;
  cadence: Cadence;
  /** Typical upper bound. A run longer than 3x this is reported as TIMEOUT (reported, never enforced: the job is not cancelled). */
  expectedMaxMs: number;
  /** An environment flag that must be exactly "1" for the job to do anything; a run while it is off is recorded as SKIPPED "flag off". */
  flag?: string;
  safeToRun: boolean;
  kind: JobKind;
};

const MIN = 60_000;
const cron = (key: string, label: string, owner: string, cadence: Cadence, expectedMaxMs: number, extra: { flag?: string; safeToRun?: boolean } = {}): JobSpec => ({
  key, label, owner, cadence, expectedMaxMs, flag: extra.flag, safeToRun: extra.safeToRun ?? false, kind: "CRON",
});
const hook = (key: string, label: string, owner: string): JobSpec => ({ key, label, owner, cadence: { onEvent: true }, expectedMaxMs: 10_000, safeToRun: false, kind: "WEBHOOK" });

const TICK: Cadence = { every: "tick" };

export const CRON_JOBS: readonly JobSpec[] = [
  cron("heartbeat", "Scheduler heartbeat", "System", TICK, 2_000),
  cron("checkOverdueTasks", "Mark overdue tasks", "Tasks", TICK, 20_000),
  cron("checkStageSla", "Stage SLA warnings", "Pipeline", TICK, 30_000),
  cron("checkFundingSla", "Funding SLA follow-ups", "Pipeline", TICK, 30_000),
  cron("processDueJourneySteps", "Advance journey steps", "Journeys", TICK, 40_000),
  cron("checkDisengagement", "Flag disengaged clients", "Co-pilot", TICK, 30_000),
  cron("checkWhatsAppAccountHealth", "WhatsApp account health", "WhatsApp", TICK, 10_000),
  cron("sendDailyReportEmail", "Daily leads report email", "Reports", { every: "day" }, 30_000),
  cron("sendWeeklyManagementReport", "Weekly management report", "Reports", { every: "week" }, 30_000),
  cron("sendMonthlyManagementReport", "Monthly management report", "Reports", { every: "month" }, 30_000),
  cron("seedBaselineStages", "Seed onboarding stages", "System", TICK, 5_000),
  cron("seedSystemActor", "Seed system actor", "System", TICK, 5_000),
  cron("backfillCompletedClientsToFinalStage", "Backfill completed clients", "Pipeline", TICK, 20_000),
  cron("checkStaleVoiceAnalysis", "Stale call analysis", "Calls", TICK, 10_000),
  cron("sweepWhatsAppConversationReviews", "Sweep WhatsApp reviews", "Quality audit", TICK, 60_000),
  // Quality audit findings: deterministic detectors over stored commitments and complaints, then the AI pass over recent stored conversations
  // (skipped without an Anthropic key). Writes audit findings only; sends nothing. Off unless QUALITY_AUDIT_ENABLED=1.
  cron("quality-audit", "Quality audit findings", "Quality audit", TICK, 150_000, { flag: "QUALITY_AUDIT_ENABLED" }),
  cron("checkKycDropOffs", "KYC drop-off nudges", "Pipeline", TICK, 20_000),
  cron("syncFreshdeskHistory", "Freshdesk history sync", "Support", TICK, 30_000),
  cron("extractConversationInsights", "Conversation insights", "Intelligence", TICK, 60_000),
  cron("refreshStaleIntelligence", "Refresh customer intelligence", "Intelligence", TICK, 60_000, { safeToRun: true }),
  cron("clevertap-push", "CleverTap push", "CleverTap", TICK, 30_000, { flag: "CLEVERTAP_PUSH_ENABLED" }),
  cron("retryFailedLeads", "Retry failed leads", "Leads", TICK, 30_000, { safeToRun: true }),
  cron("pruneSecurityTables", "Prune security tables", "Security", TICK, 15_000, { safeToRun: true }),
  cron("runDailyAuditChainCheck", "Audit chain check and backup", "Audit", { every: "day" }, 60_000, { safeToRun: true }),
  cron("agent-nudger", "WhatsApp nudger (drafts only)", "Agents", TICK, 90_000, { flag: "AGENT_NUDGER_ENABLED" }),
  cron("agent-sweeper", "Free stuck agent drafts", "Agents", TICK, 15_000, { flag: "AGENT_NUDGER_ENABLED" }),
  cron("merge-suggestions", "Duplicate suggestions", "Identity", TICK, 60_000, { flag: "MERGE_SUGGESTIONS_ENABLED", safeToRun: true }),
  cron("meta-ads-sync", "Meta ad-spend sync", "Marketing", { everyHours: 6 }, 60_000, { flag: "META_ADS_SYNC_ENABLED", safeToRun: true }),
  cron("backoffice-import", "Back-office import", "Back office", { every: "day" }, 60_000, { flag: "BACKOFFICE_IMPORT_ENABLED", safeToRun: true }),
  cron("google-ads-sync", "Google Ads sync", "Marketing", { everyHours: 6 }, 60_000, { flag: "GOOGLE_ADS_REPORTING_ENABLED", safeToRun: true }),
  cron("referral-progress", "Referral progress", "Referrals", TICK, 30_000, { flag: "REFERRAL_PROGRAM_ENABLED" }),
  // Campaign attribution (Wave 3): marks leads a person reached and escalates the ones past their speed-to-lead SLA to the manager. Notifies staff and creates a task, so a hand re-run is not offered (it is idempotent per lead, but it pings phones).
  cron("lead-push-sweep", "Lead push sweep", "Attribution", TICK, 20_000, { flag: "NEXT_PUBLIC_ATTRIBUTION" }),
  // Closed-loop conversions: queues consented, hashed conversion events and sends what is due to the enabled ad destinations. It sends data to a third party, so a hand re-run is not offered; every step is idempotent per (destination, event) and the kill switch stops it.
  cron("closed-loop-conversions", "Closed-loop conversions", "Marketing", TICK, 60_000, { flag: "CLOSED_LOOP_CONVERSIONS_ENABLED" }),
  // Autopilot (Wave 3): the daily ad audit PROPOSES only (it has no ad-account access) and is idempotent per issue, so an Admin may re-run it. The weekly digest notifies people in the app and writes a DRAFT email; it is not offered for hand re-run.
  cron("autopilot-daily-audit", "Autopilot daily audit", "Marketing", { every: "day" }, 120_000, { flag: "AUTOPILOT_DAILY_AUDIT_ENABLED", safeToRun: true }),
  cron("autopilot-weekly-digest", "Autopilot weekly digest", "Marketing", { every: "week" }, 60_000, { flag: "AUTOPILOT_DIGEST_ENABLED" }),
  // Director reports: every tick it checks whether this Monday's digest is due (one per week), then prepares an in-app notice and a DRAFT email for a person to approve. It never sends anything, but it notifies staff, so a hand re-run is not offered (the week is unique, a repeat is a no-op).
  cron("director-digest", "Weekly marketing digest (draft)", "Marketing", TICK, 60_000, { flag: "DIRECTOR_REPORTS_ENABLED" }),
  // Campaign planner: re-checks every registered destination (pattern, and one HEAD request for a public https web page). Contacts no customer and changes no plan.
  cron("planner-destination-health", "Planner destination health", "Marketing", { everyHours: 6 }, 60_000, { flag: "NEXT_PUBLIC_PLANNER" }),
  // Customer events: cursor consumers and the data-health sweep. Both are idempotent by design and do nothing unless CUSTOMER_EVENTS_ENABLED=1.
  cron("event-consumers", "Customer event consumers", "Events", TICK, 60_000, { flag: "CUSTOMER_EVENTS_ENABLED", safeToRun: true }),
  cron("data-health", "Data health checks", "Events", { everyHours: 1 }, 60_000, { flag: "CUSTOMER_EVENTS_ENABLED", safeToRun: true }),
  // Added by the control plane itself.
  cron("pruneJobRuns", "Prune job run history", "Control plane", TICK, 15_000, { safeToRun: true }),
  cron("evaluateAlerts", "Evaluate alert rules", "Control plane", TICK, 10_000),
  // Added by the AI gateway (Wave 1): folds expired AgentRun rows into daily totals and deletes them. Idempotent (one transaction per batch).
  cron("ai-run-retention", "AI run retention", "AI gateway", TICK, 15_000, { safeToRun: true }),
  // Added by the Wave 2 integration. Memory extraction reads conversations through the AI gateway (it spends money), so it is never re-run by hand; the expiry sweep and the decision retention are idempotent.
  cron("memory-extraction", "Customer memory extraction (drafts)", "Customer memory", TICK, 60_000, { flag: "MEMORY_EXTRACTION_ENABLED" }),
  cron("memory-expiry-sweep", "Customer memory expiry sweep", "Customer memory", { everyHours: 6 }, 20_000, { flag: "NEXT_PUBLIC_MEMORY", safeToRun: true }),
  cron("nba-decision-retention", "Decision shadow retention", "Decision engine", { everyHours: 24 }, 20_000, { flag: "NBA_ENGINE_V2", safeToRun: true }),
];

export const WEBHOOK_JOBS: readonly JobSpec[] = [
  hook("webhook:provider", "Provider webhooks", "Integrations"),
  hook("webhook:app-signup", "App sign-up webhook", "Referrals"),
  hook("webhook:messaging", "Messaging channel webhooks", "Messaging"),
  hook("webhook:meta-leads", "Meta lead-form webhook", "Leads"),
  hook("webhook:whatsapp-events", "WhatsApp worker events", "WhatsApp"),
  hook("webhook:whatsapp-outbox", "WhatsApp outbox poll", "WhatsApp"),
  hook("webhook:whatsapp-outbox-result", "WhatsApp outbox result", "WhatsApp"),
  hook("webhook:exotel-voice-callback", "Voice analysis callback", "Calls"),
  hook("webhook:leads-web", "Website lead form", "Leads"),
  hook("webhook:leads-google-ads", "Google Ads lead webhook", "Leads"),
  hook("webhook:portfolio-ingest", "Portfolio feed ingest", "Portfolio"),
];

export const JOBS: readonly JobSpec[] = [...CRON_JOBS, ...WEBHOOK_JOBS];

/** Row key of the per-tick summary row. Not a job: it is the envelope that groups one tick's rows. */
export const TICK_KEY = "__tick";

export const jobSpec = (key: string): JobSpec | undefined => JOBS.find((j) => j.key === key);

const HOUR = 3_600_000;
/** How often a job is expected to run (0 for event-driven webhooks). */
export function expectedIntervalMs(cadence: Cadence): number {
  if ("every" in cadence) return cadence.every === "tick" ? 5 * MIN : cadence.every === "day" ? 24 * HOUR : cadence.every === "week" ? 7 * 24 * HOUR : 31 * 24 * HOUR;
  if ("everyHours" in cadence) return cadence.everyHours * HOUR;
  return 0;
}

export function describeCadence(cadence: Cadence): string {
  if ("every" in cadence) return cadence.every === "tick" ? "Every tick (5 min)" : cadence.every === "day" ? "Daily" : cadence.every === "week" ? "Weekly" : "Monthly";
  if ("everyHours" in cadence) return `Every ${cadence.everyHours} h`;
  return "On request";
}
