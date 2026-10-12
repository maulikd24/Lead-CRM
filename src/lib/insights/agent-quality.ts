import { estimateUsageCost } from "./pricing";

/** One AgentProposal, reduced to the fields quality metrics need. Customer identity is deliberately not part of it. */
export type ProposalRow = {
  agentKey: string;
  status: "DRAFT" | "APPROVED" | "SENT" | "REJECTED" | "EXPIRED" | "BLOCKED";
  blockedReason: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  body: string;
  originalBody: string;
  programme: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedById: string | null;
  expiresAt: Date;
  messageId: string | null;
};

export type EditBucket = "none" | "light" | "moderate" | "heavy";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Levenshtein distance. Strips the shared prefix and suffix first; very large leftovers fall back to the upper bound. */
export function editDistance(a: string, b: string): number {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const s = a.slice(start, endA);
  const t = b.slice(start, endB);
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  if (s.length * t.length > 4_000_000) return Math.max(s.length, t.length);
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[t.length];
}

/** How much a human changed the draft: none, light (up to 10% of the text), moderate (up to 30%), heavy. */
export function editBucket(original: string, final: string): EditBucket {
  const a = norm(original);
  const b = norm(final);
  if (a === b) return "none";
  const ratio = editDistance(a, b) / Math.max(a.length, b.length, 1);
  return ratio <= 0.1 ? "light" : ratio <= 0.3 ? "moderate" : "heavy";
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const REGEX_CODES = new Set(["EMPTY", "TOO_LONG", "RETURN_PROMISE", "ADVICE", "PERFORMANCE_CLAIM"]);

/**
 * Which layer blocked a draft. "JUDGE: ..." comes from the LLM judge at generation time; "CODE: ..." from the regex
 * guardrail. A block with a decidedById happened when a person approved an edited text (regex re-check only).
 * The judge's free-text reason is never kept: only the layer name.
 */
export function classifyBlock(blockedReason: string | null, decidedById: string | null): { layer: "regex" | "judge" | "approval_recheck"; reason: string } {
  const code = /^([A-Z_]+):/.exec(blockedReason ?? "")?.[1];
  if (code === "JUDGE") return { layer: "judge", reason: "JUDGE" };
  const reason = code && REGEX_CODES.has(code) ? code : "UNKNOWN";
  return { layer: decidedById ? "approval_recheck" : "regex", reason };
}

export type ProgrammeEdit = { programme: string; approved: number; edited: number; editRate: number | null };

export type AgentQuality = {
  agentKey: string;
  generated: number;
  blocked: { total: number; regex: number; judge: number; rate: number | null; byReason: Record<string, number> };
  blockedAfterEdit: number;
  /** Drafts that reached a human (not blocked when generated). The denominator for approval, rejection and expiry rates. */
  offered: number;
  approved: number;
  rejected: number;
  expired: number;
  pending: number;
  sent: number;
  approvalRate: number | null;
  rejectionRate: number | null;
  expiryRate: number | null;
  edited: number;
  editRate: number | null;
  editBuckets: Record<EditBucket, number>;
  medianApproveMinutes: number | null;
  tokens: { input: number; output: number };
  cost: { usd: number | null; perApprovedUsd: number | null; partial: boolean; unknownModels: string[] };
  byProgramme: ProgrammeEdit[];
};

const rate = (num: number, den: number) => (den > 0 ? num / den : null);

function summarise(agentKey: string, rows: ProposalRow[], now: Date): AgentQuality {
  const blockedGen = rows.filter((r) => r.status === "BLOCKED" && !r.decidedById);
  const byReason: Record<string, number> = {};
  let regex = 0;
  let judge = 0;
  for (const r of blockedGen) {
    const c = classifyBlock(r.blockedReason, r.decidedById);
    byReason[c.reason] = (byReason[c.reason] ?? 0) + 1;
    if (c.layer === "judge") judge++;
    else regex++;
  }
  const offeredRows = rows.filter((r) => !(r.status === "BLOCKED" && !r.decidedById));
  const approvedRows = rows.filter((r) => r.status === "APPROVED" || r.status === "SENT");
  const rejected = rows.filter((r) => r.status === "REJECTED").length;
  const overdue = (r: ProposalRow) => r.status === "DRAFT" && r.expiresAt.getTime() <= now.getTime();
  const expired = rows.filter((r) => r.status === "EXPIRED" || overdue(r)).length;
  const pending = rows.filter((r) => r.status === "DRAFT" && !overdue(r)).length;

  const editBuckets: Record<EditBucket, number> = { none: 0, light: 0, moderate: 0, heavy: 0 };
  const prog = new Map<string, { approved: number; edited: number }>();
  for (const r of approvedRows) {
    const b = editBucket(r.originalBody, r.body);
    editBuckets[b]++;
    const key = r.programme ?? "Unspecified";
    const p = prog.get(key) ?? { approved: 0, edited: 0 };
    p.approved++;
    if (b !== "none") p.edited++;
    prog.set(key, p);
  }
  const edited = approvedRows.length - editBuckets.none;

  const mins = approvedRows.flatMap((r) => (r.decidedAt ? [(r.decidedAt.getTime() - r.createdAt.getTime()) / 60_000] : []));
  const usage = estimateUsageCost(rows);

  return {
    agentKey,
    generated: rows.length,
    blocked: { total: blockedGen.length, regex, judge, rate: rate(blockedGen.length, rows.length), byReason },
    blockedAfterEdit: rows.filter((r) => r.status === "BLOCKED" && !!r.decidedById).length,
    offered: offeredRows.length,
    approved: approvedRows.length,
    rejected,
    expired,
    pending,
    sent: rows.filter((r) => r.status === "SENT").length,
    approvalRate: rate(approvedRows.length, offeredRows.length),
    rejectionRate: rate(rejected, offeredRows.length),
    expiryRate: rate(expired, offeredRows.length),
    edited,
    editRate: rate(edited, approvedRows.length),
    editBuckets,
    medianApproveMinutes: median(mins),
    tokens: { input: rows.reduce((s, r) => s + r.inputTokens, 0), output: rows.reduce((s, r) => s + r.outputTokens, 0) },
    cost: { usd: usage.usd, perApprovedUsd: usage.usd !== null && approvedRows.length > 0 ? usage.usd / approvedRows.length : null, partial: usage.partial, unknownModels: usage.unknownModels },
    byProgramme: [...prog.entries()]
      .map(([programme, p]) => ({ programme, approved: p.approved, edited: p.edited, editRate: rate(p.edited, p.approved) }))
      .sort((a, b) => b.approved - a.approved || a.programme.localeCompare(b.programme)),
  };
}

/** Quality and safety metrics per agent. Works for any agentKey, so a future agent shows up without changes. */
export function agentQuality(rows: ProposalRow[], now: Date): AgentQuality[] {
  const groups = new Map<string, ProposalRow[]>();
  for (const r of rows) groups.set(r.agentKey, [...(groups.get(r.agentKey) ?? []), r]);
  return [...groups.entries()].map(([k, v]) => summarise(k, v, now)).sort((a, b) => b.generated - a.generated || a.agentKey.localeCompare(b.agentKey));
}
