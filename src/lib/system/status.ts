import { CRON_HEARTBEAT, HEARTBEAT_STALE_MS } from "./heartbeat-constants";
import { FLAGS, SETTINGS, flagIsOn } from "./flag-registry";

/**
 * The Admin "System status": version, database, migrations, flags, scheduler, queues and integrations in one object.
 * Prisma-free: the page and the JSON route pass real data in (status-wiring.ts), tests pass fakes.
 * No secret value is ever read into the result: environment variables are reported by NAME and present/missing only,
 * and a failing query reports "unreachable", never the driver's message (which can carry a connection string).
 */
export interface StatusDeps {
  ping(): Promise<{ database: string; serverVersion: string }>;
  migrations(): Promise<{ applied: string[]; failed: string[] }>;
  /** Folder names in prisma/migrations, or null when the folder is not part of this deployment. */
  migrationsOnDisk(): Promise<string[] | null>;
  heartbeatAgeMs(): Promise<number | null>;
  dailyJobs(): Promise<{ name: string; at: Date }[]>;
  queueFacts(): Promise<{
    whatsappQueued: { n: number; oldest: Date | null };
    draftsWaiting: { n: number; oldest: Date | null };
    leadErrors7d: number;
    reviewsBacklog: { n: number; oldest: Date | null };
    mergeOpen: number;
  }>;
  integrationRows(): Promise<{ provider: string; mode: string; isEnabled: boolean; hasCredentials: boolean; updatedAt: Date }[]>;
  aiKeySaved(): Promise<boolean>;
}

export type Env = Record<string, string | undefined>;
export type IntegrationState = "connected" | "needs_setup" | "mock" | "flag_off";
export type SystemStatus = {
  generatedAt: string;
  app: { commit: string | null; shortCommit: string; branch: string | null; deployEnv: string; nodeEnv: string };
  database: { connected: boolean; name: string | null; serverVersion: string | null; latencyMs: number | null };
  migrations: { applied: number; failed: string[]; latest: string | null; pending: number | null; onDisk: number | null } | null;
  flags: { on: { name: string; label: string; buildTime: boolean }[]; off: string[]; settings: { name: string; value: string }[] };
  cron: { tick: { state: "ticking" | "stale" | "never" | "unknown"; minutesAgo: number | null }; jobs: { name: string; lastRunAt: string }[] };
  queues: { key: string; label: string; depth: number; oldestMinutes: number | null; level: "ok" | "attention" }[];
  integrations: { key: string; label: string; state: IntegrationState; note: string }[];
  env: { name: string; present: boolean; required: boolean; note: string }[];
  attention: string[];
};

const has = (env: Env, name: string) => typeof env[name] === "string" && env[name]!.length > 0;
const minutes = (from: Date, now: Date) => Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; } // never keep the error: a driver message can carry a connection string
}

/** Variables by name. `when` = required only while this flag is on; `always` = required in every deployment; neither = optional. */
const ENV_VARS: { name: string; always?: boolean; when?: string; anyOf?: string[]; note: string }[] = [
  { name: "DATABASE_URL", always: true, note: "Database the app reads and writes" },
  { name: "DIRECT_DATABASE_URL", always: true, note: "Owner connection used by the build to run migrations" },
  { name: "ENCRYPTION_KEY", always: true, note: "Decrypts stored integration credentials and partner fields; must be the same value as the original platform" },
  { name: "AUTH_SECRET", always: true, anyOf: ["AUTH_SECRET", "NEXTAUTH_SECRET"], note: "Signs sessions" },
  { name: "NEXTAUTH_URL", always: true, note: "Public address of this deployment" },
  { name: "CRON_SECRET", always: true, note: "Lets the scheduler call the tick route" },
  { name: "DAILY_REPORT_RECIPIENT_EMAIL", always: true, note: "Who receives the management reports" },
  { name: "WHATSAPP_WORKER_SECRET", always: true, note: "Lets the WhatsApp worker talk to this deployment" },
  { name: "META_WEBHOOK_VERIFY_TOKEN", always: true, note: "Verifies the lead-form webhook" },
  { name: "BLOB_READ_WRITE_TOKEN", anyOf: ["BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"], note: "File storage for documents" },
  { name: "APP_SIGNUP_SECRET", when: "REFERRAL_PROGRAM_ENABLED", note: "Signs the app sign-up webhook; the route answers 404 while unset" },
  { name: "REFERRAL_LINK_BASE", when: "REFERRAL_PROGRAM_ENABLED", note: "Address used in share links" },
  { name: "PORTFOLIO_FEED_SECRET", when: "PORTFOLIO_FEED_ENABLED", note: "Signs the portfolio feed" },
  { name: "BACKOFFICE_IMPORT_DIR", when: "BACKOFFICE_IMPORT_ENABLED", note: "Drop folder of the nightly import" },
  { name: "KEYCLOAK_ISSUER", when: "SSO_ENABLED", note: "Single sign-on provider address" },
  { name: "KEYCLOAK_CLIENT_ID", when: "SSO_ENABLED", note: "Single sign-on client" },
  { name: "KEYCLOAK_CLIENT_SECRET", when: "SSO_ENABLED", note: "Single sign-on client secret" },
  { name: "ANTHROPIC_API_KEY", note: "Quality audit and conversation insights (the reply pilot uses the key saved in Settings instead)" },
  { name: "OPENAI_API_KEY", note: "AI summaries" },
  { name: "FIREBASE_SERVICE_ACCOUNT_JSON", note: "Phone push notifications" },
  { name: "AGENT_API_KEY", note: "Agent briefing and outcome API" },
  { name: "AUDIT_ANCHOR_S3_BUCKET", note: "Write-once backup of the audit chain; never point a rehearsal at the real bucket" },
  { name: "AUDIT_ANCHOR_S3_REGION", note: "Region of that bucket" },
];

type IntegrationDef = { key: string; label: string; provider?: string; gate?: string[] };
const INTEGRATIONS: IntegrationDef[] = [
  { key: "freshdesk", label: "Freshdesk", provider: "freshdesk" },
  { key: "exotel", label: "Exotel calls", provider: "exotel" },
  { key: "clevertap", label: "CleverTap", provider: "clevertap", gate: ["CLEVERTAP_PUSH_ENABLED", "NEXT_PUBLIC_CLEVERTAP_CARD"] },
  { key: "clickup", label: "ClickUp", provider: "clickup" },
  { key: "jira", label: "Jira", provider: "jira" },
  { key: "meta_ads", label: "Meta Ads", provider: "meta_ads", gate: ["META_ADS_SYNC_ENABLED"] },
  { key: "google_ads", label: "Google Ads", provider: "google_ads", gate: ["GOOGLE_ADS_REPORTING_ENABLED"] },
  { key: "whatsapp_meta", label: "WhatsApp (Meta templates)", provider: "whatsapp_meta" },
  { key: "sms_exotel", label: "SMS", provider: "sms_exotel" },
  { key: "resend_email", label: "E-mail", provider: "resend_email" },
];

function rowState(def: IntegrationDef, rows: Map<string, { mode: string; isEnabled: boolean; hasCredentials: boolean }>, env: Env): { state: IntegrationState; note: string } {
  if (def.gate && !def.gate.some((g) => flagIsOn(env, g))) return { state: "flag_off", note: `Off: ${def.gate.join(" or ")} is not 1` };
  const row = def.provider ? rows.get(def.provider) : undefined;
  if (!row || row.mode !== "live") return { state: "mock", note: "Mock mode: no real calls are made" };
  if (!row.isEnabled || !row.hasCredentials) return { state: "needs_setup", note: row.hasCredentials ? "Live but disabled" : "Live but no credentials saved" };
  return { state: "connected", note: "Live, enabled, credentials saved (not tested here)" };
}

export async function collectSystemStatus(deps: StatusDeps, env: Env, now = new Date()): Promise<SystemStatus> {
  const attention: string[] = [];

  const commit = env.VERCEL_GIT_COMMIT_SHA && env.VERCEL_GIT_COMMIT_SHA.length >= 7 ? env.VERCEL_GIT_COMMIT_SHA : null;
  const app: SystemStatus["app"] = { commit, shortCommit: commit ? commit.slice(0, 7) : "unknown", branch: env.VERCEL_GIT_COMMIT_REF ?? null, deployEnv: env.VERCEL_ENV ?? "local", nodeEnv: env.NODE_ENV ?? "unknown" };

  const t0 = Date.now();
  const ping = await safe(() => deps.ping());
  const database: SystemStatus["database"] = ping ? { connected: true, name: ping.database, serverVersion: ping.serverVersion, latencyMs: Date.now() - t0 } : { connected: false, name: null, serverVersion: null, latencyMs: null };
  if (!ping) attention.push("The database cannot be reached.");

  const [mig, onDisk, beat, jobs, queue, rows, aiKey] = await Promise.all([
    safe(() => deps.migrations()), safe(() => deps.migrationsOnDisk()), safe(() => deps.heartbeatAgeMs()), safe(() => deps.dailyJobs()),
    safe(() => deps.queueFacts()), safe(() => deps.integrationRows()), safe(() => deps.aiKeySaved()),
  ]);

  let migrations: SystemStatus["migrations"] = null;
  if (mig) {
    const applied = new Set(mig.applied);
    const pending = onDisk ? onDisk.filter((n) => !applied.has(n)).length : null;
    migrations = { applied: mig.applied.length, failed: mig.failed, latest: [...mig.applied].sort().at(-1) ?? null, pending, onDisk: onDisk ? onDisk.length : null };
    if (mig.failed.length) attention.push(`A migration failed or is half-applied: ${mig.failed.join(", ")}.`);
    if (pending) attention.push(`${pending} migration${pending === 1 ? " is" : "s are"} pending.`);
  }

  const on = FLAGS.filter((x) => flagIsOn(env, x.name));
  const flags: SystemStatus["flags"] = {
    on: on.map((x) => ({ name: x.name, label: x.label, buildTime: x.buildTime })),
    off: FLAGS.filter((x) => !flagIsOn(env, x.name)).map((x) => x.name),
    settings: SETTINGS.filter((s) => has(env, s.name)).map((s) => ({ name: s.name, value: String(env[s.name]).slice(0, 120) })),
  };

  const ageMin = beat === null || beat === undefined ? null : Math.round(beat / 60_000);
  const tick: SystemStatus["cron"]["tick"] = !ping ? { state: "unknown", minutesAgo: null } : beat === null || beat === undefined ? { state: "never", minutesAgo: null } : { state: beat <= HEARTBEAT_STALE_MS ? "ticking" : "stale", minutesAgo: ageMin };
  if (tick.state === "stale") attention.push(`The scheduler has not ticked for ${tick.minutesAgo} minutes.`);
  if (tick.state === "never") attention.push("The scheduler has never ticked on this deployment.");
  const cron: SystemStatus["cron"] = { tick, jobs: (jobs ?? []).map((j) => ({ name: j.name, lastRunAt: j.at.toISOString() })) };

  const queues: SystemStatus["queues"] = [];
  if (queue) {
    const q = (key: string, label: string, depth: number, oldest: Date | null, limitMin: number | null) => {
      const oldestMinutes = oldest ? minutes(oldest, now) : null;
      const level = limitMin !== null && depth > 0 && oldestMinutes !== null && oldestMinutes > limitMin ? "attention" : "ok";
      queues.push({ key, label, depth, oldestMinutes, level });
      if (level === "attention") attention.push(`${label}: the oldest item has waited ${oldestMinutes} minutes.`);
    };
    q("whatsapp_outbox", "WhatsApp messages waiting to send", queue.whatsappQueued.n, queue.whatsappQueued.oldest, 15);
    q("agent_drafts", "Agent drafts waiting for review", queue.draftsWaiting.n, queue.draftsWaiting.oldest, null);
    q("review_backlog", "Conversation reviews waiting for analysis", queue.reviewsBacklog.n, queue.reviewsBacklog.oldest, 120);
    queues.push({ key: "lead_errors", label: "Lead intake errors, last 7 days", depth: queue.leadErrors7d, oldestMinutes: null, level: queue.leadErrors7d > 0 ? "attention" : "ok" });
    if (queue.leadErrors7d > 0) attention.push(`${queue.leadErrors7d} lead intake error${queue.leadErrors7d === 1 ? "" : "s"} in the last 7 days.`);
    queues.push({ key: "merge_open", label: "Open duplicate suggestions", depth: queue.mergeOpen, oldestMinutes: null, level: "ok" });
  }

  const rowMap = new Map((rows ?? []).map((r) => [r.provider, r]));
  const integrations: SystemStatus["integrations"] = INTEGRATIONS.map((d) => ({ key: d.key, label: d.label, ...rowState(d, rowMap, env) }));
  const sso = !flagIsOn(env, "SSO_ENABLED") ? { state: "flag_off" as const, note: "Off: SSO_ENABLED is not 1" } : ["KEYCLOAK_ISSUER", "KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT_SECRET"].every((n) => has(env, n)) ? { state: "connected" as const, note: "Enabled with its three settings (not tested here)" } : { state: "needs_setup" as const, note: "Enabled but a KEYCLOAK_* setting is missing" };
  const envState = (present: boolean, okNote: string, missNote: string) => (present ? { state: "connected" as const, note: okNote } : { state: "needs_setup" as const, note: missNote });
  integrations.push(
    { key: "sso", label: "Single sign-on", ...sso },
    { key: "ai_pilot_key", label: "AI key for the reply pilot", ...(aiKey ? { state: "connected" as const, note: "An Admin saved a key in Settings" } : { state: "needs_setup" as const, note: "No key saved in Settings (the pilot stays off)" }) },
    { key: "app_signup", label: "App sign-up webhook", ...envState(has(env, "APP_SIGNUP_SECRET"), "Secret set", "APP_SIGNUP_SECRET not set: the route answers 404") },
    { key: "cron_trigger", label: "Scheduler trigger", ...(tick.state === "ticking" ? { state: "connected" as const, note: `Last tick ${tick.minutesAgo} minutes ago` } : { state: "needs_setup" as const, note: has(env, "CRON_SECRET") ? "Secret set but no recent tick" : "CRON_SECRET not set" }) },
    { key: "push", label: "Phone push (Firebase)", ...envState(has(env, "FIREBASE_SERVICE_ACCOUNT_JSON"), "Credentials set", "No Firebase credentials: push is a no-op") },
    { key: "audit_anchor", label: "Audit chain backup (S3)", ...envState(has(env, "AUDIT_ANCHOR_S3_BUCKET") && has(env, "AUDIT_ANCHOR_S3_REGION"), "Bucket and region set", "Not configured: the chain is not backed up off-site") },
  );

  const envRows: SystemStatus["env"] = ENV_VARS.map((v) => {
    const present = (v.anyOf ?? [v.name]).some((n) => has(env, n));
    const required = !!v.always || (!!v.when && flagIsOn(env, v.when));
    if (required && !present) attention.push(`${v.name} is not set.`);
    return { name: v.name, present, required, note: v.note };
  });

  return { generatedAt: now.toISOString(), app, database, migrations, flags, cron, queues, integrations, env: envRows, attention };
}
