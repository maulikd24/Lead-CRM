/** Pure view logic for the merged Co-pilot table: filter, sort and page one list. No React, no database. */
export const COPILOT_PAGE_SIZE = 25;

export const PRIORITIES = ["High", "Medium", "Low"] as const;
export const OWNERS = ["RM", "CRM", "AI Bot", "Support"] as const;
export const TIMINGS = ["Today", "This Week", "Later", "Trigger-based"] as const;
export const SORT_KEYS = ["score", "priority", "client", "stage", "owner", "when"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type CopilotRow = {
  clientId: string;
  name: string;
  code: string;
  stage: string;
  rm: string | null;
  /** From the worklist scoring; null when the customer is only in the intelligence list. */
  health: "HEALTHY" | "AT_RISK" | "CRITICAL" | null;
  score: number;
  /** High / Medium / Low from the next-best-action; null when only in the worklist. */
  priority: (typeof PRIORITIES)[number] | null;
  owner: string | null;
  when: string | null;
  /** Next best action headline and the reason for it. */
  action: string;
  why: string;
};

export type CopilotQuery = {
  priority?: string;
  owner?: string;
  timing?: string;
  stage?: string;
  rm?: string;
  critical?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

const PRIORITY_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

function sortValue(row: CopilotRow, key: SortKey): number | string {
  switch (key) {
    case "score": return row.score;
    case "priority": return row.priority ? PRIORITY_RANK[row.priority] : 0;
    case "client": return row.name.toLowerCase();
    case "stage": return row.stage.toLowerCase();
    case "owner": return row.owner ?? "";
    case "when": return row.when ? TIMINGS.indexOf(row.when as (typeof TIMINGS)[number]) + 1 : 99;
  }
}

export function parseSort(q: CopilotQuery): { key: SortKey; dir: "asc" | "desc" } {
  const key = (SORT_KEYS as readonly string[]).includes(q.sort ?? "") ? (q.sort as SortKey) : "score";
  const dir = q.dir === "asc" || q.dir === "desc" ? q.dir : key === "score" || key === "priority" ? "desc" : "asc";
  return { key, dir };
}

export function applyCopilotView(rows: readonly CopilotRow[], q: CopilotQuery, pageSize = COPILOT_PAGE_SIZE) {
  const filtered = rows.filter(
    (r) =>
      (!q.priority || r.priority === q.priority) &&
      (!q.owner || r.owner === q.owner) &&
      (!q.timing || r.when === q.timing) &&
      (!q.stage || r.stage === q.stage) &&
      (!q.rm || r.rm === q.rm) &&
      (q.critical !== "1" || r.health === "CRITICAL"),
  );
  const { key, dir } = parseSort(q);
  const sign = dir === "asc" ? 1 : -1;
  // Ties break on score then client id so a customer can never move between pages when the same page is reloaded.
  const sorted = [...filtered].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x !== y) return (x < y ? -1 : 1) * sign;
    return b.score - a.score || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0);
  });
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(pages, Math.max(1, Number(q.page) || 1));
  const start = (page - 1) * pageSize;
  return { total: sorted.length, page, pages, start, rows: sorted.slice(start, start + pageSize) };
}

/** One row per customer: the worklist row supplies health and score, the intelligence row supplies priority, owner and timing. */
export function mergeCopilotRows(worklist: readonly CopilotRow[], intelligence: readonly CopilotRow[]): CopilotRow[] {
  const byId = new Map<string, CopilotRow>();
  for (const r of worklist) byId.set(r.clientId, r);
  for (const r of intelligence) {
    const w = byId.get(r.clientId);
    byId.set(r.clientId, w ? { ...w, priority: r.priority, owner: r.owner, when: r.when, action: r.action, why: r.why, score: Math.max(w.score, r.score) } : r);
  }
  return [...byId.values()];
}
