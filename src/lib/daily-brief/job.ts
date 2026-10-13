// The 09:00 IST RM daily brief. Runs from the cron tick (scheduled: true, only inside the send window) and from the
// internal route (manual dry runs and tests). Off unless DAILY_BRIEF_ENABLED=1.
//
// Idempotency: before sending, the job claims a DailyBriefLog row for (rm, IST date, channel). A row that is already
// "sent" or "pending" blocks any second send for that day. "failed" and "skipped_empty" rows can be claimed again.
// A "pending" row is never retried or expired automatically (a crash may have sent the email). The result lists the
// RMs with a pending row for today so an admin can check them. A dry run never claims or writes anything.

import { isReferralLeadSource } from "@/lib/stage-engine/sla-status";
import { istDateKey, istDayBoundaries, istShifted } from "@/lib/utils/ist-date";
import { buildBrief, type BriefClient } from "./rm-brief";
import { sendBriefEmail, type BriefEmail } from "./sendgrid";
import { dateLabel, errorMessage, loadPrismaSendLog, type BriefRm, type BriefStatus, type PendingRm, type SendLog } from "./send-log";

export type { BriefRm, BriefStatus, PendingRm } from "./send-log";

export const BRIEF_CHANNEL = "email";
const SEND_HOUR_IST = 9;
const SEND_MINUTES_IST = 5; // 09:00 to 09:04 inclusive
const NEW_LEAD_WINDOW_MS = 24 * 60 * 60 * 1000;

export type BriefCounts = { overdue: number; due_today: number; new_leads: number };

/** One open client, with what the job needs to compute its SLA due time. */
export type OpenClientRow = {
  id: string;
  rmId: string;
  name: string;
  phone: string | null;
  stage: string;
  source: string | null;
  stageEnteredAt: Date;
  slaHours: number;
  createdAt: Date;
};

export type BriefStore = SendLog & {
  /** Active, non-deleted, not-merged clients assigned to these RMs. */
  listOpenClients(rmIds: string[]): Promise<OpenClientRow[]>;
};

export type DailyBriefOptions = {
  now?: Date;
  /** Build and count only. Sends nothing and writes nothing. */
  dry?: boolean;
  /** Only this RM (id or email). */
  rm?: string | null;
  /** From the cron tick: does nothing outside the 09:00 to 09:04 IST window, Monday to Saturday. */
  scheduled?: boolean;
  env?: Record<string, string | undefined>;
  store?: BriefStore;
  send?: (mail: BriefEmail) => Promise<unknown>;
};

export type DailyBriefResult =
  | { skipped: "flag off" | "outside send window" }
  | { error: string }
  | {
      dryRun: boolean;
      date: string;
      results: Array<{ rmId: string; status: BriefStatus; error?: string } & BriefCounts>;
      /**
       * RMs with a "pending" row for today. A pending row may mean a send is in flight or that a crash happened after
       * the email went out, so the job never retries it and never expires it. Listed so an admin can check them.
       */
      pending: PendingRm[];
    };

export function dailyBriefEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DAILY_BRIEF_ENABLED === "1";
}

/** True only at 09:00 to 09:04 IST on Monday to Saturday. */
export function inBriefWindow(now: Date): boolean {
  const ist = istShifted(now);
  return ist.getUTCDay() !== 0 && ist.getUTCHours() === SEND_HOUR_IST && ist.getUTCMinutes() < SEND_MINUTES_IST;
}

/** Splits one RM's open clients into the brief's three sections. Overdue and due-today come from the stage SLA. */
export function partitionClients(rows: OpenClientRow[], now: Date): { overdue: BriefClient[]; dueToday: BriefClient[]; newLeads: BriefClient[] } {
  const nowMs = now.getTime();
  const endOfTodayMs = istDayBoundaries(now).dayEnd.getTime() - 1;
  const withDue = rows.map((r) => {
    // Same rule as the stage SLA sweep: slaHours 0 (e.g. the final stage) and referral leads have no SLA clock.
    const dueMs = r.slaHours > 0 && !isReferralLeadSource(r.source) ? r.stageEnteredAt.getTime() + r.slaHours * 3_600_000 : null;
    const client: BriefClient = {
      id: r.id,
      name: r.name,
      phone: r.phone,
      stage: r.stage,
      source: r.source,
      slaDueAt: dueMs === null ? null : new Date(dueMs),
      createdAt: r.createdAt,
    };
    return { client, dueMs, createdMs: r.createdAt.getTime() };
  });

  const overdue = withDue.filter((x) => x.dueMs !== null && x.dueMs < nowMs).sort((a, b) => a.dueMs! - b.dueMs!);
  const dueToday = withDue
    .filter((x) => x.dueMs !== null && x.dueMs >= nowMs && x.dueMs <= endOfTodayMs)
    .sort((a, b) => a.dueMs! - b.dueMs!);
  const taken = new Set([...overdue, ...dueToday].map((x) => x.client.id));
  const newLeads = withDue
    .filter((x) => !taken.has(x.client.id) && x.createdMs >= nowMs - NEW_LEAD_WINDOW_MS)
    .sort((a, b) => b.createdMs - a.createdMs);

  return { overdue: overdue.map((x) => x.client), dueToday: dueToday.map((x) => x.client), newLeads: newLeads.map((x) => x.client) };
}

export async function runDailyBrief(opts: DailyBriefOptions = {}): Promise<DailyBriefResult> {
  const env = opts.env ?? process.env;
  if (!dailyBriefEnabled(env)) return { skipped: "flag off" };

  const now = opts.now ?? new Date();
  if (opts.scheduled && !inBriefWindow(now)) return { skipped: "outside send window" };

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

  const store = opts.store ?? (await loadPrismaStore());
  const date = istDateKey(now);
  const label = dateLabel(now);
  const pending = await store.listPending(date, BRIEF_CHANNEL);

  const rms = await store.listRms(opts.rm ?? null);
  if (!rms.length) return { dryRun: dry, date, results: [], pending };
  const clients = await store.listOpenClients(rms.map((r) => r.id));

  const results: Array<{ rmId: string; status: BriefStatus; error?: string } & BriefCounts> = [];
  for (const rm of rms) {
    // One RM failing (bad row, DB hiccup) must not stop the others. The failure is recorded and counted.
    try {
      const mine = clients.filter((c) => c.rmId === rm.id);
      const sections = partitionClients(mine, now);
      const counts: BriefCounts = { overdue: sections.overdue.length, due_today: sections.dueToday.length, new_leads: sections.newLeads.length };
      const brief = buildBrief({ rmName: rm.name, dateLabel: label, appUrl, ...sections });

      if (dry) {
        results.push({ rmId: rm.id, status: "dry_run", ...counts });
        continue;
      }

      const claimed = await store.claim(rm.id, date, BRIEF_CHANNEL, counts);
      if (!claimed) {
        results.push({ rmId: rm.id, status: "already_done", ...counts });
        continue;
      }
      if (brief.total === 0) {
        await store.finish(rm.id, date, BRIEF_CHANNEL, "skipped_empty", counts, null);
        results.push({ rmId: rm.id, status: "skipped_empty", ...counts });
        continue;
      }
      try {
        await send!({ to: rm.email, subject: brief.subject, html: brief.html, text: brief.text });
        await store.finish(rm.id, date, BRIEF_CHANNEL, "sent", counts, null);
        results.push({ rmId: rm.id, status: "sent", ...counts });
      } catch (e) {
        const message = errorMessage(e);
        await store.finish(rm.id, date, BRIEF_CHANNEL, "failed", counts, message);
        results.push({ rmId: rm.id, status: "failed", error: message, ...counts });
      }
    } catch (e) {
      console.error("Daily brief: RM failed", rm.id, errorMessage(e));
      results.push({ rmId: rm.id, status: "error", error: errorMessage(e), overdue: 0, due_today: 0, new_leads: 0 });
    }
  }

  return { dryRun: dry, date, results, pending };
}

/** The real store. Loaded lazily so importing this module (the cron tick does) never touches the database. */
async function loadPrismaStore(): Promise<BriefStore> {
  const { prisma } = await import("@/lib/db/prisma");

  return {
    ...(await loadPrismaSendLog()),

    async listOpenClients(rmIds) {
      const rows = await prisma.client.findMany({
        where: { assignedToId: { in: rmIds }, status: "ACTIVE", isDeleted: false, mergedIntoId: null },
        select: {
          id: true,
          name: true,
          mobile: true,
          leadSource: true,
          createdAt: true,
          stageEnteredAt: true,
          assignedToId: true,
          currentStage: { select: { name: true, slaHours: true } },
        },
      });
      return rows.flatMap((r) =>
        r.assignedToId
          ? [
              {
                id: r.id,
                rmId: r.assignedToId,
                name: r.name,
                phone: r.mobile,
                stage: r.currentStage.name,
                source: r.leadSource,
                stageEnteredAt: r.stageEnteredAt,
                slaHours: r.currentStage.slaHours,
                createdAt: r.createdAt,
              },
            ]
          : [],
      );
    },
  };
}
