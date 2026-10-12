import { ssoConfigFromEnv } from "@/lib/auth/sso";

/**
 * How the Apps & Integrations page groups and judges its cards. Pure: no database, no network, and it only ever looks at whether an
 * environment value is SET (never at the value). Each integration is in exactly one group and in exactly one state.
 */

export const INTEGRATION_GROUPS = [
  { key: "messaging", label: "Messaging", blurb: "Channels that reach customers and the helpdesk and phone line behind them." },
  { key: "marketing", label: "Marketing and ads", blurb: "Where leads come from and what the ads cost. Reporting only: nothing is created or published on the ad platforms." },
  { key: "data", label: "Data and identity", blurb: "Customer data and identity flowing in and out: engagement, referral programme, work tools." },
  { key: "ai", label: "AI and safety", blurb: "AI providers, the agents that use them, and sign-in. Read-only status: secrets are set on the server, never here." },
] as const;

export type GroupKey = (typeof INTEGRATION_GROUPS)[number]["key"];
export const GROUP_KEYS = INTEGRATION_GROUPS.map((g) => g.key);

const GROUP_BY_PROVIDER: Record<string, GroupKey> = {
  whatsapp_meta: "messaging",
  sms_exotel: "messaging",
  resend_email: "messaging",
  exotel: "messaging",
  freshdesk: "messaging",
  meta_ads: "marketing",
  google_ads: "marketing",
  lead_intake: "marketing",
  clevertap: "data",
  clickup: "data",
  jira: "data",
};

/** An integration the page does not know yet lands in Data and identity, so it is never hidden. */
export const groupOf = (provider: string): GroupKey => GROUP_BY_PROVIDER[provider] ?? "data";
export const isGrouped = (provider: string): boolean => provider in GROUP_BY_PROVIDER;

const ORDER = Object.keys(GROUP_BY_PROVIDER);
const rank = (p: string) => (ORDER.includes(p) ? ORDER.indexOf(p) : ORDER.length);

/** The providers of one group, in the order the page lists them (channels first, unknown ones last). */
export const providersIn = (group: GroupKey, providers: string[]): string[] =>
  providers.filter((p) => groupOf(p) === group).sort((a, b) => rank(a) - rank(b));

export type IntegrationState = "connected" | "mock" | "needs_setup" | "flag_off";
export const STATE_LABEL: Record<IntegrationState, string> = { connected: "Connected", mock: "Mock mode", needs_setup: "Needs setup", flag_off: "Flag off" };

type Env = Record<string, string | undefined>;

/** The server switch that gates an integration's work, where there is one. */
const FLAG_BY_PROVIDER: Record<string, string> = {
  meta_ads: "META_ADS_SYNC_ENABLED",
  google_ads: "GOOGLE_ADS_REPORTING_ENABLED",
  clevertap: "CLEVERTAP_PUSH_ENABLED",
  freshdesk: "FRESHDESK_HANDOFF_ENABLED",
};

export const providerFlag = (provider: string, env: Env): { name: string; on: boolean } | null => {
  const name = FLAG_BY_PROVIDER[provider];
  return name ? { name, on: env[name] === "1" } : null;
};

/**
 * Connected: live mode with credentials saved, and any gating flag on. Flag off: the gating flag is not "1", whatever else is true
 * (nothing runs). Mock mode: nobody has switched it to live, which is the deliberate default and nothing is broken (sends and
 * receives are simulated). Needs setup: live mode was chosen but no credentials are saved, the one case that is really half done.
 */
export function integrationState(input: { mode: string | null; hasCredentials: boolean; flagOn: boolean | null }): IntegrationState {
  if (input.flagOn === false) return "flag_off";
  if (input.mode !== "live") return "mock";
  return input.hasCredentials ? "connected" : "needs_setup";
}

export type StatusRow = { id: string; label: string; group: GroupKey; state: IntegrationState; detail?: string };

/** The state of one stored integration, with the flag it is waiting on when that is the reason. */
export function providerStatus(provider: string, config: { mode: string; credentials: unknown } | null, env: Env): { state: IntegrationState; flagName?: string } {
  const flag = providerFlag(provider, env);
  const state = integrationState({ mode: config?.mode ?? null, hasCredentials: !!config?.credentials, flagOn: flag ? flag.on : null });
  return { state, flagName: state === "flag_off" ? flag?.name : undefined };
}

/** Read-only items for AI and safety. Each says what it is for and whether it is switched on, from the presence of server settings only. */
export type SafetyItem = { id: string; label: string; description: string; state: IntegrationState; detail?: string };

export function aiSafetyItems(env: Env): SafetyItem[] {
  const set = (name: string) => !!env[name]?.trim();
  const keyState = (name: string): IntegrationState => (set(name) ? "connected" : "needs_setup");
  const flagState = (name: string): IntegrationState => (env[name] === "1" ? "connected" : "flag_off");
  const sso = ssoConfigFromEnv(env);
  const ssoState: IntegrationState = sso.enabled ? "connected" : env.SSO_ENABLED === "1" ? "needs_setup" : "flag_off";
  return [
    { id: "anthropic", label: "Claude (Anthropic)", description: "Drafts and summaries for the agents. Every AI message is a draft for a person to approve; nothing is sent by itself.", state: keyState("ANTHROPIC_API_KEY"), detail: "ANTHROPIC_API_KEY" },
    { id: "openai", label: "OpenAI summaries", description: "Call and chat summaries. Off until a key is set.", state: keyState("OPENAI_API_KEY"), detail: "OPENAI_API_KEY" },
    { id: "agent-api", label: "AI agents and agent API", description: "Lets a bot read briefings and report outcomes. While off, no customer's next step is owned by an AI bot.", state: env.AI_AGENTS_ENABLED !== "1" ? "flag_off" : keyState("AGENT_API_KEY"), detail: "AI_AGENTS_ENABLED, AGENT_API_KEY" },
    { id: "nudger", label: "WhatsApp nudger", description: "Drafts follow-up nudges for approval. Also needs its switch on the Agents page.", state: flagState("AGENT_NUDGER_ENABLED"), detail: "AGENT_NUDGER_ENABLED" },
    { id: "reply-assist", label: "WhatsApp reply assist", description: "Suggests replies in the inbox. A person approves every send.", state: flagState("WA_ASSIST_ENABLED"), detail: "WA_ASSIST_ENABLED" },
    { id: "social-drafter", label: "Social post drafter", description: "Drafts posts for review. Nothing is ever published for you.", state: flagState("SOCIAL_DRAFTS_ENABLED"), detail: "SOCIAL_DRAFTS_ENABLED" },
    {
      id: "sso",
      label: "Single sign-on (Keycloak)",
      description: "Staff sign in through the company identity provider. Password sign-in stays open unless SSO only is set, apart from the break-glass accounts.",
      state: ssoState,
      detail: sso.enabled ? `${sso.ssoOnly ? "SSO only" : "Password sign-in also open"}, ${sso.breakGlass.length} break-glass ${sso.breakGlass.length === 1 ? "account" : "accounts"}` : "SSO_ENABLED, KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET",
    },
  ];
}

export type Webhook = { path: string; note?: string };

/** The webhook URLs that belong with each group, so a tab lists only what its cards use. */
export function webhooksFor(group: GroupKey, lists: { providers: string[]; channels: string[] }): Webhook[] {
  const out: Webhook[] = [];
  for (const p of lists.providers) if (groupOf(p) === group) out.push({ path: `/api/webhooks/${p}` });
  if (group === "messaging") for (const c of lists.channels) out.push({ path: `/api/webhooks/messaging/${c}` });
  if (group === "marketing") {
    out.push({ path: "/api/webhooks/meta-leads", note: "Meta Lead Ads, Facebook and Instagram" });
    out.push({ path: "/api/leads/google-ads", note: "Google Ads lead forms" });
    out.push({ path: "/api/leads/web", note: "website, blog and contact forms" });
  }
  return out;
}

export function summarise(rows: { state: IntegrationState }[]): Record<IntegrationState, number> {
  const out: Record<IntegrationState, number> = { connected: 0, mock: 0, needs_setup: 0, flag_off: 0 };
  for (const r of rows) out[r.state] += 1;
  return out;
}
