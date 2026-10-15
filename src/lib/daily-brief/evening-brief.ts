// Builds the evening RM email (subject, HTML and plain text) for one RM: the day's numbers, IST.
// Pure function: no I/O, no database, no clock. The facts are counts and call durations only (no client names, phone
// numbers or other personal details), so nothing identifying can reach the email. The one link goes to the CRM, built
// from the configured app base URL the caller supplies (the same one the morning brief uses).

import { parseCallPayload } from "@/lib/calls/view-model";

/** The direction a call was logged with: outbound (we dialled), inbound (they dialled), missed, or unknown. */
export type CallDirection = "outbound" | "inbound" | "missed" | "unknown";

/** One call logged today (an Activity of type CALL). */
export type CallFact = { direction: CallDirection; durationSeconds: number };

export type EveningFacts = {
  rmName: string;
  dateLabel: string; // e.g. "Tue, 13 Oct"
  appUrl: string; // configured app base URL, e.g. https://crm.example.com
  calls: CallFact[];
  /** Follow-up tasks (category FOLLOW_UP) completed today. */
  followUpsDone: number;
  /** Tasks completed today, all categories. */
  tasksDone: number;
  /** Tasks due today that were not cancelled. */
  tasksDue: number;
  /** Clients assigned to the RM today. */
  newClients: number;
  /** Distinct clients the RM moved to a new stage today. */
  stageMoves: number;
};

export type CallSummary = {
  total: number;
  outbound: number;
  inbound: number;
  missed: number;
  /** Connected: not missed, with a talk time above zero. */
  answered: number;
  unanswered: number;
  talkSeconds: number;
};

export type EveningBrief = { subject: string; html: string; text: string };

/** Counts today's calls. A call is answered when it was not missed and has a talk time above zero. */
export function summariseCalls(calls: CallFact[]): CallSummary {
  const summary: CallSummary = { total: calls.length, outbound: 0, inbound: 0, missed: 0, answered: 0, unanswered: 0, talkSeconds: 0 };
  for (const call of calls) {
    if (call.direction === "outbound") summary.outbound += 1;
    if (call.direction === "inbound") summary.inbound += 1;
    if (call.direction === "missed") summary.missed += 1;
    if (call.direction !== "missed" && call.durationSeconds > 0) {
      summary.answered += 1;
      summary.talkSeconds += call.durationSeconds;
    } else {
      summary.unanswered += 1;
    }
  }
  return summary;
}

/** Turns the call rows' raw payloads into facts. Uses the same parser as the calls screen, so the two never disagree. */
export function callFactFromPayload(payload: unknown): CallFact {
  const parsed = parseCallPayload(payload);
  return { direction: parsed.direction, durationSeconds: parsed.durationSeconds };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** "45m 10s" under an hour, "1h 05m" from an hour on. */
export function formatTalkTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildEveningBrief(f: EveningFacts): EveningBrief {
  const calls = summariseCalls(f.calls);
  const first = f.rmName.trim().split(/\s+/)[0] || "there";
  const base = f.appUrl.replace(/\/+$/, "");
  const subject = `Your evening wrap: ${plural(calls.total, "call")}, ${f.tasksDone} of ${f.tasksDue} tasks · ${f.dateLabel}`;

  const rows: Array<{ title: string; accent: string; lines: string[] }> = [
    {
      title: "Calls",
      accent: "#1f6f54",
      lines: [
        `${plural(calls.total, "call")} today: ${calls.outbound} outbound, ${calls.inbound} inbound`,
        `${calls.answered} answered, ${calls.unanswered} unanswered`,
        `Talk time ${formatTalkTime(calls.talkSeconds)}`,
      ],
    },
    {
      title: "Follow-ups and tasks",
      accent: "#b45309",
      lines: [`${f.followUpsDone} follow-up${f.followUpsDone === 1 ? "" : "s"} completed`, `${f.tasksDone} of ${f.tasksDue} tasks due today completed`],
    },
    {
      title: "New clients assigned",
      accent: "#c2410c",
      lines: [`${plural(f.newClients, "new client")} assigned today`],
    },
    {
      title: "Stage moves",
      accent: "#141816",
      lines: [`${plural(f.stageMoves, "client")} moved to a new stage`],
    },
  ];

  const section = (r: (typeof rows)[number]) => `
      <tr><td style="padding:24px 0 4px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${r.accent};margin-right:8px;"></span>
        <span style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6b6f6c;font-weight:600;">${esc(r.title)}</span>
      </td></tr>
      <tr><td style="padding:6px 0 8px;border-bottom:1px solid #ece9e2;">
        ${r.lines.map((l) => `<div style="font-size:15px;color:#2b2f2d;padding:3px 0;">${esc(l)}</div>`).join("")}
      </td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;padding:24px 12px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px;">
      <tr><td style="font-size:12px;color:#6b6f6c;letter-spacing:.08em;text-transform:uppercase;">Allvest · Evening wrap · ${esc(f.dateLabel)}</td></tr>
      <tr><td style="padding-top:8px;font-size:22px;font-weight:600;color:#141816;">Good evening, ${esc(first)}.</td></tr>
      <tr><td style="padding-top:6px;font-size:15px;color:#2b2f2d;">Here is how today went, so far.</td></tr>
      ${rows.map(section).join("")}
      <tr><td style="padding-top:28px;">
        <a href="${base}/clients" style="display:inline-block;background:#141816;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;">Open my clients</a>
      </td></tr>
      <tr><td style="padding-top:20px;font-size:12px;color:#9a9d9b;">Sent automatically at 6:00 PM IST, Mon–Sat. Figures cover today (IST).</td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    `Good evening, ${first}. Here is how today went, so far.`,
    ...rows.flatMap((r) => ["", r.title.toUpperCase(), ...r.lines.map((l) => `- ${l}`)]),
    "",
    `Open: ${base}/clients`,
  ].join("\n");

  return { subject, html, text };
}
