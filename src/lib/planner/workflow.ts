import { CONSENT_PURPOSES } from "@/lib/consent/policy";

import { requiresRegisteredCreator, type ChannelKey } from "./channels";

/** Plan checklist and status workflow: Draft, Needs review, Approved, Scheduled. Pure. Scheduling records intent only. */

export const PLAN_STATUSES = ["DRAFT", "NEEDS_REVIEW", "APPROVED", "SCHEDULED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const STATUS_LABELS: Record<PlanStatus, string> = { DRAFT: "Draft", NEEDS_REVIEW: "Needs review", APPROVED: "Approved", SCHEDULED: "Scheduled" };
export const isPlanStatus = (v: unknown): v is PlanStatus => typeof v === "string" && (PLAN_STATUSES as readonly string[]).includes(v);

/** A follow-up message to a lead relies on one of these consent purposes. */
export const FOLLOW_UP_PURPOSES = ["MARKETING_COMMS", "SERVICE_COMMS"] as const satisfies readonly (typeof CONSENT_PURPOSES)[number][];

export const SEBI_REGISTRATION_RE = /^IN[A-Z]\d{9}$/;
export const isRegisteredCreator = (c: { sebiRegistration: string | null } | null): boolean => !!c && !!c.sebiRegistration && SEBI_REGISTRATION_RE.test(c.sebiRegistration.trim().toUpperCase());

export type ChecklistItem = { id: string; label: string; status: "pass" | "fail"; detail: string };
export type ChecklistContext = {
  promiseOk: boolean;
  destination: { status: string; patternOk: boolean };
  linksTested: boolean;
  routing: { via: "rule" | "fallback" | "none"; ownerId: string | null };
  consentPurpose: string | null;
  copies: { status: string }[];
  creator: { sebiRegistration: string | null } | null;
  channel: ChannelKey;
};

export function buildChecklist(c: ChecklistContext): ChecklistItem[] {
  const item = (id: string, label: string, problem: string | null, pass: string): ChecklistItem => ({ id, label, status: problem ? "fail" : "pass", detail: problem ?? pass });
  const dest = c.destination.status !== "LIVE" ? `The destination is ${c.destination.status === "OFF" ? "switched off" : "planned"}: not live yet. Attach it if you must, but it cannot be approved until it is live.` : !c.destination.patternOk ? "The destination's URL pattern is not valid." : null;
  const items = [
    item("promise_compliant", "Promise is compliant", c.promiseOk ? null : "The promise fails the SEBI and ASCI checklist. Fix it in the Promises tab.", "The promise passes every guardrail."),
    item("destination_live", "Destination is live", dest, "The destination is live and its URL pattern is valid."),
    item("links_tested", "Tracking links tested", c.linksTested ? null : "A person has not yet tested the tracked links. Open each link and tick the box on the Links tab.", "A person tested the tracked links."),
    item("routing_owner", "Routing owner set", c.routing.ownerId ? null : "No routing rule or fallback names an owner for leads of this campaign.", c.routing.via === "fallback" ? "Leads go to the fallback owner." : "A routing rule names the owner."),
    item("consent_purpose", "Consent purpose for follow-up present", c.consentPurpose && (FOLLOW_UP_PURPOSES as readonly string[]).includes(c.consentPurpose) ? null : "Choose the consent purpose the follow-up relies on (marketing or service messages).", "A consent purpose is recorded."),
    item("copy_approved", "Copy approved", c.copies.some((x) => x.status === "APPROVED") ? null : "No copy draft has been approved by a person yet.", "A copy draft is approved."),
  ];
  if (requiresRegisteredCreator(c.channel)) items.push(item("creator_registered", "Creator has a SEBI registration", isRegisteredCreator(c.creator) ? null : "Short video needs a creator with a valid SEBI registration number. Unregistered creators are blocked.", "The creator's SEBI registration is on file."));
  return items;
}

export type PlanAction = "submit" | "approve" | "request_changes" | "schedule" | "unschedule" | "edit";
export type PlanForFlow = { status: PlanStatus; createdById: string; ownerId: string; startDate: string | null; endDate: string | null; linksTestedAt: Date | string | null; approvedById: string | null; channel: ChannelKey };

export type TransitionResult = { ok: true; to: PlanStatus; patch: Record<string, unknown>; kind: PlanAction } | { ok: false; error: string };

const FROM: Record<Exclude<PlanAction, "edit">, { from: PlanStatus; to: PlanStatus }> = {
  submit: { from: "DRAFT", to: "NEEDS_REVIEW" },
  approve: { from: "NEEDS_REVIEW", to: "APPROVED" },
  request_changes: { from: "NEEDS_REVIEW", to: "DRAFT" },
  schedule: { from: "APPROVED", to: "SCHEDULED" },
  unschedule: { from: "SCHEDULED", to: "APPROVED" },
};

export function decideTransition(input: { plan: PlanForFlow; action: PlanAction; actor: string; checklist: ChecklistItem[]; today: string; confirmed?: boolean; note?: string }): TransitionResult {
  const { plan, action, actor, checklist, today } = input;
  const fail = (error: string): TransitionResult => ({ ok: false, error });
  if (action === "edit") return { ok: true, kind: action, to: "DRAFT", patch: { status: "DRAFT", approvedById: null, approvedAt: null, linksTestedAt: null, linksTestedById: null } };

  const step = FROM[action];
  if (!step) return fail("That action does not exist.");
  if (plan.status !== step.from) return fail(`Only a plan that is "${STATUS_LABELS[step.from]}" can do that; this one is "${STATUS_LABELS[plan.status]}".`);
  const failing = checklist.filter((i) => i.status === "fail");

  if (action === "submit") {
    const hard = failing.filter((i) => i.id === "promise_compliant" || i.id === "creator_registered");
    if (hard.length) return fail(`Cannot send for review: ${hard.map((i) => i.label).join(", ")} fails. ${hard[0].detail}`);
  }
  if (action === "approve") {
    if (actor === plan.createdById) return fail("A different person must approve this plan: the person who drafted it cannot.");
    if (!input.confirmed) return fail("Tick the box to confirm you have reviewed the plan, its links and its copy.");
    if (failing.length) return fail(`Cannot approve yet: ${failing.map((i) => i.label).join(", ")}.`);
  }
  if (action === "request_changes" && !(input.note ?? "").trim()) return fail("Say what needs to change.");
  if (action === "schedule") {
    if (!plan.startDate) return fail("Set a start date before scheduling.");
    if (plan.startDate < today) return fail("The start date is in the past.");
  }
  const patch: Record<string, unknown> = { status: step.to };
  if (action === "approve") patch.approvedById = actor;
  if (action === "request_changes") Object.assign(patch, { approvedById: null, approvedAt: null });
  return { ok: true, kind: action, to: step.to, patch };
}
