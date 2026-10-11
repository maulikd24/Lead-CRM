/**
 * Which jobs and webhook routes feed each integration, so its last success and last error come from JobRun rather than from a new
 * column on IntegrationConfig. Keys are the keys of the System status integration list (status.ts), the one list the page reuses.
 * `everyHours`: how often a feeding job should succeed (undefined = event-driven, no staleness rule). Names and paths only.
 */
export type IntegrationFeed = { jobs: string[]; everyHours?: number; settingsHref: string; note?: string };

export const INTEGRATION_FEEDS: Record<string, IntegrationFeed> = {
  freshdesk: { jobs: ["syncFreshdeskHistory", "webhook:provider"], settingsHref: "/settings/integrations" },
  exotel: { jobs: ["webhook:exotel-voice-callback", "checkStaleVoiceAnalysis"], settingsHref: "/settings/integrations" },
  clevertap: { jobs: ["clevertap-push"], settingsHref: "/settings/integrations", note: "Writes go to India-region CleverTap only" },
  clickup: { jobs: [], settingsHref: "/settings/integrations" },
  jira: { jobs: [], settingsHref: "/settings/integrations" },
  meta_ads: { jobs: ["meta-ads-sync"], everyHours: 6, settingsHref: "/settings/integrations" },
  google_ads: { jobs: ["google-ads-sync"], everyHours: 6, settingsHref: "/settings/integrations" },
  closed_loop_meta: { jobs: ["closed-loop-conversions"], everyHours: 1, settingsHref: "/settings/integrations", note: "Hashed, consented conversions only; region-gated, kill switch" },
  closed_loop_google: { jobs: ["closed-loop-conversions"], everyHours: 1, settingsHref: "/settings/integrations", note: "Hashed, consented conversions only; region-gated, kill switch" },
  whatsapp_meta: { jobs: ["checkWhatsAppAccountHealth", "sweepWhatsAppConversationReviews", "webhook:whatsapp-events", "webhook:whatsapp-outbox-result", "webhook:messaging"], settingsHref: "/settings/whatsapp" },
  sms_exotel: { jobs: [], settingsHref: "/settings/integrations" },
  resend_email: { jobs: ["sendDailyReportEmail", "sendWeeklyManagementReport", "sendMonthlyManagementReport"], settingsHref: "/settings/integrations" },
  sso: { jobs: [], settingsHref: "/settings/users" },
  ai_pilot_key: { jobs: ["agent-nudger", "extractConversationInsights"], settingsHref: "/settings/ai-pilot" },
  app_signup: { jobs: ["webhook:app-signup"], settingsHref: "/settings/system" },
  cron_trigger: { jobs: ["heartbeat"], everyHours: 0.25, settingsHref: "/settings/system" },
  push: { jobs: [], settingsHref: "/settings/account" },
  audit_anchor: { jobs: ["runDailyAuditChainCheck"], everyHours: 24, settingsHref: "/settings/system" },
};
