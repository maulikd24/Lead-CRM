import { inr, pct } from "./stats";

/**
 * The weekly digest. Aggregates only (health, waste, open proposals, the top issues, the age of the data): no customer, no name, no contact. Two outputs:
 * an in-app notification for Admin and Marketing users, and a DRAFT email that nobody receives until a person approves it. Database, clock, notifications and
 * mail are injected. One digest per week (the week's Monday is the unique key), so a repeated or concurrent run creates and notifies once.
 */
export type DigestFacts = {
  weekStart: string;
  health: number | null;
  wastedSpend: number | null;
  wastedShare: number | null;
  totalSpend: number | null;
  open: number;
  newThisWeek: number;
  approvedWaiting: number;
  dataAge: string;
  top: { issue: string; impact: string }[];
};

export type DigestRow = { id: string; weekStart: string; correlationId: string; subject: string; body: string; status: "DRAFT" | "APPROVED" | "DISCARDED"; recipients: string[]; decidedById: string | null };

export type DigestDeps = {
  now: () => Date;
  facts: () => Promise<DigestFacts>;
  recipients: () => Promise<{ id: string; email: string }[]>;
  /** false when a digest for that week already exists (the unique key), so a race creates one. */
  insert: (row: DigestRow) => Promise<boolean>;
  exists: (weekStart: string) => Promise<boolean>;
  get: (id: string) => Promise<DigestRow | null>;
  /** Compare-and-set from DRAFT: exactly one caller wins. */
  claim: (id: string, to: "APPROVED" | "DISCARDED", byId: string) => Promise<boolean>;
  release: (id: string) => Promise<void>;
  notify: (userIds: string[], payload: Record<string, unknown>) => Promise<void>;
  send: (m: { to: string[]; subject: string; text: string }) => Promise<{ ok: boolean; error?: string }>;
  newId: () => string;
};

const IST_MS = 330 * 60_000;

/** Monday (YYYY-MM-DD) of the week of this instant, in India. */
export function weekStartOf(now: Date): string {
  const ist = new Date(now.getTime() + IST_MS);
  const dow = (ist.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - dow));
  return monday.toISOString().slice(0, 10);
}

/** Due from Monday 08:00 India time, once per week (a missed Monday is caught up the same week). */
export function shouldRunDigest(now: Date, alreadyThisWeek: boolean): boolean {
  if (alreadyThisWeek) return false;
  return now.getTime() >= Date.parse(`${weekStartOf(now)}T08:00:00+05:30`);
}

export function buildDigest(f: DigestFacts): { subject: string; body: string; inApp: { open: number; health: number | null } } {
  const lines = [
    `Autopilot weekly digest, week of ${f.weekStart}`,
    "",
    f.health === null ? "Health score: not enough data to score yet." : `Health score: ${f.health} out of 100.`,
    f.totalSpend === null || f.wastedSpend === null ? "Wasted spend: not enough data to estimate." : `Wasted spend: ${inr(f.wastedSpend)}${f.wastedShare === null ? "" : ` (${pct(f.wastedShare, 1)} of ${inr(f.totalSpend)} spent)`}.`,
    `Open proposals: ${f.open} (${f.newThisWeek} new this week). Approved and waiting to be applied: ${f.approvedWaiting}.`,
    `Data: ${f.dataAge}.`,
    "",
    f.top.length ? "Biggest issues:" : "No open issues.",
    ...f.top.map((t, i) => `${i + 1}. ${t.issue}${t.impact ? ` ${t.impact}.` : ""}`),
    "",
    "Autopilot only proposes. Nothing changes in an ad account until a person approves it and applying is switched on. Open /autopilot to decide.",
  ];
  return { subject: `Autopilot weekly digest: ${f.open} open proposal${f.open === 1 ? "" : "s"}, week of ${f.weekStart}`, body: lines.join("\n"), inApp: { open: f.open, health: f.health } };
}

export async function createWeeklyDigest(deps: DigestDeps): Promise<{ created: boolean; digestId?: string }> {
  const now = deps.now();
  const weekStart = weekStartOf(now);
  if (!shouldRunDigest(now, await deps.exists(weekStart))) return { created: false };
  const recipients = await deps.recipients();
  if (recipients.length === 0) return { created: false };
  const facts = await deps.facts();
  const d = buildDigest({ ...facts, weekStart });
  const row: DigestRow = { id: deps.newId(), weekStart, correlationId: `digest:${weekStart}`, subject: d.subject, body: d.body, status: "DRAFT", recipients: recipients.map((r) => r.id), decidedById: null };
  if (!(await deps.insert(row))) return { created: false };
  await deps.notify(row.recipients, { digestId: row.id, weekStart, ...d.inApp });
  return { created: true, digestId: row.id };
}

export async function decideDigest(deps: DigestDeps, input: { id: string; actorId: string; verdict: "approve" | "discard" }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.actorId) return { ok: false, error: "A person must decide." };
  const row = await deps.get(input.id);
  if (!row) return { ok: false, error: "That digest no longer exists." };
  if (!(await deps.claim(input.id, input.verdict === "approve" ? "APPROVED" : "DISCARDED", input.actorId))) return { ok: false, error: "This digest has already been decided." };
  if (input.verdict === "discard") return { ok: true };
  const emails = (await deps.recipients()).filter((r) => row.recipients.includes(r.id)).map((r) => r.email);
  const res = emails.length ? await deps.send({ to: emails, subject: row.subject, text: row.body }).catch(() => ({ ok: false, error: "mail failed" })) : { ok: false, error: "no recipient has an email address" };
  if (!res.ok) { await deps.release(input.id); return { ok: false, error: `The email was not sent (${res.error ?? "unknown error"}). The draft is back; try again.` }; }
  return { ok: true };
}
