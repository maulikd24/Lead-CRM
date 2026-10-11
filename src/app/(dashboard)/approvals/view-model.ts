import type { AutonomyLevel } from "@/lib/policy/approvals/canonical/autonomy";
import type { ApprovalKind } from "@/lib/policy/approvals/canonical/contract";
import { definitionOf, isKind } from "@/lib/policy/approvals/canonical/definitions";
import type { InboxItem } from "@/lib/policy/approvals/canonical/service";
import type { CanonicalState } from "@/lib/policy/approvals/canonical/state";

/** The pure half of the approvals inbox: tabs, filter links, wording and shortcuts. The screen only renders what this returns. */
export type InboxTab = "awaiting" | "mine";

export function inboxTabs(c: { awaiting: number; mine: number; canRequest: boolean }) {
  return [
    { key: "awaiting" as const, label: "Awaiting you", count: c.awaiting },
    ...(c.canRequest ? [{ key: "mine" as const, label: "Your requests", count: c.mine }] : []),
  ];
}

export function parseTab(raw: string | string[] | undefined, canRequest: boolean): InboxTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "mine" && canRequest ? "mine" : "awaiting";
}

export function parseKind(raw: string | string[] | undefined, visible: readonly ApprovalKind[]): ApprovalKind | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && isKind(v) && visible.includes(v) ? v : undefined;
}

export const filterHref = (tab: InboxTab, kind?: ApprovalKind) => {
  const q = new URLSearchParams();
  if (tab !== "awaiting") q.set("tab", tab);
  if (kind) q.set("kind", kind);
  const s = q.toString();
  return s ? `/approvals?${s}` : "/approvals";
};

export function kindChips(counts: Partial<Record<ApprovalKind, number>>, active: ApprovalKind | undefined, tab: InboxTab) {
  const kinds = (Object.keys(counts) as ApprovalKind[]).filter((k) => (counts[k] ?? 0) > 0);
  const total = kinds.reduce((t, k) => t + (counts[k] ?? 0), 0);
  return [
    { key: "all", label: "All", count: total, active: !active, href: filterHref(tab) },
    ...kinds.map((k) => ({ key: k, label: definitionOf(k).label, count: counts[k] ?? 0, active: active === k, href: filterHref(tab, k) })),
  ];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ageLabel(since: Date, now: Date): string {
  const min = Math.floor((now.getTime() - since.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${plural(Math.floor(h / 24), "day")} ago`;
}

export function expiryLabel(at: Date | null, now: Date): string | null {
  if (!at) return null;
  const min = Math.floor((at.getTime() - now.getTime()) / 60_000);
  if (min <= 0) return "Expired";
  if (min < 60) return `Expires in ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `Expires in ${h} h` : `Expires in ${plural(Math.floor(h / 24), "day")}`;
}

export const rowOf = (i: InboxItem, now: Date) => {
  const kind = definitionOf(i.kind).label;
  return { id: i.ref, title: i.subject.label, meta: i.subject.label === kind ? ageLabel(i.requestedAt, now) : `${kind} · ${ageLabel(i.requestedAt, now)}` };
};

export function autonomyChip(level: AutonomyLevel): string | null {
  return level === "L3" ? "Draft only" : level === "L4" ? "Runs after you approve" : null;
}

export const STATE_CHIP: Record<CanonicalState, { label: string; variant: "success" | "warning" | "outline" | "secondary" | "destructive" }> = {
  requested: { label: "Waiting", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  executed: { label: "Done", variant: "success" },
  rejected: { label: "Rejected", variant: "secondary" },
  expired: { label: "Expired", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

export type ShortcutAction = "approve" | "reason" | "open" | null;

/** a approves (or opens, when the approval is not done in place), r moves to the reason box, o opens the subject. Never while typing or with a modifier held. */
export function shortcutAction(e: { key: string; typing: boolean; meta: boolean; canApprove: boolean; inline: boolean; ready: boolean; hasLink: boolean }): ShortcutAction {
  if (e.typing || e.meta) return null;
  const k = e.key.toLowerCase();
  if (k === "r") return "reason";
  if (k === "o") return e.hasLink ? "open" : null;
  if (k === "a") {
    if (!e.canApprove) return null;
    if (!e.inline) return e.hasLink ? "open" : null;
    return e.ready ? "approve" : null;
  }
  return null;
}

const LINK_LABEL: Record<ApprovalKind, string> = {
  "agent-proposal": "Open customer", "social-post": "Open post", "referral-statement": "Open statements", "merge-suggestion": "Review the pair", "ai-pilot-signoff": "Open pilot settings",
  "payout-run": "Open payout run", "commission-adjustment": "Open earnings", "erasure-request": "Open data privacy", "partner-tax-rule": "Open partner finance", "partner-override-rule": "Open partner finance",
  "stage-override": "Open customer", "autopilot-action": "Open Autopilot", "ad-creative": "Open creative", "lead-push-draft": "Open lead push", "product-registry-change": "Open product registry",
  "closed-loop-destination": "Open Closed loop", "consent-policy-change": "Open Closed loop",
 "director-report": "Open reports",
};
const DECIDED_VERB: Partial<Record<CanonicalState, string>> = { approved: "Approved", executed: "Approved", rejected: "Rejected", failed: "Failed", cancelled: "Cancelled" };

export type DetailData = {
  ref: string; kind: ApprovalKind; kindLabel: string; title: string; summary: string; stateLabel: string; stateVariant: (typeof STATE_CHIP)[CanonicalState]["variant"];
  href: string | null; hrefLabel: string; evidence: { key: string; label: string; value: string }[]; meta: string[]; autonomy: string | null;
  decisionReason: string | null; correlationId: string; causationId: string | null; readOnly: boolean;
  actions: { canApprove: boolean; canReject: boolean; inlineApprove: boolean; needs: readonly string[]; blocked: string | null };
};

/** Everything the detail pane shows, as plain data (dates already turned into words), so it can cross from the server to the browser. */
export function detailOf(i: InboxItem, now: Date, readOnly: boolean): DetailData {
  const meta: string[] = [];
  if (i.state === "requested" || i.state === "expired") meta.push(`Requested by ${i.requestedBy?.name ?? (i.requestedBy ? "a colleague" : "the system")}, ${ageLabel(i.requestedAt, now)}`);
  if (i.state === "requested") {
    const e = expiryLabel(i.expiresAt, now);
    if (e) meta.push(e);
  } else if (i.state === "expired") meta.push("Expired");
  else if (DECIDED_VERB[i.state]) meta.push(`${DECIDED_VERB[i.state]}${i.approver ? ` by ${i.approver.name ?? "a colleague"}` : ""}${i.decidedAt ? `, ${ageLabel(i.decidedAt, now)}` : ""}`);
  const chip = STATE_CHIP[i.state];
  const { canApprove, canReject, inlineApprove, needs, blocked } = i.actions;
  return {
    ref: i.ref, kind: i.kind, kindLabel: definitionOf(i.kind).label === i.subject.label ? "" : definitionOf(i.kind).label, title: i.subject.label, summary: i.summary === i.subject.label ? "" : i.summary, stateLabel: chip.label, stateVariant: chip.variant,
    href: i.subject.href, hrefLabel: LINK_LABEL[i.kind], evidence: i.evidence.map((e) => ({ key: e.key, label: e.label, value: e.value })), meta, autonomy: autonomyChip(i.autonomy),
    decisionReason: i.decisionReason, correlationId: i.correlationId, causationId: i.causationId, readOnly, actions: { canApprove, canReject, inlineApprove, needs, blocked },
  };
}
