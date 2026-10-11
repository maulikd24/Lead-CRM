import type { SystemStatus } from "./status";

/**
 * The post-cutover checklist an Admin works through after the production address is switched to a new deployment.
 * Automatic checks are computed from the live system status; the others are ticked by a person (who and when are kept).
 * Ticks live in the existing "GoLiveCheck" table under an id prefixed "cutover:", so they never clash with go-live items.
 */
export type CutoverCheck = {
  id: string;
  group: "System" | "People" | "Customers" | "Channels" | "Safety";
  title: string;
  how: string;
  auto?: (s: SystemStatus) => { ok: boolean; note: string };
};

export const cutoverItemId = (id: string) => `cutover:${id}`;

export const CUTOVER_CHECKS: CutoverCheck[] = [
  { id: "db-connected", group: "System", title: "The app reaches its database", how: "Computed from the live status.", auto: (s) => ({ ok: s.database.connected, note: s.database.connected ? `Connected to ${s.database.name}` : "The database cannot be reached" }) },
  {
    id: "migrations-clean", group: "System", title: "Every migration is applied and none failed", how: "Computed from the migration table.",
    auto: (s) => {
      if (!s.migrations) return { ok: false, note: "Migration state could not be read" };
      if (s.migrations.failed.length) return { ok: false, note: `Failed: ${s.migrations.failed.join(", ")}` };
      if (s.migrations.pending) return { ok: false, note: `${s.migrations.pending} pending` };
      return { ok: true, note: `${s.migrations.applied} applied${s.migrations.pending === null ? " (pending count unavailable here)" : ""}` };
    },
  },
  { id: "scheduler-ticking", group: "System", title: "The scheduler is ticking", how: "Computed from the last heartbeat; it should be a few minutes old.", auto: (s) => ({ ok: s.cron.tick.state === "ticking", note: s.cron.tick.state === "ticking" ? `Last tick ${s.cron.tick.minutesAgo} minutes ago` : `Scheduler is ${s.cron.tick.state}` }) },
  {
    id: "required-env", group: "System", title: "Every required setting is present", how: "Computed from the environment (names only).",
    auto: (s) => { const missing = s.env.filter((e) => e.required && !e.present).map((e) => e.name); return { ok: missing.length === 0, note: missing.length ? `Missing: ${missing.join(", ")}` : "All required settings are set" }; },
  },
  { id: "login-admin", group: "People", title: "An Admin can sign in and sees the dashboard", how: "Sign in on the production address with a real Admin account." },
  { id: "login-rm", group: "People", title: "A relationship manager signs in and sees only their own customers", how: "Ask one RM to sign in and open the customer list." },
  { id: "login-manager-partner", group: "People", title: "A manager, and a partner if partners are live, can sign in", how: "Check one account of each role that is in use." },
  { id: "customer-page", group: "Customers", title: "A customer page opens with its history, tasks and documents", how: "Open a customer you know and compare it with what you expect." },
  { id: "counts-match", group: "Customers", title: "Customer and lead counts match the final snapshot", how: "Compare the Dashboard totals with the counts recorded when the snapshot was taken." },
  { id: "whatsapp-roundtrip", group: "Channels", title: "A WhatsApp message goes out and a reply comes back into the inbox", how: "Use a test number; look at the outbox on the system status page afterwards." },
  { id: "lead-intake", group: "Channels", title: "A test lead from each lead source arrives once, as one customer", how: "Submit one test lead per form or ad source and look for it under Customers." },
  { id: "support-webhook", group: "Channels", title: "A test support ticket appears on the customer", how: "Raise a ticket for a test customer in the support desk and wait for it." },
  { id: "app-signup", group: "Channels", title: "An app sign-up test reaches the app sign-up webhook (if the app is live)", how: "Create a test sign-up in a non-production app build; skip if not applicable." },
  { id: "report-email", group: "Channels", title: "The next scheduled management report e-mail arrives", how: "Check the report recipient's inbox after the next scheduled time." },
  { id: "audit-chain", group: "Safety", title: "The audit log chain verifies", how: "Look at the latest audit chain verification on the System Overview page." },
  { id: "old-frozen", group: "Safety", title: "The previous deployment is frozen and its snapshot is kept", how: "Confirm nobody is still writing to it and the final snapshot file is stored safely." },
  { id: "rollback-ready", group: "Safety", title: "The rollback step is written down and one person knows how to do it", how: "Read the rollback section of the cutover runbook out loud once." },
  { id: "people-told", group: "Safety", title: "Admins and relationship managers have been told the system is live", how: "Send the prepared message and note the time." },
];

export function autoResult(check: CutoverCheck, status: SystemStatus): { ok: boolean; note: string } {
  return check.auto ? check.auto(status) : { ok: false, note: "Ticked by a person" };
}

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

export function parseTickInput(id: unknown, done: unknown, note: unknown): Ok<{ id: string; done: boolean; note: string | null }> | Err {
  if (typeof id !== "string" || typeof done !== "boolean") return { ok: false, error: "Invalid request." };
  if (note !== undefined && note !== null && typeof note !== "string") return { ok: false, error: "Invalid request." };
  const n = typeof note === "string" ? note.trim() : "";
  if (n.length > 300) return { ok: false, error: "The note is too long (300 characters at most)." };
  return { ok: true, id, done, note: n || null };
}

export interface TickDb {
  upsert(itemId: string, v: { done: boolean; note: string | null; doneById: string | null; doneAt: Date | null }): Promise<void>;
  audit(e: { userId: string; entity: "CutoverCheck"; entityId: string; action: string; reason?: string }): Promise<void>;
}

export async function setCutoverTick(db: TickDb, actor: { id: string; role: string }, id: unknown, done: unknown, note: unknown, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  if (actor.role !== "ADMIN") return { ok: false, error: "Only an Admin can tick a check." };
  const p = parseTickInput(id, done, note);
  if (!p.ok) return p;
  const check = CUTOVER_CHECKS.find((c) => c.id === p.id);
  if (!check || check.auto) return { ok: false, error: "That check cannot be ticked by hand." };
  await db.upsert(cutoverItemId(check.id), p.done ? { done: true, note: p.note, doneById: actor.id, doneAt: now } : { done: false, note: null, doneById: null, doneAt: null });
  await db.audit({ userId: actor.id, entity: "CutoverCheck", entityId: check.id, action: p.done ? "cutover_check_ticked" : "cutover_check_unticked", reason: p.note ?? undefined });
  return { ok: true };
}
