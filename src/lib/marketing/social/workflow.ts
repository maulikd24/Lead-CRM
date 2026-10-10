import { checkPost, type ComplianceIssue } from "./compliance";

/**
 * The status workflow for a social post: Draft > Needs review > Approved > Scheduled. Pure: it decides what a step
 * would change and returns it; the caller writes it. There is no "publish" step. Scheduled records the intent to post
 * at a time; nothing in this module or its callers sends anything anywhere.
 */

export const POST_STATUSES = ["DRAFT", "NEEDS_REVIEW", "APPROVED", "SCHEDULED"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const STATUS_LABEL: Record<PostStatus, string> = { DRAFT: "Draft", NEEDS_REVIEW: "Needs review", APPROVED: "Approved", SCHEDULED: "Scheduled" };

export type PostAction = "submit" | "approve" | "request_changes" | "schedule" | "unschedule" | "edit";

export const MAX_SCHEDULE_AHEAD_DAYS = 365;

export type PostSnapshot = { status: PostStatus; channel: string; body: string; source: "STAFF" | "AI"; scheduledFor: Date | null };

export type Actor = { id: string; role: string };

export type TransitionInput = {
  post: PostSnapshot;
  action: PostAction;
  actor: Actor;
  now: Date;
  /** The reviewer's explicit "I have read this post and its disclosures" tick; required to approve. */
  confirmed?: boolean;
  note?: string;
  scheduledFor?: Date | null;
};

export type PostChange = {
  status: PostStatus;
  approvedById?: string | null;
  approvedAt?: Date | null;
  scheduledFor?: Date | null;
  reviewNote?: string | null;
};

export type TransitionPlan =
  | { ok: true; next: PostChange; event: { action: PostAction; from: PostStatus; to: PostStatus; note?: string } }
  | { ok: false; error: string; issues?: ComplianceIssue[] };

const ALLOWED_ROLES = new Set(["ADMIN", "MANAGER"]);
const FROM: Record<Exclude<PostAction, "edit">, PostStatus> = { submit: "DRAFT", approve: "NEEDS_REVIEW", request_changes: "NEEDS_REVIEW", schedule: "APPROVED", unschedule: "SCHEDULED" };

const fail = (error: string, issues?: ComplianceIssue[]): TransitionPlan => ({ ok: false, error, issues });

export function planTransition(input: TransitionInput): TransitionPlan {
  const { post, action, actor, now } = input;
  if (!ALLOWED_ROLES.has(actor.role)) return fail("Only an Admin or Manager can work on social posts.");
  if (action !== "edit" && !(action in FROM)) return fail("That action does not exist. Posts are never published from here.");

  if (action === "edit") {
    const withdrew = post.status === "APPROVED" || post.status === "SCHEDULED";
    return {
      ok: true,
      next: { status: "DRAFT", approvedById: null, approvedAt: null, scheduledFor: null },
      event: { action, from: post.status, to: "DRAFT", ...(withdrew ? { note: "Approval withdrawn because the text changed." } : {}) },
    };
  }

  if (post.status !== FROM[action]) return fail(`This step needs a post in "${STATUS_LABEL[FROM[action]]}"; this one is "${STATUS_LABEL[post.status]}".`);

  // Compliance is checked again at every gate, on the text as it is now.
  if (action === "submit" || action === "approve" || action === "schedule") {
    const result = checkPost({ channel: post.channel, body: post.body });
    if (!result.ok) return fail(`The compliance check found ${result.issues.length} ${result.issues.length === 1 ? "issue" : "issues"} to fix first.`, result.issues);
  }

  if (action === "submit") return { ok: true, next: { status: "NEEDS_REVIEW", reviewNote: null }, event: { action, from: "DRAFT", to: "NEEDS_REVIEW" } };

  if (action === "approve") {
    if (!input.confirmed) return fail("Confirm that you have read the post and its disclosures before approving.");
    return { ok: true, next: { status: "APPROVED", approvedById: actor.id, approvedAt: now }, event: { action, from: "NEEDS_REVIEW", to: "APPROVED" } };
  }

  if (action === "request_changes") {
    const note = (input.note ?? "").trim();
    if (!note) return fail("Say what needs to change.");
    return { ok: true, next: { status: "DRAFT", reviewNote: note.slice(0, 500) }, event: { action, from: "NEEDS_REVIEW", to: "DRAFT", note: note.slice(0, 500) } };
  }

  if (action === "schedule") {
    const when = input.scheduledFor;
    if (!when || Number.isNaN(when.getTime())) return fail("Pick the date and time it is intended to go out.");
    if (when.getTime() <= now.getTime()) return fail("Pick a time in the future.");
    if (when.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * 86_400_000) return fail(`Pick a time within the next ${MAX_SCHEDULE_AHEAD_DAYS} days.`);
    return { ok: true, next: { status: "SCHEDULED", scheduledFor: when }, event: { action, from: "APPROVED", to: "SCHEDULED" } };
  }

  // unschedule
  return { ok: true, next: { status: "APPROVED", scheduledFor: null }, event: { action, from: "SCHEDULED", to: "APPROVED" } };
}
