import { maskPan, maskTail4 } from "@/lib/policy/masking";
import { comparableEmail, comparablePhone } from "../duplicate-score";
import { normalizePan } from "@/lib/utils/normalize-contact";

/** One customer as loaded by the server. Raw identity values stay on the server: only masked text and match flags are emitted. */
export type CardInput = {
  id: string;
  name: string;
  clientCode: string;
  mobile: string | null;
  email: string | null;
  pan: string | null;
  city: string | null;
  leadSource: string | null;
  stage: string;
  kyc: string;
  funding: string;
  assignedTo: string | null;
  lastActivityAt: Date | null;
  createdAt: Date;
};

export type Match = "same" | "different" | "missing";
export type CompareRow = { key: string; label: string; a: string; b: string; match: Match; sensitive: boolean };
export type SensitiveField = "mobile" | "email" | "pan";

/** DPDP: lists show a first name and the client code only. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Customer";
}

const REASONS: Record<string, string> = {
  "same mobile": "Same mobile number",
  "same email": "Same email address",
  "similar name": "Similar name",
  "same PAN": "Same PAN",
};
export function reasonText(reason: string): string {
  return REASONS[reason] ?? reason.charAt(0).toUpperCase() + reason.slice(1);
}

export function confidenceOf(score: number): { percent: number; label: string } {
  const percent = Math.max(0, Math.min(100, Math.round(score * 100)));
  const label = percent >= 95 ? "Very likely the same person" : percent >= 80 ? "Likely the same person" : "Possibly the same person";
  return { percent, label };
}

const blank = (v: string | null | undefined) => !v || !v.trim();
function judge(a: string | null, b: string | null, norm: (v: string) => string | null): Match {
  const na = blank(a) ? null : norm(a as string);
  const nb = blank(b) ? null : norm(b as string);
  if (!na || !nb) return "missing";
  return na === nb ? "same" : "different";
}
const text = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
const show = (v: string | null | undefined, fallback = "Not provided") => (blank(v) ? fallback : (v as string));
const when = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "No activity");

/** Side-by-side rows. Identity rows are judged on the raw values here, on the server; the emitted strings are masked per the client masking rules. */
export function buildComparison(a: CardInput, b: CardInput): CompareRow[] {
  const row = (key: string, label: string, av: string, bv: string, match: Match, sensitive = false): CompareRow => ({ key, label, a: av, b: bv, match, sensitive });
  const plain = (key: string, label: string, av: string | null, bv: string | null, fallback?: string) =>
    row(key, label, show(av, fallback), show(bv, fallback), judge(av, bv, text));
  const status = (key: string, label: string, av: string | null, bv: string | null, fallback = "None") => {
    const x = show(av, fallback);
    const y = show(bv, fallback);
    return row(key, label, x, y, text(x) === text(y) ? "same" : "different");
  };
  return [
    row("name", "Name", show(a.name), show(b.name), judge(a.name, b.name, text)),
    row("mobile", "Mobile", blank(a.mobile) ? "Not provided" : maskTail4(a.mobile) as string, blank(b.mobile) ? "Not provided" : maskTail4(b.mobile) as string, judge(a.mobile, b.mobile, comparablePhone), true),
    row("email", "Email", blank(a.email) ? "Not provided" : maskTail4(a.email) as string, blank(b.email) ? "Not provided" : maskTail4(b.email) as string, judge(a.email, b.email, comparableEmail), true),
    row("pan", "PAN", blank(a.pan) ? "Not provided" : maskPan(a.pan) as string, blank(b.pan) ? "Not provided" : maskPan(b.pan) as string, judge(a.pan, b.pan, (v) => normalizePan(v)), true),
    plain("city", "City", a.city, b.city),
    plain("leadSource", "Source", a.leadSource, b.leadSource),
    status("stage", "Stage", a.stage, b.stage),
    status("kyc", "KYC", a.kyc, b.kyc),
    status("funding", "Funding", a.funding, b.funding),
    status("assignedTo", "Assigned RM", a.assignedTo, b.assignedTo, "Unassigned"),
    row("lastActivity", "Last activity", when(a.lastActivityAt), when(b.lastActivityAt), when(a.lastActivityAt) === when(b.lastActivityAt) ? "same" : "different"),
    row("created", "Created", when(a.createdAt), when(b.createdAt), when(a.createdAt) === when(b.createdAt) ? "same" : "different"),
  ];
}

export type Counts = { activities: number; messages: number; tasks: number; positions: number; documents: number; tradingAccounts: number };

/** "How much history does each record carry": the numbers a reviewer weighs when choosing which record to keep. */
export function countRows(a: Counts, b: Counts): CompareRow[] {
  const labels: [keyof Counts, string][] = [
    ["activities", "Activities"], ["messages", "Messages"], ["tasks", "Tasks"], ["documents", "Documents"], ["tradingAccounts", "Trading accounts"], ["positions", "Positions"],
  ];
  return labels.map(([key, label]) => ({ key: `count:${key}`, label, a: String(a[key]), b: String(b[key]), match: a[key] === b[key] ? "same" : "different", sensitive: false }));
}
