import type { Cond, DataClass, Effects, FlagDef, Kind, Requirement, RuleId, ValueType } from "./types";

/**
 * THE flag registry: every environment name the platform reads, in one typed list (single source of truth).
 * docs/feature-flags.md, docs/profiles/*.env, the startup check, the CI check and the Admin Flags tab are all generated
 * from, or checked against, this file. A name that is read in code but missing here fails `npm run flags:check`.
 *
 * Rules of the file:
 * - Names only. No secret value, host, key or internal name belongs here, because the output is published.
 * - A flag is on only for the exact value "1". Nothing here changes a flag's behaviour or default; the registry
 *   describes what the code already does, and `validate.ts` reports combinations that the code allows but should not run.
 * - NEXT_PUBLIC_* names are inlined at build time: changing one needs a rebuild.
 * - Names that arrive with a branch not yet merged are marked `inFlight` with the branch; the code scan does not expect them.
 */

const NO_EFFECTS: Effects = { outbound: false, vendorSharing: false, ai: false, pii: false };

// ---- condition and requirement shorthands -----------------------------------------------------------------------------
const on = (name: string): Cond => ({ on: name });
const not = (c: Cond): Cond => ({ not: c });
const set = (name: string): Cond => ({ set: name });
const cred = (name: string): Cond => ({ cred: name });
const eq = (name: string, value: string): Cond => ({ eq: name, value });
const anyOf = (...c: Cond[]): Cond => ({ anyOf: c });
const allOf = (...c: Cond[]): Cond => ({ allOf: c });
const PROD: Cond = { prod: true };
const AI_KEY: Cond = { aiKey: true };

const req = (rule: RuleId, cond: Cond, message: string, fix: string, extra: Partial<Requirement> = {}): Requirement => ({ rule, cond, severity: "error", message, fix, ...extra });
const soft = (cond: Cond, message: string, fix: string, strictError = false): Requirement => req("FR-20", cond, message, fix, { severity: "warn", strictError });

/** FR-10: an outbound or vendor-sharing flag needs consent enforcement and the consent ledger screens. */
const consentGate = (rule: RuleId = "FR-10"): Requirement[] => [
  req(rule, on("CONSENT_ENFORCEMENT"), "Outbound needs consent enforcement: CONSENT_ENFORCEMENT is not 1, so nothing checks consent before this runs.", "Set CONSENT_ENFORCEMENT=1, or turn this flag off."),
  req(rule, on("NEXT_PUBLIC_CONSENT"), "The consent ledger must be visible so that a wrong entry can be fixed: NEXT_PUBLIC_CONSENT is not 1.", "Set NEXT_PUBLIC_CONSENT=1 (build-time, needs a rebuild), or turn this flag off."),
];
/** FR-12: an AI feature needs the provider's key (or the demo stand-in). The recorded sign-off is a separate informational warning. */
const aiGate = (): Requirement[] => [req("FR-12", AI_KEY, "This uses an AI provider and no key is present for the selected AI_PROVIDER.", "Save the provider key for AI_PROVIDER (default anthropic) in the environment, or turn this flag off.")];

type Fx = Partial<Effects>;
type Extra = Partial<Omit<FlagDef, "name" | "kind" | "type" | "exposure" | "owner" | "label" | "enables">> & { fx?: Fx; data?: DataClass };

function def(name: string, kind: Kind, type: ValueType, owner: string, label: string, enables: string, extra: Extra = {}): FlagDef {
  const { fx, data, ...rest } = extra as Extra;
  return {
    name,
    exposure: name.startsWith("NEXT_PUBLIC_") ? "public" : "server",
    kind,
    type,
    default: null,
    owner,
    label,
    enables,
    dataClass: data ?? (kind === "secret" ? "credential" : kind === "config" || kind === "platform" || kind === "test" ? "config" : "none"),
    effects: { ...NO_EFFECTS, ...fx },
    requires: [],
    conflictsWith: [],
    requiresAlways: [],
    since: "base",
    process: "app",
    ...rest,
  };
}

const feature = (name: string, owner: string, label: string, enables: string, extra: Extra = {}) => def(name, "feature", "bool", owner, label, enables, extra);
const safety = (name: string, owner: string, label: string, enables: string, extra: Extra = {}) => def(name, "safety", "bool", owner, label, enables, extra);
const outbound = (name: string, owner: string, label: string, enables: string, extra: Extra = {}) => def(name, "outbound", "bool", owner, label, enables, { fx: { outbound: true, vendorSharing: true, pii: true }, data: "customer-pii", ...extra });
const outboundAi = (name: string, owner: string, label: string, enables: string, extra: Extra = {}) =>
  def(name, "outbound-ai", "bool", owner, label, enables, { fx: { outbound: true, vendorSharing: true, ai: true, pii: true }, data: "customer-pii", requiresAiSignoff: true, ...extra });
const config = (name: string, type: ValueType, owner: string, label: string, enables: string, extra: Extra = {}) => def(name, "config", type, owner, label, enables, extra);
const secret = (name: string, label: string, enables: string, extra: Extra = {}) => def(name, "secret", "secret", "platform", label, enables, extra);
const platform = (name: string, label: string, enables: string, extra: Extra = {}) => def(name, "platform", "string", "platform", label, enables, extra);
const testSwitch = (name: string, owner: string, enables: string, extra: Extra = {}) =>
  def(name, "test", "bool", owner, `${owner} database tests`, enables, { process: "tooling", conflictsWith: [req("FR-04", { dbNonLocal: true }, "An opt-in database test is on while DATABASE_URL points at a hosted database; these tests refuse to run there.", "Point DATABASE_URL at a local scratch database, or unset this switch.")], ...extra });

const IN_FLIGHT = (branch: string): Extra => ({ inFlight: branch, since: branch });

const MARKETING_GATE = (strict: boolean): Requirement => soft(on("NEXT_PUBLIC_MARKETING"), "This screen is reached through the marketing workspace and NEXT_PUBLIC_MARKETING is not 1, so nobody can open it.", "Set NEXT_PUBLIC_MARKETING=1 (build-time), or turn this flag off.", strict);
const C360_GATE: Requirement = soft(on("NEXT_PUBLIC_C360"), "This renders inside Customer 360 and NEXT_PUBLIC_C360 is not 1, so it has nowhere to show.", "Set NEXT_PUBLIC_C360=1 (build-time), or turn this flag off.");

// ---- Screens and features: build-time (NEXT_PUBLIC_*) ----------------------------------------------------------------
const PUBLIC: FlagDef[] = [
  feature("NEXT_PUBLIC_NAV_V2", "nav", "Primary navigation only", "Sidebar shows the role's primary items only; the rest through Cmd+K and Settings."),
  feature("NEXT_PUBLIC_HOME_V2", "home", "Today home", "The Today home for Admin, Manager and RM.", { accessArea: "dashboard" }),
  feature("NEXT_PUBLIC_MOTION", "ui", "Animated dashboards", "Animated dashboard components and the live-counts route (static versions when off).", { accessArea: "dashboard" }),
  feature("NEXT_PUBLIC_CLEVERTAP_CARD", "clevertap", "App and campaigns card", "The read-only App and campaigns card on the customer page.", { accessArea: "client-360", data: "customer-pii", requires: [C360_GATE] }),
  feature("NEXT_PUBLIC_C360", "customer360", "Customer 360", "The Customer 360 page /clients/[id]/360.", { accessArea: "client-360", data: "customer-pii", fx: { pii: true } }),
  feature("NEXT_PUBLIC_OUTCOMES", "outcomes", "Goals and outcomes", "The Goals and outcomes tab on Customer 360 and Needs attention on Today and the dashboard.", { accessArea: "outcomes", data: "customer-pii", requires: [C360_GATE] }),
  feature("NEXT_PUBLIC_CALLS_REVIEW", "calls", "Call recordings review", "Call recordings review /calls and the recording proxy.", { accessArea: "calls", data: "customer-pii", fx: { pii: true } }),
  feature("NEXT_PUBLIC_CONSENT", "consent", "Consent screens", "Consent ledger screens: customer panel, /settings/consent and the admin export.", { accessArea: "settings-data-privacy", data: "customer-pii", fx: { pii: true } }),
  feature("NEXT_PUBLIC_MERGE_REVIEW", "dedup", "Duplicate review", "Duplicate review /clients/duplicates and its actions.", {
    accessArea: "duplicates",
    data: "customer-pii",
    requires: [soft(on("MERGE_SUGGESTIONS_ENABLED"), "Duplicate review will show an empty queue because the suggestion job (MERGE_SUGGESTIONS_ENABLED) is not on.", "Set MERGE_SUGGESTIONS_ENABLED=1, or leave the screen off.")],
  }),
  feature("NEXT_PUBLIC_SUPPORT_SLA", "support", "Support deadlines", "The Support SLA view /support.", { accessArea: "support" }),
  feature("NEXT_PUBLIC_INSIGHTS", "insights", "Insights", "The agent insights page /agents/insights.", { accessArea: "agent-insights" }),
  feature("NEXT_PUBLIC_MARKETING", "marketing", "Marketing workspace", "The /marketing workspace (campaigns, reports, digests) for the marketing role.", { accessArea: "marketing", data: "pseudonymous" }),
  // in flight
  feature("NEXT_PUBLIC_ATTRIBUTION", "attribution", "Lead journey and campaign impact", "The Journey tab, Campaign impact, lead push and speed-to-lead sweep and the Lead leakage page.", {
    ...IN_FLIGHT("attribution"),
    accessArea: "marketing-attribution",
    data: "pseudonymous",
    requires: [C360_GATE, MARKETING_GATE(false)],
  }),
  feature("NEXT_PUBLIC_AUTOPILOT", "autopilot", "Autopilot", "Autopilot audit, scorecard and launch drafts (read-only: applying changes is blocked).", {
    ...IN_FLIGHT("autopilot"),
    accessArea: "marketing-autopilot",
    data: "pseudonymous",
    requires: [MARKETING_GATE(true), soft(anyOf(on("META_ADS_SYNC_ENABLED"), on("GOOGLE_ADS_REPORTING_ENABLED")), "Autopilot has no ad data to read: neither META_ADS_SYNC_ENABLED nor GOOGLE_ADS_REPORTING_ENABLED is on.", "Turn on an ad sync flag, or leave Autopilot off.")],
  }),
  feature("NEXT_PUBLIC_CREATIVE_INTEL", "creative", "Creative intelligence", "The Insights, Briefs, Experiments and Competitors tabs, the annexure and the creative drafter (AI).", {
    ...IN_FLIGHT("creative"),
    accessArea: "marketing-creative",
    data: "pseudonymous",
    fx: { ai: true },
    requiresAiSignoff: true,
    requires: [MARKETING_GATE(false), ...aiGate()],
  }),
  feature("NEXT_PUBLIC_PLANNER", "planner", "Campaign planner", "The campaign planner: audiences, promises, destinations, plan board, tracked links, copy drafts, routing rules and calendar.", { accessArea: "marketing-planner", data: "pseudonymous", requires: [MARKETING_GATE(true)] }),
  feature("PLANNER_AI_COPY_ENABLED", "planner", "Planner AI copy drafts", "Draft-only AI copy for a campaign plan (the planner_copy agent, through the AI gateway). A person reviews every draft.", {
    accessArea: "marketing-planner",
    data: "pseudonymous",
    fx: { ai: true },
    requires: [MARKETING_GATE(true), req("FR-20", on("NEXT_PUBLIC_PLANNER"), "AI copy drafts are written inside the planner and NEXT_PUBLIC_PLANNER is not 1, so nobody can ask for one.", "Set NEXT_PUBLIC_PLANNER=1 (build-time), or turn this flag off.", { severity: "warn" }), ...aiGate()],
    requiresAgentSetting: ["planner_copy"],
  }),
  feature("NEXT_PUBLIC_KANBAN", "elevate", "Leads pipeline board", "The leads pipeline board.", { ...IN_FLIGHT("elevate"), accessArea: "clients", data: "customer-pii" }),
  feature("NEXT_PUBLIC_DEMO_MODE", "demo", "Demo indicator", "The demo indicator in the UI (the build-time twin of DEMO_MODE).", {
    ...IN_FLIGHT("demo"),
    requires: [req("FR-13", on("DEMO_MODE"), "NEXT_PUBLIC_DEMO_MODE is on but DEMO_MODE is not: the banner would claim a demo the server is not running.", "Set DEMO_MODE=1 as well, or unset NEXT_PUBLIC_DEMO_MODE.")],
    conflictsWith: [req("FR-13", PROD, "The demo indicator is on in a production environment.", "Unset NEXT_PUBLIC_DEMO_MODE and rebuild.")],
  }),
  feature("NEXT_PUBLIC_CONTROL_PLANE", "control-plane", "Control plane", "The admin control plane: health, jobs, failures and integrations.", { accessArea: "control-plane" }),
];

/** One write-through switch per approval adapter over a legacy table: with it on, a decision made in the Approvals inbox also leaves a canonical record (who, when, why, correlation chain). The legacy row stays authoritative. */
const approvalsWriteThrough = (rows: [string, string][]): FlagDef[] =>
  rows.map(([name, what]) =>
    feature(name, "approvals", `Approvals write-through: ${what}`, `Also records a canonical approval row for each ${what} decision made in the Approvals inbox (reason, approver, correlation and causation ids). The legacy record stays authoritative and is never changed by it.`, {
      data: "internal",
      requires: [soft(on("APPROVALS_INBOX_ENABLED"), "Write-through only records decisions made in the Approvals inbox, and APPROVALS_INBOX_ENABLED is not 1, so nothing will be recorded.", "Set APPROVALS_INBOX_ENABLED=1, or leave this off.")],
    }),
  );

// ---- Server features --------------------------------------------------------------------------------------------------
const SERVER_FEATURES: FlagDef[] = [
  feature("PARTNER_WORKSPACE_ENABLED", "partners", "Partner workspace", "Partner workspace /partners, Partner finance settings and the partner first touch recorded by the lead intake (404 and no writes when off).", { accessArea: "partner-workspace", data: "customer-pii" }),
  safety("PARTNER_ALLOW_SAMPLE", "partners", "Sample partner data in production", "Allows the made-up sample partner source in production.", {
    requires: [req("FR-03", eq("PARTNER_SOURCE", "sample"), "PARTNER_ALLOW_SAMPLE only matters with PARTNER_SOURCE=sample.", "Set PARTNER_SOURCE=sample for a demo, or unset PARTNER_ALLOW_SAMPLE.")],
    conflictsWith: [req("FR-14", PROD, "Sample partner data is allowed in a production environment.", "Unset PARTNER_ALLOW_SAMPLE.")],
  }),
  feature("REFERRAL_PROGRAM_ENABLED", "referrals", "Referral programme", "The customer referral programme /referrals, the signup hook and the progress job.", {
    accessArea: "referral-program",
    data: "customer-pii",
    requires: [
      req("FR-16", set("REFERRAL_LINK_BASE"), "The referral programme needs REFERRAL_LINK_BASE (the https address for the share link); without it no link is made.", "Set REFERRAL_LINK_BASE to the public https address."),
      req("FR-16", cred("APP_SIGNUP_SECRET"), "The referral programme needs APP_SIGNUP_SECRET for the signup hook.", "Set APP_SIGNUP_SECRET."),
    ],
  }),
  feature("BACKOFFICE_IMPORT_ENABLED", "backoffice-import", "Back-office import", "The back-office importer: settings page, uploads and the nightly job.", {
    accessArea: "settings-backoffice-import",
    data: "customer-pii",
    requires: [req("FR-16", set("BACKOFFICE_IMPORT_DIR"), "The importer needs BACKOFFICE_IMPORT_DIR (the drop folder).", "Set BACKOFFICE_IMPORT_DIR to the drop folder path.")],
  }),
  feature("PORTFOLIO_FEED_ENABLED", "portfolio", "Portfolio feed ingest", "The portfolio ingest endpoint (404 while off or without a secret).", {
    data: "customer-pii",
    requires: [req("FR-16", cred("PORTFOLIO_FEED_SECRET"), "The portfolio feed needs PORTFOLIO_FEED_SECRET to verify the signed feed.", "Set PORTFOLIO_FEED_SECRET.")],
  }),
  feature("SOCIAL_DRAFTS_ENABLED", "marketing", "Draft social posts", "Draft-only social posts and the zone times are shown in (the social_drafter agent).", {
    accessArea: "marketing-social",
    data: "pseudonymous",
    fx: { ai: true },
    requires: [MARKETING_GATE(true)],
    requiresAgentSetting: ["social_drafter"],
  }),
  feature("META_ADS_SYNC_ENABLED", "ads", "Meta ad-spend sync", "A read-only ad-spend sync job from Meta (credentials come from the integration settings).", { data: "internal", fx: { vendorSharing: false } }),
  feature("GOOGLE_ADS_REPORTING_ENABLED", "ads", "Google Ads reporting sync", "A read-only Google Ads reporting sync job (credentials come from the integration settings).", { data: "internal" }),
  feature("APPROVALS_INBOX_ENABLED", "approvals", "Approvals inbox", "The unified Approvals inbox /approvals: every approval waiting for the signed-in person, from every approval path. Each decision calls the existing path through its adapter; nothing is approved automatically.", { accessArea: "approvals", data: "customer-pii" }),
  ...approvalsWriteThrough([
    ["APPROVALS_WT_AGENT_PROPOSAL", "agent drafts"],
    ["APPROVALS_WT_LEAD_PUSH_DRAFT", "new lead first messages"],
    ["APPROVALS_WT_SOCIAL_POST", "social posts"],
    ["APPROVALS_WT_PLANNER_PLAN", "campaign plans"],
    ["APPROVALS_WT_REFERRAL_STATEMENT", "referral statements"],
    ["APPROVALS_WT_MERGE_SUGGESTION", "duplicate merges"],
    ["APPROVALS_WT_AI_PILOT_SIGNOFF", "AI pilot sign-off"],
  ]),
  feature("MERGE_SUGGESTIONS_ENABLED", "dedup", "Duplicate suggestion job", "The job that scores and stores duplicate-customer suggestions.", { data: "customer-pii" }),
  feature("CUSTOMER_EVENTS_ENABLED", "events", "Customer events", "The customer event fact layer: dual-write from the main domain paths, the cursor consumers and the data-health sweep in the cron tick (nothing is written or consumed while off).", { data: "customer-pii", fx: { pii: true } }),
  feature("CUSTOMER_TIMELINE_V2", "events", "Canonical customer timeline", "Customer 360 and the AI client summary read the one canonical timeline (domain tables plus customer events) instead of their own loaders.", { accessArea: "client-360", data: "customer-pii", fx: { pii: true }, requires: [C360_GATE] }),
  feature("RELATIONSHIP_REGISTRY_ERASURE", "events", "Erasure from the relationship registry", "Client erasure runs its steps from the relationship registry instead of the original hand-written list (same steps, same order, same messages).", { accessArea: "settings-data-privacy", data: "customer-pii", fx: { pii: true } }),
  feature("RELATIONSHIP_REGISTRY_MERGE", "events", "Merge from the relationship registry", "Duplicate-customer merge re-points rows from the relationship registry instead of the original hand-written list (same tables, same conflicts).", { accessArea: "duplicates", data: "customer-pii", fx: { pii: true } }),
  feature("APP_USER_ID_LINKING", "identity", "App user id matching", "Matches CleverTap events by app user id; merges re-point the signup ledger.", {
    data: "customer-pii",
    fx: { pii: true },
    requires: [req("FR-16", cred("APP_SIGNUP_SECRET"), "App user id matching needs APP_SIGNUP_SECRET.", "Set APP_SIGNUP_SECRET.")],
  }),
  feature("FRESHDESK_HANDOFF_ENABLED", "freshdesk", "Support hand-off ingest", "Support hand-off ticket ingest from Freshdesk (credentials come from the integration settings).", { data: "customer-pii" }),
  feature("SSO_ENABLED", "auth", "Single sign-on", "Keycloak sign-in.", {
    requires: ["KEYCLOAK_ISSUER", "KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT_SECRET"].map((n) => req("FR-15", cred(n), `Single sign-on needs ${n}.`, `Set ${n}.`)),
  }),
  safety("SSO_ONLY", "auth", "Single sign-on only", "Hides the password form so everyone signs in through single sign-on.", {
    requires: [
      req("FR-15", on("SSO_ENABLED"), "SSO_ONLY hides the password form but SSO_ENABLED is not 1: nobody could sign in.", "Set SSO_ENABLED=1, or unset SSO_ONLY."),
      req("FR-15", set("SSO_BREAK_GLASS_EMAILS"), "SSO_ONLY without a break-glass list leaves no way in if single sign-on is down.", "Set SSO_BREAK_GLASS_EMAILS to the people who may still use a password."),
    ],
  }),
  feature("AI_ADMIN_TAB", "ai-gateway", "AI tab on System status", "Shows the Admin-only AI tab on System status: runs by agent and purpose, cost against budget, failure and abstain rates, the agent registry with autonomy levels and kill switches.", { accessArea: "settings-ai" }),
  safety("AI_KILL_SWITCH", "ai-gateway", "AI kill switch (all model calls)", "When 1, the AI gateway refuses every model call before anything is sent. Unlike most flags, ON here means AI is OFF.", { data: "customer-pii", fx: { ai: true } }),
  safety("WA_META_WINDOW", "whatsapp", "24-hour WhatsApp window", "Enforces the 24-hour customer-service window for WhatsApp replies."),
  safety("CONSENT_ENFORCEMENT", "consent", "Consent enforcement", "The consent gate in the nudger, CleverTap push, ingest, reply assist, outcomes and referral drafts.", {
    data: "customer-pii",
    fx: { pii: true },
    requires: [soft(on("NEXT_PUBLIC_CONSENT"), "Consent is enforced but the consent screens are off, so a wrong entry cannot be fixed.", "Set NEXT_PUBLIC_CONSENT=1 (build-time).")],
  }),
  def("PUSH_DRY_RUN", "safety", "bool", "push", "Push dry run", "Logs a push message instead of sending it (local checks without a Firebase project).", {
    conflictsWith: [req("FR-04", PROD, "Push dry run is on in a production environment: no push message is sent.", "Unset PUSH_DRY_RUN and set the Firebase service account.", { severity: "warn" })],
  }),
];

// ---- Outbound and AI-adjacent ------------------------------------------------------------------------------------------
const OUTBOUND: FlagDef[] = [
  outboundAi("AGENT_NUDGER_ENABLED", "agents", "WhatsApp nudger", "The draft-only WhatsApp nudger job.", {
    requires: [...consentGate(), ...aiGate()],
    requiresAgentSetting: ["wa_nudger"],
    approval: "Live customer messaging: a person approves before it runs for real customers.",
    accessArea: "agent-drafts",
  }),
  outboundAi("WA_ASSIST_ENABLED", "agents", "Reply assistant", "Suggested replies and handover detection in the inbox.", {
    requires: [...consentGate(), ...aiGate()],
    requiresAgentSetting: ["wa_reply"],
    accessArea: "inbox",
  }),
  outboundAi("WA_ASSIST_AUTO", "agents", "Reply assistant auto-draft", "Drafts a reply automatically when a conversation is opened.", {
    requires: [req("FR-03", on("WA_ASSIST_ENABLED"), "Auto-draft needs the reply assistant: WA_ASSIST_ENABLED is not 1.", "Set WA_ASSIST_ENABLED=1, or unset WA_ASSIST_AUTO."), ...consentGate(), ...aiGate()],
    accessArea: "inbox",
  }),
  outboundAi("OUTCOMES_DRAFTS_ENABLED", "outcomes", "Outcome check-in drafts", "Draft check-in messages from the outcomes screens.", {
    requires: [req("FR-03", on("NEXT_PUBLIC_OUTCOMES"), "Outcome drafts start from the outcomes screens: NEXT_PUBLIC_OUTCOMES is not 1.", "Set NEXT_PUBLIC_OUTCOMES=1 (build-time)."), ...consentGate(), ...aiGate()],
    requiresAgentSetting: ["outcomes_review"],
    accessArea: "outcomes",
  }),
  outboundAi("AI_AGENTS_ENABLED", "intelligence", "AI next actions", "Assigns next best actions to the AI Bot and serves /api/agent/work (changes who owns a customer's next step).", {
    requires: [...consentGate(), ...aiGate(), req("FR-16", cred("AGENT_API_KEY"), "The agent API needs AGENT_API_KEY.", "Set AGENT_API_KEY.")],
    accessArea: "intelligence",
  }),
  outboundAi("LEAD_PUSH_DRAFTS_ENABLED", "attribution", "Lead first-message drafts", "A suggested first message for a new lead (a draft, never sent).", {
    ...IN_FLIGHT("attribution"),
    requires: [req("FR-03", on("NEXT_PUBLIC_ATTRIBUTION"), "Lead drafts start from the attribution screens: NEXT_PUBLIC_ATTRIBUTION is not 1.", "Set NEXT_PUBLIC_ATTRIBUTION=1 (build-time)."), ...consentGate(), ...aiGate()],
    requiresAgentSetting: ["lead_first_message"],
  }),
  outbound("CLEVERTAP_PUSH_ENABLED", "clevertap", "CleverTap writes", "Writes to CleverTap (India region only).", {
    requires: [...consentGate()],
    approval: "Live customer messaging: a person approves before it runs for real customers.",
  }),
  outbound("CLOSED_LOOP_CONVERSIONS_ENABLED", "closedloop", "Closed-loop conversions", "Queues and sends hashed, consented conversions to Meta and Google.", {
    ...IN_FLIGHT("closedloop"),
    approval: "Consent decision: the owner approves the ads-measurement consent wording and the destination regions.",
    demoStandIn: "CLOSED_LOOP_DEMO",
    requires: [
      ...consentGate("FR-11"),
      req("FR-11", not({ listHas: "CONSENT_RECORD_ONLY_PURPOSES", value: "ADS_MEASUREMENT" }), "ADS_MEASUREMENT is in CONSENT_RECORD_ONLY_PURPOSES: consent would be stored but not enforced for ad conversions.", "Remove ADS_MEASUREMENT from CONSENT_RECORD_ONLY_PURPOSES."),
      req("FR-11", on("CLOSED_LOOP_DEMO"), "A live destination credential and an approved region are checked at run time from the integration settings; this check cannot read them.", "Confirm in Settings, Integrations that the destination is saved and its region approved, or use CLOSED_LOOP_DEMO=1 for the fake destination.", { severity: "warn" }),
    ],
    conflictsWith: [],
  }),
];

// ---- Safety and blocked, in flight ------------------------------------------------------------------------------------
const SAFETY_IN_FLIGHT: FlagDef[] = [
  def("AUTOPILOT_APPLY_ENABLED", "blocked", "bool", "autopilot", "Apply ad changes", "Would apply ad changes through the platform APIs.", {
    ...IN_FLIGHT("autopilot"),
    blockedReason: "Standing NOT-YET: autonomous ad-spend changes are not allowed. The registry rejects =1 in every profile and every environment.",
    fx: { vendorSharing: true },
    data: "internal",
  }),
  feature("AUTOPILOT_ASK_ENABLED", "autopilot", "Autopilot ask-the-account", "The ask-the-account AI path in Autopilot.", {
    ...IN_FLIGHT("autopilot"),
    fx: { ai: true },
    requiresAiSignoff: true,
    requires: [req("FR-03", on("NEXT_PUBLIC_AUTOPILOT"), "The ask path lives inside Autopilot: NEXT_PUBLIC_AUTOPILOT is not 1.", "Set NEXT_PUBLIC_AUTOPILOT=1 (build-time)."), ...aiGate()],
  }),
  safety("CLOSED_LOOP_KILL_SWITCH", "closedloop", "Closed-loop kill switch", "Stops every conversion send.", IN_FLIGHT("closedloop")),
  safety("CLOSED_LOOP_DEMO", "closedloop", "Closed-loop fake destination", "A fake, no-network conversion destination.", {
    ...IN_FLIGHT("closedloop"),
    conflictsWith: [req("FR-13", PROD, "The fake conversion destination is on in a production environment.", "Unset CLOSED_LOOP_DEMO.")],
  }),
  feature("DIRECTOR_REPORTS_ENABLED", "creative", "Director reports", "The Reports tab, shareable links /shared/report/[token] and the weekly digest job (a draft).", {
    ...IN_FLIGHT("creative"),
    accessArea: "marketing-reports",
    data: "pseudonymous",
    requires: [MARKETING_GATE(true)],
  }),
  safety("DEMO_MODE", "demo", "Demo mode", "A local AI stand-in, a network guard and the demo seed: nothing leaves the machine.", {
    ...IN_FLIGHT("demo"),
    requires: [req("FR-13", { matches: "DEMO_MODE", twin: "NEXT_PUBLIC_DEMO_MODE" }, "DEMO_MODE and its build-time twin NEXT_PUBLIC_DEMO_MODE disagree.", "Set both to 1 (and rebuild), or neither.")],
    conflictsWith: [
      req("FR-13", on("CLEVERTAP_PUSH_ENABLED"), "No live outbound under demo: CLEVERTAP_PUSH_ENABLED is on.", "Unset CLEVERTAP_PUSH_ENABLED, or leave demo mode."),
      req("FR-13", on("AGENT_NUDGER_ENABLED"), "No live outbound under demo: AGENT_NUDGER_ENABLED is on.", "Unset AGENT_NUDGER_ENABLED, or leave demo mode."),
      req("FR-13", on("WA_ASSIST_AUTO"), "No live outbound under demo: WA_ASSIST_AUTO is on.", "Unset WA_ASSIST_AUTO, or leave demo mode."),
      req("FR-13", PROD, "Demo mode is on in a production environment.", "Unset DEMO_MODE."),
      req("FR-13", { dbNonLocal: true }, "Demo mode is on and DATABASE_URL does not point at this machine.", "Use a local demo database, or leave demo mode."),
      req("FR-13", allOf(on("CLOSED_LOOP_CONVERSIONS_ENABLED"), not(on("CLOSED_LOOP_DEMO"))), "Closed-loop conversions are allowed under demo only with the fake destination: CLOSED_LOOP_DEMO is not 1.", "Set CLOSED_LOOP_DEMO=1, or unset CLOSED_LOOP_CONVERSIONS_ENABLED."),
    ],
  }),
];

// ---- Config values ----------------------------------------------------------------------------------------------------
const CONFIG: FlagDef[] = [
  config("AI_PROVIDER", "enum", "ai", "AI provider", "Which provider the agents use.", { options: ["anthropic", "openai", "fake"], default: "anthropic", safeToShow: true }),
  config("AI_PURPOSE_BUDGETS_USD", "list", "ai-gateway", "AI daily budgets per purpose (USD)", "Daily hard cap per gateway purpose, as purpose=usd pairs, for example summary.page=5,ask.intelligence=10. A purpose with no budget is refused in production.", { safeToShow: true }),
  config("AI_BUDGET_DEFAULT_USD", "string", "ai-gateway", "AI default daily budget (USD)", "Daily hard cap for every purpose without its own entry in AI_PURPOSE_BUDGETS_USD. Unset means refused in production, allowed with a warning elsewhere.", { safeToShow: true }),
  config("AI_RUN_RETENTION_DAYS", "int", "ai-gateway", "AI run detail retention (days)", "How long AgentRun detail rows are kept before the nightly job folds them into daily aggregates and deletes them (default 90).", { default: "90", safeToShow: true }),
  config("AGENT_MODEL", "string", "ai", "AI model", "Which model the agents use.", { default: "claude-sonnet-5-5", safeToShow: true }),
  config("OPENAI_SUMMARY_MODEL", "string", "ai", "OpenAI summary model", "The model for AI summaries when the provider is OpenAI (a built-in default applies when unset)."),
  config("CONSENT_RECORD_ONLY_PURPOSES", "list", "consent", "Consent purposes recorded but not enforced", "Purposes recorded but not enforced while rolling out (a comma-separated list).", { safeToShow: true }),
  config("CONSENT_ADS_MEASUREMENT_NOTICE", "string", "closedloop", "Ads-measurement notice", "The consent notice shown for ads measurement.", IN_FLIGHT("closedloop")),
  config("CONSENT_ADS_MEASUREMENT_NOTICE_VERSION", "string", "closedloop", "Ads-measurement notice version", "The version of the ads-measurement notice.", IN_FLIGHT("closedloop")),
  config("OUTCOMES_DISCLAIMER", "string", "outcomes", "Outcomes disclaimer", "Wording shown with every projection (must say illustrative; falls back to a built-in text otherwise)."),
  config("PARTNER_SOURCE", "enum", "partners", "Partner data source", "native reads this CRM; sample serves made-up data for development; any other value reads native.", {
    options: ["native", "sample"],
    default: "native",
    safeToShow: true,
    activeWhen: eq("PARTNER_SOURCE", "sample"),
    conflictsWith: [req("FR-14", PROD, "The sample partner source is selected in a production environment.", "Unset PARTNER_SOURCE (or set it to native).")],
  }),
  config("REFERRAL_LINK_BASE", "url", "referrals", "Referral link base", "The https address used for referral share links (no base, no link)."),
  config("SOCIAL_TIMEZONE", "string", "marketing", "Social post time zone", "The time zone social post times are shown in.", { default: "Asia/Kolkata", safeToShow: true }),
  config("BACKOFFICE_IMPORT_DIR", "path", "backoffice-import", "Import drop folder", "The folder the back-office importer reads."),
  config("BACKOFFICE_IMPORT_HOUR_UTC", "int", "backoffice-import", "Import hour (UTC)", "The hour of the nightly back-office import.", { default: "21", min: 0, max: 23, safeToShow: true }),
  config("META_ADS_SYNC_EVERY_HOURS", "int", "ads", "Meta sync interval (hours)", "How often the Meta ad-spend sync runs.", { default: "6", min: 1, max: 168, safeToShow: true }),
  config("GOOGLE_ADS_SYNC_EVERY_HOURS", "int", "ads", "Google sync interval (hours)", "How often the Google Ads reporting sync runs.", { default: "6", min: 1, max: 168, safeToShow: true }),
  config("CLOSED_LOOP_LOOKBACK_DAYS", "int", "closedloop", "Closed-loop lookback (days)", "How far back conversions are looked for.", { ...IN_FLIGHT("closedloop"), default: "7", min: 1, max: 30 }),
  config("CLOSED_LOOP_MAX_PER_RUN", "int", "closedloop", "Closed-loop batch size", "The most conversions sent per run.", { ...IN_FLIGHT("closedloop"), min: 1 }),
  config("CALLS_RECORDING_HOSTS", "list", "calls", "Recording hosts", "Extra hosts the call-recording proxy may fetch from."),
  config("WHATSAPP_DEFAULT_COUNTRY_CODE", "string", "whatsapp", "WhatsApp default country code", "The country code assumed for a phone number without one (91 when unset).", { safeToShow: true }),
  config("KYC_AUTOMATION_PROVIDER", "string", "kyc", "KYC automation provider", "Selects a KYC automation provider; unset (the production default) means every step is manual."),
  config("DAILY_REPORT_RECIPIENT_EMAIL", "string", "reports", "Report recipient", "The one address that receives the daily, weekly and monthly management reports.", { data: "internal" }),
  config("SSO_BREAK_GLASS_EMAILS", "list", "auth", "Break-glass sign-in list", "People who may still use a password when SSO_ONLY is on.", { data: "internal" }),
  config("AUDIT_ANCHOR_LOCK_MODE", "enum", "audit", "Audit anchor lock mode", "Object-lock mode for audit anchors (COMPLIANCE unless GOVERNANCE is set).", { options: ["GOVERNANCE", "COMPLIANCE"], safeToShow: true }),
  config("AUDIT_ANCHOR_RETENTION_DAYS", "int", "audit", "Audit anchor retention (days)", "How long audit anchors are retained.", { min: 1 }),
  config("AUDIT_ANCHOR_S3_BUCKET", "string", "audit", "Audit anchor bucket", "The storage bucket for audit anchors."),
  config("AUDIT_ANCHOR_S3_PREFIX", "string", "audit", "Audit anchor prefix", "The key prefix for audit anchors."),
  config("AUDIT_ANCHOR_S3_REGION", "string", "audit", "Audit anchor region", "The storage region for audit anchors."),
  config("META_GRAPH_BASE_URL", "url", "ads", "Meta Graph base URL", "Overrides the Meta Graph API address (tests and proxies)."),
  config("CRM_BASE_URL", "url", "platform", "CRM base URL", "The public address of this CRM, used when building links."),
  config("FLAG_CHECK", "enum", "flags", "Flag check mode", "Break-glass: warn downgrades a failed production flag check from stopping the boot to a loud warning.", { options: ["warn"], since: "wave0", safeToShow: true }),
  config("LB_BASE", "url", "layout-budget", "Layout-budget base URL", "The address the layout-budget run drives.", { process: "tooling" }),
  config("DEMO_ALLOW_HOSTS", "list", "demo", "Demo allowed hosts", "Hosts the demo network guard lets through.", { ...IN_FLIGHT("demo"), process: "tooling" }),
  config("DEMO_BASE_URL", "url", "demo", "Demo base URL", "Demo tooling.", { ...IN_FLIGHT("demo"), process: "tooling" }),
  config("DEMO_MAIL_DIR", "path", "demo", "Demo mail folder", "Demo tooling.", { ...IN_FLIGHT("demo"), process: "tooling" }),
  config("DEMO_SAMPLE_DIR", "path", "demo", "Demo sample folder", "Demo tooling.", { ...IN_FLIGHT("demo"), process: "tooling" }),
  config("DEMO_GUARD_LOG", "path", "demo", "Demo guard log", "Demo tooling.", { ...IN_FLIGHT("demo"), process: "tooling" }),
  config("DEMO_PERF_MS", "int", "demo", "Demo performance budget (ms)", "Demo tooling.", { ...IN_FLIGHT("demo"), process: "tooling", min: 1 }),
  config("DEMO_SHOTS", "path", "demo", "Demo screenshots folder", "Demo tooling.", { ...IN_FLIGHT("demo"), process: "tooling" }),
  config("PERF_SEED_CLIENTS", "int", "perf-seed", "Performance seed size", "How many clients the performance seed creates.", { process: "tooling", min: 1 }),
  config("PARTNER_PERF_SCALE", "int", "partners", "Partner performance scale", "Partner performance test scale.", { process: "tooling", min: 1 }),
  config("PARTNER_PERF_REPORT", "path", "partners", "Partner performance report path", "Where the partner performance test writes its report.", { process: "tooling" }),
  config("E2E_PORT", "int", "e2e", "E2E port", "Port of the end-to-end run.", { default: "3100", process: "tooling", min: 1, max: 65535, safeToShow: true }),
  def("E2E_REUSE_SERVER", "test", "bool", "e2e", "E2E reuse server", "Reuse a running server instead of starting one for the end-to-end run.", { process: "tooling" }),
  def("ANALYZE", "test", "string", "build", "Bundle analyzer", "Set to true to emit the bundle analysis during a build.", { process: "tooling" }),
  def("EVALS_REAL_PROVIDER", "test", "bool", "agents-evals", "Real judge in evals", "npm run evals only: also run the real judge against the AI provider (never in CI).", {
    process: "tooling",
    fx: { ai: true },
    requires: [...aiGate()],
    conflictsWith: [req("FR-04", set("CI"), "The real AI judge is on in CI; CI never calls a real provider.", "Unset EVALS_REAL_PROVIDER in CI.")],
  }),
  // worker (separate process): config with defaults in whatsapp-worker/src/config.ts
  config("SESSION_DATA_DIR", "path", "whatsapp-worker", "Worker session folder", "Where the WhatsApp worker keeps its sessions.", { process: "worker" }),
  config("SESSION_ID", "string", "whatsapp-worker", "Worker session id", "One session the WhatsApp worker runs.", { process: "worker" }),
  config("SESSION_IDS", "list", "whatsapp-worker", "Worker session ids", "The sessions the WhatsApp worker runs.", { process: "worker" }),
  config("HEALTH_CHECK_MS", "int", "whatsapp-worker", "Worker health check (ms)", "How often the worker checks its sessions.", { process: "worker", min: 10000 }),
  config("HEARTBEAT_MS", "int", "whatsapp-worker", "Worker heartbeat (ms)", "How often the worker reports in.", { process: "worker", min: 1 }),
  config("OUTBOX_POLL_MS", "int", "whatsapp-worker", "Worker outbox poll (ms)", "How often the worker polls the outbox.", { process: "worker", min: 1 }),
  config("SEND_MIN_INTERVAL_MS", "int", "whatsapp-worker", "Worker send spacing (ms)", "The least time between two sends.", { process: "worker", min: 0 }),
  config("START_STAGGER_MS", "int", "whatsapp-worker", "Worker start stagger (ms)", "Delay between starting two sessions.", { process: "worker", min: 0 }),
  config("MAX_MESSAGE_AGE_SECONDS", "int", "whatsapp-worker", "Worker message age limit (s)", "Messages older than this are ignored.", { process: "worker", default: "900", min: 0 }),
  config("CHROME_PATH", "path", "whatsapp-worker", "Worker browser path", "Path to the browser the worker drives.", { process: "worker" }),
  config("LOG_LEVEL", "enum", "whatsapp-worker", "Worker log level", "Worker log detail.", { process: "worker", options: ["debug", "info", "warn", "error"], default: "info", safeToShow: true }),
];

// ---- Secrets and credentials (presence only) -------------------------------------------------------------------------
const alwaysRequired = (name: string, alt?: string): Requirement[] => [
  req("FR-16", alt ? anyOf(cred(name), cred(alt)) : cred(name), alt ? `${name} (or ${alt}) is not set: the platform cannot run without it.` : `${name} is not set: the platform cannot run without it.`, `Set ${alt ? `${name} (or ${alt})` : name}.`, { contexts: ["production", "development"] }),
];
const SECRETS: FlagDef[] = [
  secret("AGENT_API_KEY", "Agent API key", "Authenticates the bot that reads briefings and reports outcomes."),
  secret("ANTHROPIC_API_KEY", "Anthropic API key", "The key for the Anthropic provider (presence only)."),
  secret("OPENAI_API_KEY", "OpenAI API key", "The key for the OpenAI provider (presence only)."),
  secret("APP_DATABASE_URL", "App database URL", "The runtime database connection used by the app role."),
  secret("APP_DB_PASSWORD", "App database password", "The password of the app database role."),
  secret("APP_SIGNUP_SECRET", "App signup secret", "HMAC secret for /api/webhooks/app-signup (404 while unset); also the fallback device-hash key."),
  secret("AUDIT_ANCHOR_AWS_ACCESS_KEY_ID", "Audit anchor access key id", "Storage credential for audit anchors."),
  secret("AUDIT_ANCHOR_AWS_SECRET_ACCESS_KEY", "Audit anchor secret key", "Storage credential for audit anchors."),
  secret("AUTH_SECRET", "Auth secret", "Signs sessions (the Auth.js v5 name).", { requiresAlways: alwaysRequired("AUTH_SECRET", "NEXTAUTH_SECRET") }),
  secret("NEXTAUTH_SECRET", "Auth secret (v4 name)", "Signs sessions (the Auth.js v4 name; either name works)."),
  secret("CRON_SECRET", "Cron secret", "Authenticates the scheduler calling the cron tick.", { requiresAlways: alwaysRequired("CRON_SECRET") }),
  secret("DATABASE_URL", "Database URL", "The database connection (shown nowhere; only its host is compared with localhost)."),
  secret("DIRECT_DATABASE_URL", "Direct database URL", "The direct database connection for migrations."),
  secret("DEVICE_HASH_KEY", "Device hash key", "Key for hashing the app's device identifier; without a key nothing is hashed."),
  secret("ENCRYPTION_KEY", "Encryption key", "Encrypts stored integration credentials.", { requiresAlways: alwaysRequired("ENCRYPTION_KEY") }),
  secret("FIREBASE_SERVICE_ACCOUNT_JSON", "Firebase service account", "Lets the platform send push messages through Firebase."),
  secret("KEYCLOAK_CLIENT_ID", "Keycloak client id", "Keycloak connection (single sign-on)."),
  secret("KEYCLOAK_CLIENT_SECRET", "Keycloak client secret", "Keycloak connection (single sign-on)."),
  secret("KEYCLOAK_ISSUER", "Keycloak issuer", "Keycloak connection (single sign-on)."),
  secret("LB_PASSWORD", "Layout-budget password", "The sign-in the layout-budget run uses.", { process: "tooling" }),
  secret("META_WEBHOOK_VERIFY_TOKEN", "Meta webhook verify token", "Verifies the Meta leads webhook."),
  secret("PORTFOLIO_FEED_SECRET", "Portfolio feed secret", "Verifies the signed portfolio feed."),
  secret("WHATSAPP_WORKER_SECRET", "WhatsApp worker secret", "Authenticates the WhatsApp worker to the app."),
  secret("DEMO_CREDS", "Demo credentials", "Demo tooling.", { ...IN_FLIGHT("demo"), process: "tooling" }),
  secret("DEMO_CREDS_IN", "Demo credentials in", "Demo tooling.", { ...IN_FLIGHT("demo"), process: "tooling" }),
  secret("DEMO_CREDS_OUT", "Demo credentials out", "Demo tooling.", { ...IN_FLIGHT("demo"), process: "tooling" }),
  secret("E2E_EMAIL", "E2E sign-in email", "The account the end-to-end run signs in with.", { process: "tooling" }),
  secret("E2E_PASSWORD", "E2E sign-in password", "The password the end-to-end run signs in with.", { process: "tooling" }),
];

// ---- Platform and host-provided ----------------------------------------------------------------------------------------
const PLATFORM: FlagDef[] = [
  platform("AUTH_URL", "Auth URL", "The public address Auth.js uses (host-provided)."),
  platform("NEXTAUTH_URL", "Auth URL (v4 name)", "The public address next-auth uses (host-provided)."),
  platform("NODE_ENV", "Node environment", "production, development or test (set by the framework).", { safeToShow: true }),
  platform("NEXT_RUNTIME", "Next runtime", "nodejs or edge (set by the framework).", { safeToShow: true }),
  platform("NEXT_PHASE", "Next build phase", "phase-production-build while `next build` runs (set by the framework).", { safeToShow: true }),
  platform("VERCEL_ENV", "Deployment environment", "production, preview or development (set by the host).", { safeToShow: true }),
  platform("VERCEL_URL", "Deployment URL", "The deployment's address (set by the host)."),
  platform("VERCEL_GIT_COMMIT_REF", "Deployed branch", "The branch that was deployed (set by the host).", { safeToShow: true }),
  platform("VERCEL_GIT_COMMIT_SHA", "Deployed commit", "The commit that was deployed (set by the host).", { safeToShow: true }),
  platform("CI", "CI marker", "Set by the CI runner; real AI providers are never called in CI.", { since: "wave0" }),
];

// ---- Opt-in real-database tests ----------------------------------------------------------------------------------------
const TESTS: FlagDef[] = [
  testSwitch("ACCESS_DB_TEST", "access", "Runs the access *.db.test.ts files (refuses a non-local database)."),
  testSwitch("AI_GATEWAY_DB_TEST", "ai-gateway", "Runs the AI gateway *.db.test.ts files (refuses a non-local database)."),
  testSwitch("PILOT_DB_TEST", "ai-pilot", "Runs the AI pilot *.db.test.ts files (refuses a non-local database)."),
  testSwitch("APPROVALS_DB_TEST", "approvals", "Runs the approvals *.db.test.ts files (refuses a non-local database)."),
  testSwitch("ERASURE_DB_TEST", "erasure", "Runs the erasure *.db.test.ts files (refuses a non-local database)."),
  testSwitch("REFERRAL_DB_TEST", "referrals", "Runs the referral *.db.test.ts files (refuses a non-local database)."),
  testSwitch("PARTNER_NATIVE_DB_TEST", "partners", "Runs the partner native *.db.test.ts files (refuses a non-local database)."),
  testSwitch("PARTNER_PERF_DB_TEST", "partners", "Runs the partner performance *.db.test.ts files (refuses a non-local database)."),
  testSwitch("ATTRIBUTION_DB_TEST", "attribution", "Runs the attribution *.db.test.ts files (refuses a non-local database).", IN_FLIGHT("attribution")),
  testSwitch("CLOSEDLOOP_DB_TEST", "closedloop", "Runs the closed-loop *.db.test.ts files (refuses a non-local database).", IN_FLIGHT("closedloop")),
  testSwitch("CREATIVE_DB_TEST", "creative", "Runs the creative *.db.test.ts files (refuses a non-local database).", IN_FLIGHT("creative")),
  testSwitch("PLANNER_DB_TEST", "planner", "Runs the planner *.db.test.ts files (refuses a non-local database).", IN_FLIGHT("planner")),
];

export const REGISTRY: readonly FlagDef[] = [...PUBLIC, ...SERVER_FEATURES, ...OUTBOUND, ...SAFETY_IN_FLIGHT, ...CONFIG, ...SECRETS, ...PLATFORM, ...TESTS];

const BY_NAME: ReadonlyMap<string, FlagDef> = new Map(REGISTRY.map((f) => [f.name, f]));

export const byName = (name: string): FlagDef | undefined => BY_NAME.get(name);
export const isRegistered = (name: string): boolean => BY_NAME.has(name);
export const flagNames = (): string[] => REGISTRY.map((f) => f.name);

/** On/off switches (the "exactly 1" family), excluding tests and tooling. */
export const FLAG_KINDS: readonly Kind[] = ["feature", "safety", "outbound", "outbound-ai", "blocked"];
export const isFlagDef = (f: FlagDef): boolean => f.type === "bool" && FLAG_KINDS.includes(f.kind);
