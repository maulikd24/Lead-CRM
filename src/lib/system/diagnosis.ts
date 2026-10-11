/**
 * The 14 "30-second diagnosis" questions of ADMIN_CONTROL_PLANE.md and how much of each the first slice answers (Wave 0 pack, 5.9).
 * Shown on the Health tab so an Admin can see where to look, and what is not built yet.
 */
export type Coverage = "full" | "partial" | "link" | "deferred";
export type DiagnosisItem = { n: number; question: string; coverage: Coverage; where: string; tab?: "health" | "jobs" | "failures" | "integrations"; href?: string };

export const DIAGNOSIS: readonly DiagnosisItem[] = [
  { n: 1, question: "Is the cron tick running?", coverage: "full", where: "Scheduler tile: heartbeat age, last tick, time used", tab: "health" },
  { n: 2, question: "Which job failed last, and why?", coverage: "full", where: "Jobs and Failures: error class and first and last seen", tab: "failures" },
  { n: 3, question: "Is WhatsApp receiving and sending?", coverage: "partial", where: "WhatsApp tile and Integrations: accounts, errors, last inbound, queue age (per-message delivery stays in Inbox)", tab: "integrations" },
  { n: 4, question: "Why did this lead not reach an RM?", coverage: "partial", where: "Failures: failed lead intakes and the intake webhooks (the event trail arrives with Wave 1)", tab: "failures" },
  { n: 5, question: "Why was this customer not nudged or sent a draft?", coverage: "deferred", where: "Needs the decision engine evidence drawer (Wave 2). Today: the nudger job and its flag in Jobs" },
  { n: 6, question: "Is any AI agent on, and what has it cost today?", coverage: "partial", where: "Jobs: nudger and sweeper last run and flag state (cost needs AgentRun, Wave 2)", tab: "jobs" },
  { n: 7, question: "Who approved or applied this?", coverage: "link", where: "Agent drafts and the Activity log", href: "/agents" },
  { n: 8, question: "Is consent being enforced, and for which purposes?", coverage: "full", where: "System status, Flags tab: CONSENT_ENFORCEMENT and the record-only purposes", href: "/settings/system/status?tab=flags" },
  { n: 9, question: "Are conversions reaching Meta or Google?", coverage: "deferred", where: "Wave 3: the conversion outbox plugs into Failures and Integrations" },
  { n: 10, question: "Is data fresh?", coverage: "full", where: "Data freshness tile: ad sync, back-office import, portfolio feed", tab: "health" },
  { n: 11, question: "Who can see this customer or campaign?", coverage: "link", where: "Who can see what", href: "/settings/access" },
  { n: 12, question: "What changed recently?", coverage: "partial", where: "Release tile and open alerts; the Activity log lists the last 24 hours", tab: "health" },
  { n: 13, question: "Is the audit chain intact?", coverage: "full", where: "Audit chain tile: last check and its result", tab: "health" },
  { n: 14, question: "Is something stuck?", coverage: "partial", where: "Failures: abandoned ticks, jobs not reached, agent drafts waiting, failed leads", tab: "failures" },
];

export function coverageCounts(): Record<Coverage, number> {
  const out: Record<Coverage, number> = { full: 0, partial: 0, link: 0, deferred: 0 };
  for (const d of DIAGNOSIS) out[d.coverage] += 1;
  return out;
}
