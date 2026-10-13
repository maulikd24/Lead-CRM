import type { Action, Area } from "./policy";

/**
 * The inventory that makes default-deny checkable. Every page, server-action file and API route under src/app has one
 * entry here, and surface-coverage.test.ts fails when a route exists without one (or an entry outlives its route).
 *
 * An entry is either
 *   { area, action }  the registry decides (policy.ts): the source must call requireAccess / requireRole / a named
 *                     helper that does, and no role list in it may let in a role the registry refuses, or
 *   { open, why }     deliberately not role-gated, with the reason written down: "public" (no session), "session"
 *                     (any signed-in user, about themselves only) or "credential" (a machine caller proves itself with
 *                     a secret or signature instead of a session).
 */

export type OpenKind = "public" | "session" | "credential";
export type Guard = { area: Area; action?: Action } | { open: OpenKind; why: string };

export const guardIsOpen = (g: Guard): g is { open: OpenKind; why: string } => "open" in g;

const a = (area: Area, action: Action = "view"): Guard => ({ area, action });
const open = (kind: OpenKind, why: string): Guard => ({ open: kind, why });

// ---- Pages: key is the URL pattern (route groups removed) -------------------------------------------------------------
export const PAGE_POLICY: Record<string, Guard> = {
  "/": open("public", "Signed-out visitors see the front door (a synthetic-data tour, no customer data) or are sent to the sign-in page; signed-in people are redirected to their own home."),
  "/login": open("public", "The sign-in page (company Google sign-in, single sign-on and the email and password fallback)."),
  "/change-password": open("session", "The forced password change; reachable before the registry applies, only for the signed-in person."),
  "/handbook": a("reference"),
  "/help": a("reference"),
  "/release-notes": a("reference"),
  "/feature-specs": a("feature-specs"),
  "/partner-statement/[partnerId]": a("partner-workspace"),

  "/dashboard": a("dashboard"),
  "/clients": a("clients"),
  "/leads": a("clients"),
  "/pipeline": a("clients"),
  "/settings/targets": a("settings-targets"),
  "/settings/data-export": a("settings-data-privacy"),
  "/clients/[id]": a("clients"),
  "/clients/[id]/360": a("client-360"),
  "/clients/duplicates": a("duplicates"),
  "/copilot": a("copilot"),
  "/inbox": a("inbox"),
  "/tasks": a("tasks"),
  "/approvals": a("approvals"),
  "/product-registry": a("product-registry"),
  "/agents": a("agent-drafts"),
  "/agents/insights": a("agent-insights"),
  "/calls": a("calls"),
  "/calls/[id]": a("calls"),
  "/quality-audit": a("quality-audit"),
  "/quality-audit/[id]": a("quality-audit"),
  "/support": a("support"),
  "/exceptions": a("exceptions"),
  "/households": a("households"),
  "/households/[id]": a("households"),
  "/service": a("service-state"),
  "/journeys": a("journeys"),
  "/journeys/[id]": a("journeys"),
  "/reports": a("reports"),
  "/reports/rm/[id]": a("reports"),
  "/management-dashboard": a("management-dashboard"),
  "/intelligence": a("intelligence"),
  "/management-intelligence": a("intelligence"),
  "/decisions": a("decision-review"),
  "/settings/decision-shadow": a("decision-report"),
  "/activity-log": a("activity-log"),

  "/marketing": a("marketing"),
  "/marketing/approved-claims": a("product-registry-claims"),
  "/marketing/needs-attention": a("attention-marketing"),
  "/creative-print/[briefId]": a("marketing-creative"),
  "/report-print": a("marketing-reports", "export"),
  "/shared/report/[token]": open("credential", "A shared director report: opened by an unguessable, expiring, revocable token instead of a session. See PUBLIC_SURFACES[\"report-share-link\"]: aggregate numbers only, rate limited, never indexed."),
  "/referrals": a("referral-program"),
  "/planner": a("marketing-planner"),
  "/planner/new": a("marketing-planner", "manage"),
  "/planner/[id]": a("marketing-planner"),

  "/dealer-desk": a("dealer-desk"),
  "/partner-home": a("partner-home"),
  "/management-console": a("management-console"),
  "/partners": a("partner-workspace"),
  "/partners/affiliates": a("partner-workspace"),
  "/partners/affiliates/[id]": a("partner-workspace"),
  "/partners/commissions": a("partner-workspace"),
  "/partners/network": a("partner-workspace"),
  "/partners/payouts": a("partner-workspace"),
  "/partners/referred-users": a("partner-workspace"),
  "/partners/statements": a("partner-workspace"),
  "/partners/statements/[partnerId]": a("partner-workspace"),

  "/finance-console": a("finance-console"),
  "/earnings": a("earnings"),
  "/earnings/runs/[id]": a("earnings"),
  "/settings/partner-finance": a("partner-finance"),

  "/settings/account": a("account"),
  "/settings/users": a("settings-users"),
  "/settings/users/[id]": a("settings-users"),
  "/settings/access": a("settings-access"),
  "/settings/sign-in": a("settings-sign-in"),
  "/settings/integrations": a("marketing-ad-integrations"),
  "/autopilot": a("marketing-autopilot"),
  "/settings/lead-leakage": a("marketing-attribution"),
  "/closed-loop": a("marketing-attribution"),
  "/settings/stages": a("settings-stages"),
  "/settings/templates": a("settings-templates"),
  "/settings/whatsapp": a("settings-whatsapp"),
  "/settings/approval-workflows": a("settings-approvals"),
  "/settings/lead-assignment": a("settings-lead-assignment"),
  "/settings/data-privacy": a("settings-data-privacy"),
  "/settings/consent": a("settings-data-privacy"),
  "/settings/go-live": a("settings-go-live"),
  "/settings/system": a("settings-system"),
  "/modules": a("modules"),
  "/settings/control-plane": a("control-plane"),
  "/settings/control-plane/investigate": a("action-ledger-investigate"),
  "/settings/product-registry": a("settings-product-registry"),
  "/settings/system/status": a("settings-system"),
  "/settings/ai-pilot": a("settings-ai-pilot"),
  "/settings/backoffice-import": a("settings-backoffice-import"),
  "/settings/partner-tiers": a("partner-directory"),
  "/debugger": a("debugger"),
};

// ---- Server actions: key is the file under src/app. `functions` overrides the default for named exports. ------------
export type ActionEntry = { default: Guard; functions?: Record<string, Guard> };

export const ACTION_POLICY: Record<string, ActionEntry> = {
  "(dashboard)/actions.ts": { default: open("session", "Sign out and mark the tour as seen: about the signed-in person only.") },
  "login/actions.ts": { default: open("public", "Signing in.") },
  "(dashboard)/ai-summary-actions.ts": { default: open("session", "Each summary kind is gated through the registry inside the action (KIND_AREA), then record-level visibility applies.") },
  "(dashboard)/notifications-actions.ts": { default: a("notifications", "manage") },
  "(dashboard)/command-search-actions.ts": { default: a("clients"), functions: { universalSearchAction: open("session", "Cmd+K search for every signed-in role: each source is gated by its own registry area BEFORE it is queried and gets that page's scope (src/lib/palette/universal-search.ts).") } },

  "(dashboard)/agents/actions.ts": { default: a("agent-drafts", "manage") },
  "(dashboard)/calls/actions.ts": { default: a("calls", "manage") },
  "(dashboard)/leads/actions.ts": { default: a("clients", "manage") },
  "(dashboard)/clients/actions.ts": { default: a("clients", "manage") },
  "(dashboard)/clients/quick-view-actions.ts": { default: a("clients"), functions: { scheduleFollowUpAction: a("clients", "manage") } },
  "(dashboard)/pipeline/actions.ts": { default: a("clients", "manage") },
  "(dashboard)/click-to-call/actions.ts": {
    default: a("clients", "manage"),
    functions: {
      getCallSessionAction: open("session", "The caller's own call session only (the query filters by the signed-in user)."),
      endMockCallAction: open("session", "The caller's own mock call session only."),
      setOwnCallPhoneAction: open("session", "The signed-in person's own calling phone number only."),
      getMyActiveCallIdAction: open("session", "The signed-in person's own active call only."),
    },
  },
  "(dashboard)/settings/data-export/actions.ts": { default: a("settings-data-privacy", "export") },
  "(dashboard)/settings/targets/actions.ts": { default: a("settings-targets", "manage") },
  "(dashboard)/clients/holder-actions.ts": { default: a("clients", "manage") },
  "(dashboard)/clients/import-actions.ts": { default: a("clients", "manage") },
  "(dashboard)/clients/kyc-step-actions.ts": { default: a("clients", "manage") },
  "(dashboard)/clients/support-actions.ts": { default: a("client-support", "manage") },
  "(dashboard)/clients/duplicates/actions.ts": { default: a("duplicates", "manage") },
  "(dashboard)/clients/[id]/consent-actions.ts": { default: a("client-consent", "manage") },
  "(dashboard)/clients/[id]/intelligence-actions.ts": { default: a("client-360", "manage") },
  "(dashboard)/clients/[id]/opportunity-actions.ts": { default: a("client-360", "manage") },
  "(dashboard)/clients/[id]/wealth-actions.ts": { default: a("client-360", "manage") },
  "(dashboard)/clients/[id]/360/outcomes-actions.ts": { default: a("outcomes", "manage") },
  "(dashboard)/clients/[id]/360/memory-actions.ts": { default: a("customer-memory", "manage") },
  "(dashboard)/clients/[id]/360/service-actions.ts": { default: a("service-state", "manage") },
  "(dashboard)/inbox/actions.ts": { default: a("inbox", "manage") },
  "(dashboard)/tasks/actions.ts": { default: a("tasks", "manage"), functions: { createTaskAction: a("clients", "manage") } },
  "(dashboard)/households/actions.ts": { default: a("households", "manage") },
  "(dashboard)/households/import-actions.ts": { default: a("households", "manage") },
  "(dashboard)/households/[id]/intelligence-actions.ts": { default: a("household-intelligence", "manage") },
  "(dashboard)/intelligence/actions.ts": { default: a("intelligence", "manage") },
  "(dashboard)/management-intelligence/actions.ts": { default: a("intelligence", "manage") },
  "(dashboard)/decisions/actions.ts": { default: a("decision-drawer", "manage") },
  "(dashboard)/settings/decision-shadow/actions.ts": { default: a("decision-report", "manage") },
  "(dashboard)/journeys/actions.ts": { default: a("journeys", "manage") },
  "(dashboard)/approvals/actions.ts": { default: a("approvals", "manage") },
  "(dashboard)/quality-audit/[id]/actions.ts": { default: a("quality-audit", "manage") },

  "(dashboard)/marketing/social-actions.ts": { default: a("marketing-social", "manage") },
  "(dashboard)/autopilot/actions.ts": {
    default: a("marketing-autopilot", "manage"),
    functions: { askAutopilotAction: a("marketing-autopilot", "view"), previewLaunchAction: a("marketing-autopilot", "view"), draftRuleAction: a("marketing-autopilot", "view"), previewRuleAction: a("marketing-autopilot", "view") },
  },
  "(dashboard)/marketing/creative-actions.ts": {
    default: a("marketing-creative", "manage"),
    functions: {
      addCompetitorAction: a("marketing-competitor-ads", "manage"), removeCompetitorAction: a("marketing-competitor-ads", "manage"), addCompetitorAdAction: a("marketing-competitor-ads", "manage"),
      importCompetitorCsvAction: a("marketing-competitor-ads", "manage"), setCompetitorAdTagsAction: a("marketing-competitor-ads", "manage"), removeCompetitorAdAction: a("marketing-competitor-ads", "manage"),
      saveExperimentAction: a("marketing-experiments", "manage"), deleteExperimentAction: a("marketing-experiments", "manage"),
      setAiCreativeAction: a("settings-ai", "manage"),
    },
  },
  "(dashboard)/marketing/report-actions.ts": { default: a("marketing-reports", "export"), functions: { saveDigestSettingsAction: a("marketing-reports", "manage"), saveApprovalSettingsAction: a("marketing-reports", "manage") } },
  "(dashboard)/settings/lead-leakage/actions.ts": { default: a("marketing-attribution", "manage") },
  "(dashboard)/closed-loop/actions.ts": { default: a("marketing-attribution", "manage"), functions: { retryOutboxRowAction: a("marketing-attribution"), setKillSwitchAction: a("marketing-attribution") } },
  "(dashboard)/planner/actions.ts": {
    default: a("marketing-planner", "manage"),
    functions: {
      saveDestinationAction: a("marketing-planner-registry", "manage"),
      saveCreatorAction: a("marketing-planner-registry", "manage"),
      saveRuleAction: a("marketing-planner-registry", "manage"),
      deleteRuleAction: a("marketing-planner-registry", "manage"),
      runHealthChecksAction: a("marketing-planner-registry", "manage"),
    },
  },
  "(dashboard)/referrals/actions.ts": {
    default: a("referral-program", "manage"),
    functions: {
      enrollReferrerAction: a("referral-referrers", "manage"),
      issueCodeAction: a("referral-referrers", "manage"),
      revokeCodeAction: a("referral-referrers", "manage"),
      setReferrerStatusAction: a("referral-referrers", "manage"),
      draftInviteAction: a("referral-referrers", "manage"),
      saveSettingAction: a("referral-settings", "manage"),
      recordSignoffAction: a("referral-settings", "manage"),
      refreshAction: a("referral-statements", "manage"),
      prepareStatementAction: a("referral-statements", "manage"),
      approveStatementAction: a("referral-statements", "manage"),
      markPaidAction: a("referral-statements", "manage"),
      reverseEntryAction: a("referral-statements", "manage"),
      clearReviewAction: a("referral-statements", "manage"),
      confirmClawbackAction: a("referral-statements", "manage"),
      waiveClawbackAction: a("referral-statements", "manage"),
    },
  },

  "(dashboard)/dealer-desk/actions.ts": { default: a("dealer-desk", "manage") },
  "(dashboard)/partners/statements/actions.ts": { default: a("partner-workspace", "manage") },
  "(dashboard)/earnings/actions.ts": { default: a("earnings", "manage") },
  "(dashboard)/earnings/import-actions.ts": { default: a("earnings", "manage") },
  "(dashboard)/settings/partner-finance/actions.ts": { default: a("partner-finance", "manage") },

  "(dashboard)/settings/account/actions.ts": { default: a("account", "manage"), functions: { changeOwnPasswordAction: open("session", "The forced password change must work before the registry applies; it only changes the caller's own password.") } },
  "(dashboard)/settings/account/device-actions.ts": { default: a("account", "manage") },
  "(dashboard)/settings/account/push-actions.ts": { default: a("account", "manage") },
  "(dashboard)/settings/users/actions.ts": { default: a("settings-users", "manage"), functions: { setUserRoutingTagsAction: a("team-directory", "manage"), setUserAvailabilityAction: a("team-directory", "manage") } },
  "(dashboard)/settings/users/[id]/actions.ts": { default: a("settings-users", "manage") },
  "(dashboard)/settings/integrations/actions.ts": { default: a("settings-integrations", "manage") },
  "(dashboard)/settings/sign-in/actions.ts": { default: a("settings-sign-in", "manage") },
  "(dashboard)/settings/stages/actions.ts": { default: a("settings-stages", "manage") },
  "(dashboard)/settings/templates/actions.ts": { default: a("settings-templates", "manage") },
  "(dashboard)/settings/whatsapp/actions.ts": { default: a("settings-whatsapp", "manage") },
  "(dashboard)/settings/approval-workflows/actions.ts": { default: a("settings-approvals", "manage") },
  "(dashboard)/settings/lead-assignment/actions.ts": { default: a("settings-lead-assignment", "manage") },
  "(dashboard)/settings/go-live/actions.ts": { default: a("settings-go-live", "manage") },
  "(dashboard)/settings/control-plane/actions.ts": { default: a("control-plane", "manage") },
  "(dashboard)/settings/control-plane/data-health-actions.ts": { default: a("control-plane", "manage") },
  "(dashboard)/settings/product-registry/actions.ts": { default: a("settings-product-registry", "manage") },
  "(dashboard)/dashboard/attention-actions.ts": { default: a("attention", "manage") },
  "(dashboard)/marketing/needs-attention/actions.ts": { default: a("attention-marketing", "manage") },
  "(dashboard)/clients/simulate-actions.ts": { default: a("clients", "manage") },
  "(dashboard)/settings/ai-pilot/actions.ts": { default: a("settings-ai-pilot", "manage") },
  "(dashboard)/settings/system/status/actions.ts": { default: a("settings-system", "manage") },
  "(dashboard)/settings/backoffice-import/actions.ts": { default: a("settings-backoffice-import", "manage") },
  "(dashboard)/settings/data-privacy/actions.ts": { default: a("settings-data-privacy", "manage"), functions: { createErasureRequestAction: a("erasure-requests", "manage") } },
  "(dashboard)/debugger/actions.ts": { default: a("debugger", "manage"), functions: { createBugReportAction: open("session", "Anyone signed in can report a problem from the header button.") } },
};

// ---- API routes: key is the URL pattern ---------------------------------------------------------------------------------
export const API_POLICY: Record<string, Guard> = {
  "/api/health": open("public", "Liveness probe; returns no data."),
  "/api/auth/[...nextauth]": open("public", "The sign-in handler itself."),
  "/api/activity/page-view": open("session", "Records that the signed-in person opened a page; about themselves only."),
  "/api/dashboard/live-counts": a("dashboard"),
  "/api/approvals": a("approvals"),
  "/api/action-ledger": a("action-ledger"),
  "/api/action-ledger/campaigns": a("action-ledger-campaigns"),
  "/api/action-ledger/investigate": a("action-ledger-investigate"),
  "/api/calls/[id]/recording": a("calls"),
  "/api/clients/export": a("clients", "export"),
  "/api/activity-log/export": a("activity-log", "export"),
  "/api/consent/export": a("settings-data-privacy", "export"),
  "/api/go-live/export": a("settings-go-live", "export"),
  "/api/system/status": a("settings-system"),
  "/api/reports/summary-pdf": a("reports", "export"),
  "/api/reports/management-dashboard-pdf": a("reports", "export"),
  "/api/reports/leads-activity-pdf": a("reports", "export"),
  "/api/reports/rm-daily-report": a("reports", "export"),
  "/api/reports/leads-summary": a("reports", "export"),
  "/partners/statements/[partnerId]/export": a("partner-workspace", "export"),

  "/api/agent/briefing/[clientId]": open("credential", "Called by the external agent with its own bearer token, never by a browser session."),
  "/api/agent/outcome": open("credential", "Called by the external agent with its own bearer token."),
  "/api/agent/work": open("credential", "Called by the external agent with its own bearer token."),
  "/api/device/call-log": open("credential", "Called by a registered phone with its device token."),
  "/api/ingest/portfolio": open("credential", "Signed feed from the portfolio system (HMAC and timestamp)."),
  "/api/leads/web": open("credential", "Lead form: server secret, or an allow-listed browser key with rate limit and honeypot."),
  "/api/leads/google-ads": open("credential", "Ad platform lead webhook: verified shared key."),
  "/api/webhooks/meta-leads": open("credential", "Ad platform lead webhook: verify token and HMAC signature."),
  "/api/webhooks/app-signup": open("credential", "Mobile app signup webhook: HMAC signature."),
  "/api/webhooks/[provider]": open("credential", "Provider webhook: signature check."),
  "/api/data-export/[id]/download": a("settings-data-privacy", "export"),
  "/api/data-import": a("settings-data-privacy", "manage"),
  "/api/webhooks/messaging/[channel]": open("credential", "Messaging provider webhook: verify token and signature."),
  "/api/internal/cron/tick": open("credential", "Scheduler call with the cron secret."),
  "/api/internal/exotel/voice-analyze-callback": open("credential", "Telephony provider callback: signature check."),
  "/api/internal/whatsapp/events": open("credential", "The local WhatsApp worker, with its shared token."),
  "/api/internal/whatsapp/outbox": open("credential", "The local WhatsApp worker, with its shared token."),
  "/api/internal/whatsapp/outbox/[id]/result": open("credential", "The local WhatsApp worker, with its shared token."),
};

// ---- Everything else that can show or send data to a person ---------------------------------------------------------------
export type SurfaceKind = "nav" | "search" | "ask" | "copilot" | "notification" | "export" | "share-link" | "job" | "loader";
export type Surface = { kind: SurfaceKind; area: Area; action: Action; note: string };

const s = (kind: SurfaceKind, area: Area, action: Action, note: string): Surface => ({ kind, area, action, note });

export const SURFACES = {
  // Sidebar, Cmd+K page list, Help and the tour read NAV_ITEMS: each item carries its own area (a test pins every item to the registry).
  "nav.items": s("nav", "reference", "view", "per item: NavItem.area is the ceiling, NavItem.roles can only narrow it"),

  "search.clients": s("search", "clients", "view", "Cmd+K customer search (name, code, mobile): searchClientsForPalette"),
  "search.holders": s("search", "clients", "view", "Cmd+K joint-holder matches resolve to the parent customer"),

  "ask.system": s("ask", "intelligence", "manage", "Ask the system answers across customer data: managers and admins only"),
  "ask.palette-entry": s("ask", "intelligence", "view", "the Ask row in Cmd+K is only offered to roles that may use it"),

  "copilot.worklist": s("copilot", "copilot", "view", "Co-pilot worklist and next-best-action"),
  "copilot.message-suggestion": s("copilot", "copilot", "manage", "Co-pilot drafts a message for the customer: draft only, a person approves"),
  "copilot.agent-drafts": s("copilot", "agent-drafts", "manage", "Agent drafts queue (approve, edit, reject)"),

  "notify.customer-events": s("notification", "clients", "view", "stage, KYC, funding, document and lead notifications name customers"),
  "notify.task-events": s("notification", "tasks", "view", "task assigned and overdue"),
  "notify.calls-and-support": s("notification", "calls", "view", "call review and support SLA notifications"),
  "notify.control-plane": s("notification", "control-plane", "view", "operational alerts (heartbeat, failing jobs, queues, integrations): keys and counts only, never customer data"),
  "notify.system-admin": s("notification", "settings-system", "view", "audit-chain, WhatsApp account health, errors"),
  "notify.finance": s("notification", "earnings", "view", "payout and statement notifications"),
  "notify.partner": s("notification", "partner-workspace", "view", "partner statement and referral notifications"),
  "notify.dealer": s("notification", "dealer-desk", "view", "dealer introduction notifications"),
  "notify.marketing": s("notification", "marketing", "view", "ad sync and campaign alerts (aggregate only)"),

  "export.clients": s("export", "clients", "export", "customer CSV export"),
  "export.activity-log": s("export", "activity-log", "export", "activity log CSV"),
  "export.consent-ledger": s("export", "settings-data-privacy", "export", "consent ledger CSV: contains customer identifiers"),
  "export.go-live": s("export", "settings-go-live", "export", "go-live checklist"),
  "export.reports": s("export", "reports", "export", "sales and team report PDFs"),
  "export.partner-statement": s("export", "partner-workspace", "export", "partner statement CSV (own network only)"),
  "export.marketing-report": s("export", "marketing-reports", "export", "director report and campaign export: aggregate and pseudonymous only"),

  "share.partner-statement": s("share-link", "partner-workspace", "view", "the partner statement page"),
  "share.marketing-report-link": s("share-link", "marketing-reports", "export", "shareable marketing report links: only ADMIN and MARKETING create or open them, and they carry no personal data"),

  "loader.campaign-outcomes": s("loader", "marketing-attribution", "view", "the CampaignOutcomeProvider and the Campaign impact loader refuse every role but ADMIN and MARKETING before any query; MARKETING gets pseudonymous stand-ins, never a name, RM or real id"),
  "loader.autopilot": s("loader", "marketing-autopilot", "view", "the Autopilot snapshot reads campaign outcomes only through the CampaignOutcomeProvider (ADMIN and MARKETING, or the registered system reader autopilot) and the platform daily numbers through the marketing module; lead cohorts carry no id and are blurred for everyone but a signed-in ADMIN"),
  "loader.marketing-workspace": s("loader", "marketing", "view", "marketing loaders select aggregates and pseudonymous ids only: no name, phone, email, PAN, holdings or per-person AUM"),
  "loader.rm-facing": s("loader", "clients", "view", "RM-facing loaders never select spend, cost per lead, return on spend, budgets or ad accounts"),
  "loader.lead-campaign-label": s("loader", "lead-campaign-label", "view", "the campaign name and source label on a lead, context only"),
  "job.cron-outputs": s("job", "reports", "view", "every runJob in the cron tick has a JOB_POLICY entry: output goes only to viewers of its area"),
  "loader.attention-feed": s("loader", "attention", "view", "the feed reads only the viewer's own scope (RM own customers, manager their team, admin all) and role-filters kinds again in the engine; no raw conversation text, ticket text or message body is copied into an item"),
  "loader.attention-marketing": s("loader", "attention-marketing", "view", "campaign anomalies from aggregate AdCampaignDaily rows only: campaign id, name and totals, never a person"),
  "loader.product-registry": s("loader", "product-registry", "view", "approved, in-date products only for RMs and managers; drafts and history are Admin only"),
  "loader.product-registry-claims": s("loader", "product-registry-claims", "view", "approved marketing claims and the product name only: no eligibility, minimum, risk detail, restriction or draft"),
  "loader.referral-program": s("loader", "referral-program", "view", "referral funnel and reward totals at campaign level; referrer detail needs referral-statements"),
  "loader.customer-timeline": s("loader", "client-360", "view", "getCustomerTimeline, the one canonical customer timeline: it checks client-360 itself (Marketing and every role without it are refused) and the customer scope; read only"),
  "loader.action-ledger": s("loader", "action-ledger", "view", "getActionLedger for one customer: checks action-ledger and the Customer 360 record scope itself (RM own customers, manager their team, admin all; otherwise not found), approvals per kind, decision records only to a viewer who may see decisions; ids, enums, times and staff names only, never a message or draft body"),
  "loader.action-ledger-campaigns": s("loader", "action-ledger-campaigns", "view", "campaign-level ledger for MARKETING: ad autopilot chains and aggregated counts; a customer is a keyed pseudonym, never named, and no customer record is opened"),
  "loader.action-ledger-investigate": s("loader", "action-ledger-investigate", "view", "Investigate an action: search the ledger by correlation id, agent run, approval or customer; ADMIN only, same field rules as the customer ledger"),
  "loader.data-health": s("loader", "control-plane", "view", "data-health work items and event consumer lag: customer codes and counts only, ADMIN only"),
  "ask.client-summary-context": s("ask", "client-360", "view", "the AI client summary reads the canonical timeline (CUSTOMER_TIMELINE_V2) through the same role and customer scope check"),
} as const satisfies Record<string, Surface>;

export type SurfaceId = keyof typeof SURFACES;

// ---- Public surfaces: the only pages that open without a session, besides sign-in -------------------------------------------
export type PublicControl = "unguessable-token" | "expiry" | "revocation" | "rate-limit" | "no-personal-data" | "no-index" | "no-referrer" | "feature-flag";
export type PublicSurface = { page: string; area: Area; credential: string; controls: readonly PublicControl[]; note: string };

/**
 * A page with no sign-in is a NAMED surface with its own entry: what opens it and which controls it must carry. public-surfaces.test.ts fails when
 * an open page has no entry, and when the page's source lacks a control its entry claims. Creating the credential (a link) is a registry action
 * (area, "export"); opening it is not, by design.
 */
export const PUBLIC_SURFACES = {
  "report-share-link": {
    page: "/shared/report/[token]", area: "marketing-reports",
    credential: "a 256-bit random token in the address; only its SHA-256 is stored; shown once to the person who made the link",
    controls: ["unguessable-token", "expiry", "revocation", "rate-limit", "no-personal-data", "no-index", "no-referrer", "feature-flag"],
    note: "Reads a stored snapshot of aggregate numbers (channel and campaign names, counts, rupees), scrubbed of contact details when the link is made; never a live customer table. 1 to 30 days, revocable at any time, 60 opens per address per 10 minutes.",
  },
} as const satisfies Record<string, PublicSurface>;

// ---- Scheduled jobs (the cron tick): who may receive what the job produces ---------------------------------------------
export type JobGuard = { area: Area } | { system: string };
const j = (area: Area): JobGuard => ({ area });
const system = (why: string): JobGuard => ({ system: why });

/** Every runJob("name") in the cron tick route needs an entry: either the area whose viewers may receive its output, or the reason it produces none. */
export const JOB_POLICY: Record<string, JobGuard> = {
  heartbeat: system("records that the scheduler ran"),
  checkOverdueTasks: j("tasks"),
  checkStageSla: j("clients"),
  checkFundingSla: j("clients"),
  processDueJourneySteps: j("journeys"),
  checkDisengagement: j("copilot"),
  checkWhatsAppAccountHealth: j("settings-whatsapp"),
  sendDailyReportEmail: j("reports"),
  sendWeeklyManagementReport: j("reports"),
  sendMonthlyManagementReport: j("reports"),
  "ai-run-retention": system("folds expired AI run rows into daily totals and deletes them; produces no output"),
  "memory-extraction": system("reads conversation insights through the AI gateway and writes unconfirmed memory drafts; no output to anyone"),
  "memory-expiry-sweep": system("marks lapsed memory items EXPIRED; produces no output"),
  "nba-decision-retention": system("deletes shadow decisions past their keep-time; produces no output"),
  seedBaselineStages: system("seeds reference data"),
  seedSystemActor: system("seeds the system actor"),
  backfillCompletedClientsToFinalStage: system("data repair, no output"),
  checkStaleVoiceAnalysis: j("calls"),
  sweepWhatsAppConversationReviews: j("quality-audit"),
  checkKycDropOffs: j("clients"),
  syncFreshdeskHistory: j("client-support"),
  extractConversationInsights: j("client-360"),
  refreshStaleIntelligence: j("client-360"),
  "clevertap-push": system("pushes signals to the vendor, India-only, no screen"),
  retryFailedLeads: j("clients"),
  pruneSecurityTables: system("housekeeping"),
  pruneJobRuns: system("housekeeping: prunes the control plane run history"),
  evaluateAlerts: j("control-plane"),
  "event-consumers": system("consumes customer events with cursors; produces counts and dead letters for the control plane only"),
  "data-health": j("control-plane"),
  runDailyAuditChainCheck: j("settings-system"),
  "agent-nudger": j("agent-drafts"),
  "agent-sweeper": j("agent-drafts"),
  "merge-suggestions": j("duplicates"),
  "lead-push-sweep": j("clients"),
  "closed-loop-conversions": j("marketing-attribution"),
  "autopilot-daily-audit": j("marketing-autopilot"),
  "autopilot-weekly-digest": j("marketing-autopilot"),
  "director-digest": j("marketing-reports"),
  "planner-destination-health": j("marketing-planner"),
  "meta-ads-sync": j("marketing"),
  "google-ads-sync": j("marketing"),
  "backoffice-import": j("settings-backoffice-import"),
  "referral-progress": j("referral-program"),
};
