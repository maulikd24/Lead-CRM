import { addQuarters, differenceInCalendarDays, endOfQuarter, format, getQuarter, startOfQuarter } from "date-fns";

/** A calendar quarter (Jan–Mar = Q1), as local-time bounds. */
export type Quarter = { start: Date; end: Date; key: string; label: string };

export function quarterOf(date: Date): Quarter {
  const start = startOfQuarter(date);
  return { start, end: endOfQuarter(date), key: `${format(start, "yyyy")}-Q${getQuarter(start)}`, label: `Q${getQuarter(start)} ${format(start, "yyyy")}` };
}

/** "2026-Q4" → that quarter; anything malformed → null. */
export function parseQuarterKey(key: string | undefined | null): Quarter | null {
  const m = key?.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  return quarterOf(new Date(Number(m[1]), (Number(m[2]) - 1) * 3, 1));
}

export function shiftQuarter(q: Quarter, n: number): Quarter {
  return quarterOf(addQuarters(q.start, n));
}

export type QuarterProgress = {
  /** Share of the target funded so far, 0–100+ (can pass 100). Null without a target. */
  pct: number | null;
  /** What's still needed; 0 once the target is met. */
  remaining: number;
  /** Calendar days left in the quarter, counting today; 0 once it's over. */
  daysLeft: number;
  /** Funding needed per remaining day to hit the target; null without a target or once it's met or over. */
  perDayNeeded: number | null;
};

export function quarterProgress(funded: number, target: number, q: Quarter, now: Date): QuarterProgress {
  const daysLeft = now > q.end ? 0 : Math.max(0, differenceInCalendarDays(q.end, now < q.start ? q.start : now) + 1);
  const remaining = Math.max(0, target - funded);
  return {
    pct: target > 0 ? Math.round((funded / target) * 100) : null,
    remaining,
    daysLeft,
    perDayNeeded: target > 0 && remaining > 0 && daysLeft > 0 ? remaining / daysLeft : null,
  };
}

export type LeaderboardRow = { rmId: string; name: string; funded: number; target: number };

/** Highest funded first; equal amounts share a rank (1, 2, 2, 4). */
export function rankRows(rows: LeaderboardRow[]): (LeaderboardRow & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.funded - a.funded || a.name.localeCompare(b.name));
  return sorted.map((row) => ({ ...row, rank: sorted.findIndex((r) => r.funded === row.funded) + 1 }));
}

/**
 * What a viewer may see of the quarter's leaderboard. Managers and Admins see every RM in their scope. An RM sees only their own
 * row and where it ranks among all RMs — never anyone else's name or numbers.
 */
export function leaderboardFor(
  viewer: { id: string; role: string },
  scopeRows: LeaderboardRow[],
  allRmRows: LeaderboardRow[],
): { kind: "team"; rows: (LeaderboardRow & { rank: number })[] } | { kind: "self"; row: (LeaderboardRow & { rank: number }) | null; of: number } {
  if (viewer.role !== "RM") return { kind: "team", rows: rankRows(scopeRows) };
  const ranked = rankRows(allRmRows);
  return { kind: "self", row: ranked.find((r) => r.rmId === viewer.id) ?? null, of: ranked.length };
}
