// The 18:00 IST RM evening email: the day's calls, follow-ups, tasks, new clients and stage moves. Runs from the cron
// tick (scheduled: true, only inside the window) and from tests. On unless DAILY_BRIEF_EVENING_ENABLED=0.
//
// The rules are the morning brief's (job.ts), applied to the evening channel:
// - Idempotency: before sending, the job claims a DailyBriefLog row for (rm, IST date, "evening"). A "sent" or "pending"
//   row blocks any second send that day; "failed" rows can be claimed again; a "pending" row is never retried or expired.
// - Own channel: "evening" is separate from the morning's "email", so the two sends never block each other. The morning
//   idempotency key is not reused.
// - Dry run: builds and counts only. It never claims or writes anything.
// - Opt-out: the same User.dailyBriefOptOut filter as the morning brief (listRms).
// - One RM failing never stops the others; the failure is recorded and counted.
// The send log, the email transport and the date helpers are shared with the morning brief (send-log.ts, sendgrid.ts).

import { istDateKey, istDayBoundaries, istShifted } from "@/lib/utils/ist-date";
import { buildEveningBrief, callFactFromPayload, summariseCalls, type EveningFacts } from "./evening-brief";
import { dateLabel, errorMessage, loadPrismaSendLog, type BriefRm, type PendingRm, type SendLog } from "./send-log";
import { sendBriefEmail, type BriefEmail } from "./sendgrid";

export const EVENING_CHANNEL = "evening";
const SEND_HOUR_IST = 18;
const SEND_MINUTES_IST = 5; // 18:00 to 18:04 inclusive

export type EveningCounts = {
  calls: number;
  answered: number;
  unanswered: number;
  talk_seconds: number;
  follow_ups_done: number;
  tasks_done: number;
  tasks_due: number;
  new_clients: number;
  stage_moves: number;
};
export type EveningStatus = "dry_run" | "sent" | "failed" | "already_done" | "error";

/** Raw rows for the day, grouped by RM id by the job. Only ids, categories, call payloads and counts: no names or phones. */
export type EveningRows = {
  calls: Array<{ rmId: string; payload: unknown }>;
  tasksDone: Array<{ rmId: string; category: string }>;
  tasksDue: Array<{ rmId: string }>;
  newClients: Array<{ rmId: string }>;
  stageMoves: Array<{ rmId: string; clientId: string }>;
};

export type EveningStore = SendLog & {
  /** The day's rows for these RMs, between `from` (inclusive) and `to` (exclusive). */
  loadRows(rmIds: string[], from: Date, to: Date): Promise<EveningRows>;
};

export type EveningBriefOptions = {
  now?: Date;
  /** Build and count only. Sends nothing and writes nothing. */
  dry?: boolean;
  /** Only this RM (id or email). */
  rm?: string | null;
  /** From the cron tick: does nothing outside the 18:00 to 18:04 IST window, Monday to Saturday. */
  scheduled?: boolean;
  env?: Record<string, string | undefined>;
  store?: EveningStore;
  send?: (mail: BriefEmail) => Promise<unknown>;
};

export type EveningBriefResult =
  | { skipped: "flag off" | "outside send window" }
  | { error: string }
  | {
      dryRun: boolean;
      date: string;
      results: Array<{ rmId: string; status: EveningStatus; error?: string } & EveningCounts>;
      /** RMs with a "pending" evening row for today. Never retried by the job; listed for an admin to check. */
      pending: PendingRm[];
    };

/** On unless DAILY_BRIEF_EVENING_ENABLED is exactly "0" (default on in code, per the owner rule). */
export function eveningBriefEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DAILY_BRIEF_EVENING_ENABLED !== "0";
}

/** True only at 18:00 to 18:04 IST on Monday to Saturday. */
export function inEveningWindow(now: Date): boolean {
  const ist = istShifted(now);
  return ist.getUTCDay() !== 0 && ist.getUTCHours() === SEND_HOUR_IST && ist.getUTCMinutes() < SEND_MINUTES_IST;
}

export async function runEveningBrief(opts: EveningBriefOptions = {}): Promise<EveningBriefResult> {
  const env = opts.env ?? process.env;
  if (!eveningBriefEnabled(env)) return { skipped: "flag off" };

  const now = opts.now ?? new Date();
  if (opts.scheduled && !inEveningWindow(now)) return { skipped: "outside send window" };

  // Links must point at the configured app. No VERCEL_URL fallback: that is a preview host.
  const appUrl = (env.NEXTAUTH_URL ?? "").trim().replace(/\/+$/, "");
  if (!appUrl) return { error: "NEXTAUTH_URL is not set; the brief's links need the app base URL" };

  const dry = opts.dry === true;
  let send = opts.send;
  if (!dry && !send) {
    const apiKey = env.SENDGRID_API_KEY;
    const from = env.BRIEF_FROM;
    if (!apiKey || !from) return { error: "SENDGRID_API_KEY and BRIEF_FROM must be set to send the brief" };
    send = (mail) => sendBriefEmail(mail, { apiKey, from });
  }

  const store = opts.store ?? (await loadEveningStore());
  const date = istDateKey(now);
  const label = dateLabel(now);
  const { dayStart, dayEnd } = istDayBoundaries(now);
  const pending = await store.listPending(date, EVENING_CHANNEL);

  const rms = await store.listRms(opts.rm ?? null);
  if (!rms.length) return { dryRun: dry, date, results: [], pending };
  const rows = await store.loadRows(rms.map((r) => r.id), dayStart, dayEnd);

  const results: Array<{ rmId: string; status: EveningStatus; error?: string } & EveningCounts> = [];
  for (const rm of rms) {
    // One RM failing (bad row, DB hiccup) must not stop the others. The failure is recorded and counted.
    try {
      const { facts, counts } = factsFor(rm, rows, label, appUrl);
      const mail = buildEveningBrief(facts);

      if (dry) {
        results.push({ rmId: rm.id, status: "dry_run", ...counts });
        continue;
      }

      const claimed = await store.claim(rm.id, date, EVENING_CHANNEL, counts);
      if (!claimed) {
        results.push({ rmId: rm.id, status: "already_done", ...counts });
        continue;
      }
      try {
        await send!({ to: rm.email, subject: mail.subject, html: mail.html, text: mail.text });
        await store.finish(rm.id, date, EVENING_CHANNEL, "sent", counts, null);
        results.push({ rmId: rm.id, status: "sent", ...counts });
      } catch (e) {
        const message = errorMessage(e);
        await store.finish(rm.id, date, EVENING_CHANNEL, "failed", counts, message);
        results.push({ rmId: rm.id, status: "failed", error: message, ...counts });
      }
    } catch (e) {
      console.error("Evening brief: RM failed", rm.id, errorMessage(e));
      results.push({ rmId: rm.id, status: "error", error: errorMessage(e), ...zeroCounts() });
    }
  }

  return { dryRun: dry, date, results, pending };
}

const zeroCounts = (): EveningCounts => ({ calls: 0, answered: 0, unanswered: 0, talk_seconds: 0, follow_ups_done: 0, tasks_done: 0, tasks_due: 0, new_clients: 0, stage_moves: 0 });

/** One RM's facts for the day, from the grouped rows, with the counts that go into the send log. */
export function factsFor(rm: BriefRm, rows: EveningRows, label: string, appUrl: string): { facts: EveningFacts; counts: EveningCounts } {
  const mine = <T extends { rmId: string }>(list: T[]) => list.filter((x) => x.rmId === rm.id);
  const callFacts = mine(rows.calls).map((c) => callFactFromPayload(c.payload));
  const calls = summariseCalls(callFacts);
  const tasksDone = mine(rows.tasksDone);
  const facts: EveningFacts = {
    rmName: rm.name,
    dateLabel: label,
    appUrl,
    calls: callFacts,
    followUpsDone: tasksDone.filter((t) => t.category === "FOLLOW_UP").length,
    tasksDone: tasksDone.length,
    tasksDue: mine(rows.tasksDue).length,
    newClients: mine(rows.newClients).length,
    stageMoves: new Set(mine(rows.stageMoves).map((m) => m.clientId)).size,
  };
  const counts: EveningCounts = {
    calls: calls.total,
    answered: calls.answered,
    unanswered: calls.unanswered,
    talk_seconds: calls.talkSeconds,
    follow_ups_done: facts.followUpsDone,
    tasks_done: facts.tasksDone,
    tasks_due: facts.tasksDue,
    new_clients: facts.newClients,
    stage_moves: facts.stageMoves,
  };
  return { facts, counts };
}

/** The real store. Loaded lazily so importing this module (the cron tick does) never touches the database. */
async function loadEveningStore(): Promise<EveningStore> {
  const { prisma } = await import("@/lib/db/prisma");

  return {
    ...(await loadPrismaSendLog()),

    async loadRows(rmIds, from, to) {
      const inRange = { gte: from, lt: to };
      const [calls, done, due, clients, moves] = await Promise.all([
        // A call is one CALL activity. Outbound click-to-call, device calls and webhook calls are all logged this way,
        // so counting activities (not CallSession rows) counts each call once. An activity with no user belongs to the
        // client's RM.
        prisma.activity.findMany({
          where: {
            type: "CALL",
            createdAt: inRange,
            client: { isDeleted: false },
            OR: [{ userId: { in: rmIds } }, { userId: null, client: { assignedToId: { in: rmIds } } }],
          },
          select: { userId: true, payload: true, client: { select: { assignedToId: true } } },
        }),
        prisma.task.findMany({
          where: { assignedToId: { in: rmIds }, status: "DONE", updatedAt: inRange },
          select: { assignedToId: true, category: true },
        }),
        prisma.task.findMany({
          where: { assignedToId: { in: rmIds }, dueAt: inRange, status: { not: "CANCELLED" } },
          select: { assignedToId: true },
        }),
        prisma.client.findMany({
          where: { assignedToId: { in: rmIds }, createdAt: inRange, isDeleted: false, mergedIntoId: null },
          select: { assignedToId: true },
        }),
        prisma.stageHistory.findMany({
          where: { changedById: { in: rmIds }, changedAt: inRange },
          select: { changedById: true, clientId: true },
        }),
      ]);

      const wanted = new Set(rmIds);
      const rmOf = (id: string | null | undefined) => (id && wanted.has(id) ? id : null);
      return {
        calls: calls.flatMap((c) => {
          const rmId = rmOf(c.userId) ?? rmOf(c.client.assignedToId);
          return rmId ? [{ rmId, payload: c.payload }] : [];
        }),
        tasksDone: done.flatMap((t) => (rmOf(t.assignedToId) ? [{ rmId: t.assignedToId, category: t.category }] : [])),
        tasksDue: due.flatMap((t) => (rmOf(t.assignedToId) ? [{ rmId: t.assignedToId }] : [])),
        newClients: clients.flatMap((c) => (rmOf(c.assignedToId) ? [{ rmId: c.assignedToId as string }] : [])),
        stageMoves: moves.flatMap((m) => (rmOf(m.changedById) ? [{ rmId: m.changedById, clientId: m.clientId }] : [])),
      };
    },
  };
}
