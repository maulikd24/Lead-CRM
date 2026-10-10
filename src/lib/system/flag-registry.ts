/**
 * Every on/off flag the platform reads, in one list, so the Admin status page can say which are on without anyone typing a
 * name twice. docs/feature-flags.md is the human table; flag-registry.test.ts fails if a documented flag is missing here.
 * A flag is on only for the exact value "1". NEXT_PUBLIC_* flags are inlined at build time, so changing one needs a new deployment.
 * Names only: no secret and no URL ever belongs in this file.
 */
export type FlagDef = { name: string; buildTime: boolean; label: string };

const f = (name: string, label: string): FlagDef => ({ name, buildTime: name.startsWith("NEXT_PUBLIC_"), label });

export const FLAGS: FlagDef[] = [
  f("NEXT_PUBLIC_NAV_V2", "Primary navigation only"),
  f("NEXT_PUBLIC_HOME_V2", "Today home"),
  f("NEXT_PUBLIC_MOTION", "Animated dashboards"),
  f("NEXT_PUBLIC_CLEVERTAP_CARD", "App and campaigns card"),
  f("NEXT_PUBLIC_C360", "Customer 360"),
  f("NEXT_PUBLIC_OUTCOMES", "Goals and outcomes"),
  f("NEXT_PUBLIC_CALLS_REVIEW", "Call recordings review"),
  f("NEXT_PUBLIC_CONSENT", "Consent screens"),
  f("NEXT_PUBLIC_MERGE_REVIEW", "Duplicate review"),
  f("NEXT_PUBLIC_SUPPORT_SLA", "Support deadlines"),
  f("NEXT_PUBLIC_INSIGHTS", "Insights"),
  f("NEXT_PUBLIC_MARKETING", "Marketing workspace"),
  f("PARTNER_WORKSPACE_ENABLED", "Partner workspace"),
  f("PARTNER_ALLOW_SAMPLE", "Sample partner data in production"),
  f("REFERRAL_PROGRAM_ENABLED", "Referral programme"),
  f("BACKOFFICE_IMPORT_ENABLED", "Back-office import"),
  f("PORTFOLIO_FEED_ENABLED", "Portfolio feed ingest"),
  f("SOCIAL_DRAFTS_ENABLED", "Draft social posts"),
  f("META_ADS_SYNC_ENABLED", "Meta ad-spend sync"),
  f("GOOGLE_ADS_REPORTING_ENABLED", "Google Ads reporting sync"),
  f("AGENT_NUDGER_ENABLED", "WhatsApp nudger"),
  f("WA_ASSIST_ENABLED", "Reply assistant"),
  f("WA_ASSIST_AUTO", "Reply assistant auto-draft"),
  f("WA_META_WINDOW", "24-hour WhatsApp window"),
  f("OUTCOMES_DRAFTS_ENABLED", "Outcome check-in drafts"),
  f("MERGE_SUGGESTIONS_ENABLED", "Duplicate suggestion job"),
  f("CONSENT_ENFORCEMENT", "Consent enforcement"),
  f("APP_USER_ID_LINKING", "App user id matching"),
  f("CLEVERTAP_PUSH_ENABLED", "CleverTap writes"),
  f("FRESHDESK_HANDOFF_ENABLED", "Support hand-off ingest"),
  f("SSO_ENABLED", "Single sign-on"),
  f("SSO_ONLY", "Single sign-on only"),
];

/** Values that are safe to show (never a secret): lists, hours, zones, names of models. */
export const SETTINGS: { name: string; label: string }[] = [
  { name: "CONSENT_RECORD_ONLY_PURPOSES", label: "Consent purposes recorded but not enforced" },
  { name: "SOCIAL_TIMEZONE", label: "Social post time zone" },
  { name: "BACKOFFICE_IMPORT_HOUR_UTC", label: "Back-office import hour (UTC)" },
  { name: "META_ADS_SYNC_EVERY_HOURS", label: "Meta sync interval (hours)" },
  { name: "GOOGLE_ADS_SYNC_EVERY_HOURS", label: "Google sync interval (hours)" },
  { name: "PARTNER_SOURCE", label: "Partner data source" },
  { name: "AI_PROVIDER", label: "AI provider" },
  { name: "AGENT_MODEL", label: "AI model" },
];

export const flagIsOn = (env: Record<string, string | undefined>, name: string): boolean => env[name] === "1";
