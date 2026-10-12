import { condCreds } from "./cond";
import { REGISTRY, byName } from "./registry";
import type { ProfileDef, ProfileName } from "./types";

/**
 * The five named profiles, as data. A profile is the only place a combination of flags is written down; a deploy uses a
 * generated template (docs/profiles/<name>.env) as its starting point. Values are "1" for on, and safe placeholders for the
 * few plain settings a combination needs. Never a secret: credentials are listed as commented empty placeholders.
 *
 * `values`  names that exist in code today (an active line in the template).
 * `planned` names that arrive with a branch not yet merged (a commented line, still validated together with `values`).
 * `needsApproval` flags that run only after an owner approval (live messaging, the consent decision): always commented.
 */

export const PROFILE_NAMES = ["demo", "pilot", "go-live", "marketing-only", "all-on"] as const satisfies readonly ProfileName[];

const one = (...names: string[]): Record<string, string> => Object.fromEntries(names.map((n) => [n, "1"]));

const SAMPLE_LINK_BASE = "https://example.com/r";
const SAMPLE_IMPORT_DIR = "/var/lib/crm/import";
const SAMPLE_BREAK_GLASS = "admin@example.com";

export const PROFILES: Record<ProfileName, ProfileDef> = {
  demo: {
    name: "demo",
    purpose: "The demo on a laptop: every screen on, no network side effects.",
    values: {
      ...one(
        "NEXT_PUBLIC_NAV_V2", "NEXT_PUBLIC_HOME_V2", "NEXT_PUBLIC_MOTION", "NEXT_PUBLIC_C360", "NEXT_PUBLIC_OUTCOMES", "NEXT_PUBLIC_CALLS_REVIEW", "NEXT_PUBLIC_CONSENT",
        "NEXT_PUBLIC_MERGE_REVIEW", "NEXT_PUBLIC_SUPPORT_SLA", "NEXT_PUBLIC_INSIGHTS", "NEXT_PUBLIC_MARKETING", "NEXT_PUBLIC_CLEVERTAP_CARD", "NEXT_PUBLIC_AUTOPILOT",
        "NEXT_PUBLIC_LANDING",
        "PARTNER_WORKSPACE_ENABLED", "REFERRAL_PROGRAM_ENABLED", "SOCIAL_DRAFTS_ENABLED", "MERGE_SUGGESTIONS_ENABLED", "CONSENT_ENFORCEMENT", "APPROVALS_INBOX_ENABLED",
      "NEXT_PUBLIC_ATTRIBUTION", "NEXT_PUBLIC_CREATIVE_INTEL", "NEXT_PUBLIC_PLANNER", "DIRECTOR_REPORTS_ENABLED", "CLOSED_LOOP_CONVERSIONS_ENABLED", "CLOSED_LOOP_DEMO", ),
      REFERRAL_LINK_BASE: SAMPLE_LINK_BASE,
    },
    planned: one("DEMO_MODE", "NEXT_PUBLIC_DEMO_MODE", "NEXT_PUBLIC_KANBAN"),
    needsApproval: [],
    notes: "Off on purpose: every real outbound flag (CleverTap writes, the nudger, reply auto-draft) and the blocked Autopilot apply switch. Closed-loop runs only against its fake destination. AI answers come from the local stand-in that DEMO_MODE provides.",
  },
  pilot: {
    name: "pilot",
    purpose: "Real data, a small named group of RMs, drafts only.",
    values: one(
      "NEXT_PUBLIC_NAV_V2", "NEXT_PUBLIC_HOME_V2", "NEXT_PUBLIC_C360", "NEXT_PUBLIC_OUTCOMES", "NEXT_PUBLIC_CALLS_REVIEW", "NEXT_PUBLIC_CONSENT", "NEXT_PUBLIC_MERGE_REVIEW",
      "NEXT_PUBLIC_SUPPORT_SLA", "NEXT_PUBLIC_CONTROL_PLANE", "CONSENT_ENFORCEMENT", "WA_ASSIST_ENABLED", "MERGE_SUGGESTIONS_ENABLED", "WA_META_WINDOW",
    ),
    planned: {},
    needsApproval: [],
    notes: "The reply assistant needs a recorded AI pilot sign-off and the person on the pilot list (Settings, AI pilot). Marketing, partner, referral and outbound push are off.",
  },
  "go-live": {
    name: "go-live",
    purpose: "The whole firm, real customers.",
    values: {
      ...one(
        "NEXT_PUBLIC_NAV_V2", "NEXT_PUBLIC_HOME_V2", "NEXT_PUBLIC_C360", "NEXT_PUBLIC_OUTCOMES", "NEXT_PUBLIC_CALLS_REVIEW", "NEXT_PUBLIC_CONSENT", "NEXT_PUBLIC_MERGE_REVIEW",
        "NEXT_PUBLIC_SUPPORT_SLA", "CONSENT_ENFORCEMENT", "WA_ASSIST_ENABLED", "MERGE_SUGGESTIONS_ENABLED", "WA_META_WINDOW",
        "NEXT_PUBLIC_MARKETING", "NEXT_PUBLIC_INSIGHTS", "NEXT_PUBLIC_MOTION", "NEXT_PUBLIC_CONTROL_PLANE", "PARTNER_WORKSPACE_ENABLED", "REFERRAL_PROGRAM_ENABLED", "BACKOFFICE_IMPORT_ENABLED",
        "PORTFOLIO_FEED_ENABLED", "SSO_ENABLED", "SSO_ONLY", "META_ADS_SYNC_ENABLED", "GOOGLE_ADS_REPORTING_ENABLED", "FRESHDESK_HANDOFF_ENABLED", "APP_USER_ID_LINKING",
        "CLEVERTAP_PUSH_ENABLED", "AGENT_NUDGER_ENABLED", "NEXT_PUBLIC_PLANNER",
      "NEXT_PUBLIC_ATTRIBUTION", "CLOSED_LOOP_CONVERSIONS_ENABLED", "LEAD_ALERTS_GCHAT_ENABLED", ),
      REFERRAL_LINK_BASE: SAMPLE_LINK_BASE,
      BACKOFFICE_IMPORT_DIR: SAMPLE_IMPORT_DIR,
      SSO_BREAK_GLASS_EMAILS: SAMPLE_BREAK_GLASS,
    },
    planned: one(),
    needsApproval: ["CLEVERTAP_PUSH_ENABLED", "AGENT_NUDGER_ENABLED", "CLOSED_LOOP_CONVERSIONS_ENABLED", "LEAD_ALERTS_GCHAT_ENABLED"],
    notes: "Live messaging (CleverTap writes, the nudger), closed-loop conversions and Google Chat lead alerts are left commented out: each runs only after the owner's approval. The sample paths and addresses are placeholders.",
  },
  "marketing-only": {
    name: "marketing-only",
    purpose: "The marketing hire's environment: marketing surfaces on, nothing customer-facing for RMs.",
    values: { ...one("NEXT_PUBLIC_MARKETING", "SOCIAL_DRAFTS_ENABLED", "META_ADS_SYNC_ENABLED", "GOOGLE_ADS_REPORTING_ENABLED", "NEXT_PUBLIC_CONSENT", "CONSENT_ENFORCEMENT", "NEXT_PUBLIC_AUTOPILOT", "AUTOPILOT_DAILY_AUDIT_ENABLED", "NEXT_PUBLIC_PLANNER", "PLANNER_AI_COPY_ENABLED", "NEXT_PUBLIC_ATTRIBUTION", "NEXT_PUBLIC_CREATIVE_INTEL", "DIRECTOR_REPORTS_ENABLED", ) },
    planned: one(),
    needsApproval: [],
    notes: "RM-side feature flags are off. Attribution shows no Customer 360 journey tab on purpose (a warning, not an error). Autopilot is read-only.",
  },
  "all-on": {
    name: "all-on",
    purpose: "CI and layout-budget runs only; never deployed.",
    values: {
      ...one(
        "NEXT_PUBLIC_NAV_V2", "NEXT_PUBLIC_HOME_V2", "NEXT_PUBLIC_MOTION", "NEXT_PUBLIC_CLEVERTAP_CARD", "NEXT_PUBLIC_C360", "NEXT_PUBLIC_OUTCOMES", "NEXT_PUBLIC_CALLS_REVIEW",
        "NEXT_PUBLIC_CONSENT", "NEXT_PUBLIC_MERGE_REVIEW", "NEXT_PUBLIC_SUPPORT_SLA", "NEXT_PUBLIC_INSIGHTS", "NEXT_PUBLIC_MARKETING", "NEXT_PUBLIC_CONTROL_PLANE", "NEXT_PUBLIC_PRODUCT_REGISTRY", "NEXT_PUBLIC_ATTENTION_ENGINE", "NEXT_PUBLIC_SIMULATE", "NEXT_PUBLIC_DECISION_DRAWER", "NBA_ENGINE_V2", "NBA_RM_VISIBLE", "NEXT_PUBLIC_ACTION_LEDGER", "NEXT_PUBLIC_ACTION_LEDGER_INVESTIGATE",
        "PARTNER_WORKSPACE_ENABLED", "REFERRAL_PROGRAM_ENABLED", "BACKOFFICE_IMPORT_ENABLED", "PORTFOLIO_FEED_ENABLED", "SOCIAL_DRAFTS_ENABLED", "META_ADS_SYNC_ENABLED",
        "GOOGLE_ADS_REPORTING_ENABLED", "MERGE_SUGGESTIONS_ENABLED", "APP_USER_ID_LINKING", "FRESHDESK_HANDOFF_ENABLED", "SSO_ENABLED", "CONSENT_ENFORCEMENT", "WA_META_WINDOW",
        "AGENT_NUDGER_ENABLED", "WA_ASSIST_ENABLED", "WA_ASSIST_AUTO", "OUTCOMES_DRAFTS_ENABLED", "AI_AGENTS_ENABLED", "CLEVERTAP_PUSH_ENABLED", "AI_ADMIN_TAB",
        "APPROVALS_INBOX_ENABLED", "APPROVALS_WT_AGENT_PROPOSAL", "APPROVALS_WT_LEAD_PUSH_DRAFT", "APPROVALS_WT_SOCIAL_POST", "APPROVALS_WT_REFERRAL_STATEMENT", "APPROVALS_WT_MERGE_SUGGESTION", "APPROVALS_WT_AI_PILOT_SIGNOFF", "APPROVALS_WT_PRODUCT_REGISTRY", "APPROVALS_WT_AUTOPILOT_ACTION", "NEXT_PUBLIC_AUTOPILOT", "AUTOPILOT_ASK_ENABLED", "AUTOPILOT_DAILY_AUDIT_ENABLED", "AUTOPILOT_DIGEST_ENABLED", "APPROVALS_WT_AD_CREATIVE", "APPROVALS_WT_DIRECTOR_REPORT", "CUSTOMER_EVENTS_ENABLED", "CUSTOMER_TIMELINE_V2", "JOURNEYS_ENABLED", "VOC_ENABLED", "RELATIONSHIP_REGISTRY_ERASURE", "RELATIONSHIP_REGISTRY_MERGE", "NEXT_PUBLIC_MEMORY", "NEXT_PUBLIC_SERVICE_STATE", "HOUSEHOLD_INTELLIGENCE_ENABLED", "MEMORY_EXTRACTION_ENABLED", "APPROVALS_WT_PLANNER_PLAN", "NEXT_PUBLIC_PLANNER", "PLANNER_AI_COPY_ENABLED",
      "NEXT_PUBLIC_ATTRIBUTION", "NEXT_PUBLIC_CREATIVE_INTEL", "DIRECTOR_REPORTS_ENABLED", "LEAD_PUSH_DRAFTS_ENABLED", "CLOSED_LOOP_CONVERSIONS_ENABLED", "GOOGLE_SIGNIN_ENABLED", "NEXT_PUBLIC_LANDING", ),
      REFERRAL_LINK_BASE: SAMPLE_LINK_BASE,
      BACKOFFICE_IMPORT_DIR: SAMPLE_IMPORT_DIR,
    },
    planned: one("NEXT_PUBLIC_KANBAN"),
    needsApproval: [],
    notes: "Every feature flag on, with consent enforcement. Off on purpose: demo mode, the closed-loop fake destination, sample partner data, SSO_ONLY and the blocked Autopilot apply switch. Outbound flags are on only because CI injects fakes and holds no keys and no network; it is validated with assumeCredentials and never deployed.",
  },
};

export const profileEnv = (name: ProfileName, opts: { includePlanned?: boolean } = {}): Record<string, string> => ({ ...PROFILES[name].values, ...(opts.includePlanned ? PROFILES[name].planned : {}) });

/** The credentials a profile's flags need (names only): what an operator must supply before booting it for real. */
export function credentialsNeeded(name: ProfileName): string[] {
  const env = profileEnv(name, { includePlanned: true });
  const out = new Set<string>();
  for (const def of REGISTRY) {
    const active = def.type === "bool" ? env[def.name] === "1" : false;
    if (!active) continue;
    for (const r of def.requires) if (r.severity === "error") for (const c of condCreds(r.cond)) out.add(c);
  }
  for (const def of REGISTRY) for (const r of def.requiresAlways) for (const c of condCreds(r.cond)) out.add(c);
  return [...out].sort();
}

/** The generated .env template for a profile: names and safe values only. */
export function renderProfileEnv(name: ProfileName): string {
  const p = PROFILES[name];
  const order = (n: string) => REGISTRY.findIndex((f) => f.name === n);
  const sorted = (names: string[]) => [...names].sort((a, b) => order(a) - order(b));
  const lines: string[] = [
    `# Profile: ${p.name} - ${p.purpose}`,
    "# Generated by npm run flags:docs from src/lib/flags/profiles.ts. Do not edit by hand: change the profile and regenerate.",
    "# Names and safe values only. A flag is on only for the exact value 1. NEXT_PUBLIC_* names are set at BUILD time (a change needs a rebuild).",
    `# ${p.notes}`,
    "",
  ];
  for (const n of sorted(Object.keys(p.values).filter((k) => !p.needsApproval.includes(k)))) lines.push(`${n}=${p.values[n]}`);
  const planned = sorted(Object.keys(p.planned).filter((k) => !p.needsApproval.includes(k)));
  if (planned.length) {
    lines.push("", "# Planned: these names arrive with a branch that is not merged yet. Uncomment them when it lands.");
    for (const n of planned) lines.push(`# ${n}=${p.planned[n]}`);
  }
  if (p.needsApproval.length) {
    lines.push("", "# Needs approval: left off until the owner approves each one (live customer messaging, the consent decision).");
    for (const n of sorted(p.needsApproval)) lines.push(`# ${n}=${(p.values[n] ?? p.planned[n]) as string}  (${byName(n)?.approval ?? "approval required"})`);
  }
  const creds = credentialsNeeded(name);
  if (creds.length) {
    lines.push("", "# Credentials this profile needs. Set real values in the host's secret store; never commit them.");
    for (const c of creds) lines.push(/^[A-Z0-9_]+$/.test(c) ? `# ${c}=` : `# one of: ${c.replace(/ or /, ", ")} (the one for AI_PROVIDER)`);
  }
  return lines.join("\n") + "\n";
}
