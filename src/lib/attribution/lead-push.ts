import type { Touch } from "./model";
import type { AttributionSettings } from "./settings";

/**
 * Lead push: when a new lead arrives, tell the assigned RM what the lead came from and start the speed-to-lead clock; if the
 * clock runs out, tell the manager. Nothing here contacts the customer. The only message is a DRAFT written from a fixed
 * template, checked by the outbound guardrails, held back by the consent gate, and approved by a person on Agent drafts.
 * Pure: every effect goes through `PushDeps` / `SweepDeps`, so the rules are tested without a database.
 */

export const LEAD_DRAFT_AGENT_KEY = "lead_first_message";
export const LEAD_DRAFT_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_ANSWERS = 8;
const MAX_ANSWER = 200;

export type PushContext = {
  campaign: string | null;
  creative: string | null;
  form: string | null;
  confidence: Touch["confidence"] | null;
  channel: string | null;
  answers: Record<string, string>;
  productInterest: string | null;
};

const cut = (v: string, n = MAX_ANSWER) => v.replace(/\s+/g, " ").trim().slice(0, n);

export function buildPushContext(touch: Touch | null, lead: { answers: Record<string, string>; productInterest?: string | null }): PushContext {
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(lead.answers).slice(0, MAX_ANSWERS)) if (v && v.trim()) answers[cut(k, 60)] = cut(v);
  return {
    campaign: touch?.campaign?.name ?? touch?.campaign?.id ?? null,
    creative: touch?.creative ?? null,
    form: touch?.form ?? null,
    confidence: touch?.confidence ?? null,
    channel: touch ? touch.kind : null,
    answers,
    productInterest: lead.productInterest ? cut(lead.productInterest, 120) : null,
  };
}

const TOPICS: [RegExp, string][] = [
  [/retire|pension|nps/i, "retirement planning"],
  [/elss|tax/i, "tax saving"],
  [/\bnri\b|abroad|overseas|\bfema\b/i, "investing from abroad"],
  [/\bpms\b|portfolio\s*manage/i, "portfolio management"],
  [/mutual\s*fund|\bsip\b/i, "mutual funds"],
];

/** A plain topic for the first message, from the campaign or the product the lead asked about; never a product claim. */
export function topicFor(input: { campaign?: string | null; creative?: string | null; productInterest?: string | null }): string {
  for (const text of [input.campaign, input.creative, input.productInterest]) {
    if (!text) continue;
    const hit = TOPICS.find(([re]) => re.test(text));
    if (hit) return hit[1];
  }
  return "investing with us";
}

/** The suggested first message: fixed wording, no figures, no recommendation, no promise. A person reads and approves it. */
export function firstMessageDraft(input: { firstName: string; rmFirstName: string | null; campaign: string | null; productInterest?: string | null }): string {
  const topic = topicFor({ campaign: input.campaign, productInterest: input.productInterest });
  const intro = input.rmFirstName ? `I'm ${input.rmFirstName}, your relationship manager.` : "I'm your relationship manager.";
  return `Hi ${input.firstName}, thanks for your interest in ${topic}. ${intro} Would a short call today suit you, so I can understand what you are looking for? Reply here with a time that works for you.`;
}

export type PushRow = { clientId: string; intakeKey: string; assignedToId: string | null; context: PushContext; slaMinutes: number; dueAt: Date };

export type DraftResult = { status: "skipped"; reason: string } | { status: "blocked"; reason: string; proposalId: string } | { status: "drafted"; proposalId: string };

/** Event seams (CUSTOMER_EVENTS_ENABLED, through emit()). Optional and best effort: a failing event never undoes or blocks a push, an escalation or a notification. */
export type PushEvents = {
  pushed: (e: { clientId: string; pushId: string; slaMinutes: number; assigned: boolean; campaignId: string | null; occurredAt: Date }) => Promise<void>;
};

export type PushDeps = {
  now: () => Date;
  settings: () => Promise<AttributionSettings>;
  /** Idempotent on intakeKey: `created` is false when this submission was already pushed. */
  createPush: (row: PushRow) => Promise<{ created: boolean; id: string }>;
  notify: (userIds: string[], type: string, payload: Record<string, unknown>) => Promise<void>;
  /** Who assigns leads when nobody is assigned: managers and admins. */
  pool: () => Promise<string[]>;
  createDraft: (args: { clientId: string; firstName: string; rmFirstName: string | null; campaign: string | null; productInterest: string | null; reason: string }) => Promise<DraftResult>;
  attachDraft: (pushId: string, proposalId: string) => Promise<void>;
  events?: PushEvents;
};

export type PushInput = { clientId: string; clientName: string; firstName: string; assignedToId: string | null; rmFirstName: string | null; intakeKey: string; touch: Touch | null; answers: Record<string, string>; productInterest: string | null };

export type PushOutcome = { status: "skipped"; reason: string } | { status: "pushed"; pushId: string; draft: DraftResult | null };

const warn = (what: string, error: unknown) => console.error(`Lead push: ${what} failed`, error instanceof Error ? error.message : "unknown");

export async function pushNewLead(input: PushInput, deps: PushDeps): Promise<PushOutcome> {
  const settings = await deps.settings();
  const now = deps.now();
  const context = buildPushContext(input.touch, { answers: input.answers, productInterest: input.productInterest });
  const dueAt = new Date(now.getTime() + settings.slaMinutes * 60_000);
  const row: PushRow = { clientId: input.clientId, intakeKey: input.intakeKey, assignedToId: input.assignedToId, context, slaMinutes: settings.slaMinutes, dueAt };
  const { created, id } = await deps.createPush(row);
  if (!created) return { status: "skipped", reason: "already pushed" };

  try {
    await deps.events?.pushed({ clientId: input.clientId, pushId: id, slaMinutes: settings.slaMinutes, assigned: input.assignedToId !== null, campaignId: input.touch?.campaign?.id ?? null, occurredAt: now });
  } catch (error) {
    warn("event", error);
  }

  try {
    const recipients = input.assignedToId ? [input.assignedToId] : await deps.pool();
    if (recipients.length > 0) {
      await deps.notify(recipients, "lead_push", {
        clientId: input.clientId,
        clientName: input.clientName,
        campaign: context.campaign,
        creative: context.creative,
        form: context.form,
        confidence: context.confidence,
        answers: context.answers,
        dueAt: dueAt.toISOString(),
        slaMinutes: settings.slaMinutes,
        ...(input.assignedToId ? {} : { unassigned: true }),
      });
    }
  } catch (error) {
    warn("notification", error);
  }

  let draft: DraftResult | null = null;
  if (input.assignedToId) {
    try {
      draft = await deps.createDraft({ clientId: input.clientId, firstName: input.firstName, rmFirstName: input.rmFirstName, campaign: context.campaign, productInterest: context.productInterest, reason: `New lead${context.campaign ? ` from ${context.campaign}` : ""}: suggested first message.` });
      if (draft.status !== "skipped") await deps.attachDraft(id, draft.proposalId);
    } catch (error) {
      warn("draft", error);
      draft = null;
    }
  }
  return { status: "pushed", pushId: id, draft };
}

export type OpenPush = { id: string; clientId: string; clientName: string; assignedToId: string | null; slaMinutes: number; dueAt: Date; status: string; campaign: string | null; createdAt: Date };

export type SweepEvents = {
  /** A person reached the lead: minutes from the push to that first contact. */
  contacted: (push: OpenPush, at: Date, minutes: number) => Promise<void>;
  breached: (push: OpenPush, minutesPastSla: number) => Promise<void>;
};

export type SweepDeps = {
  now: () => Date;
  settings: () => Promise<AttributionSettings>;
  /** Pushes that are OPEN or ESCALATED. */
  listOpen: () => Promise<OpenPush[]>;
  contactedAt: (push: OpenPush) => Promise<Date | null>;
  /** The RM's manager; with none, the people who assign leads. */
  escalationTargets: (push: OpenPush) => Promise<string[]>;
  createTask: (task: { clientId: string; assignedToId: string; title: string; dueAt: Date; source: string }) => Promise<{ id: string }>;
  notify: (userIds: string[], type: string, payload: Record<string, unknown>) => Promise<void>;
  update: (id: string, data: Record<string, unknown>) => Promise<void>;
  events?: SweepEvents;
};

const safely = async (fn: () => Promise<void> | undefined) => {
  try {
    await fn();
  } catch (error) {
    warn("event", error);
  }
};

export type SweepResult = { contacted: number; escalated: number; waiting: number };

export async function sweepLeadPushes(deps: SweepDeps): Promise<SweepResult> {
  const out: SweepResult = { contacted: 0, escalated: 0, waiting: 0 };
  const settings = await deps.settings();
  const now = deps.now();
  for (const push of await deps.listOpen()) {
    try {
      const contacted = await deps.contactedAt(push);
      if (contacted) {
        await deps.update(push.id, { status: "CONTACTED", contactedAt: contacted });
        await safely(() => deps.events?.contacted(push, contacted, Math.max(0, Math.round((contacted.getTime() - push.createdAt.getTime()) / 60_000))));
        out.contacted++;
        continue;
      }
      if (push.status !== "OPEN") continue;
      const breachAt = push.dueAt.getTime() + settings.graceMinutes * 60_000;
      if (now.getTime() < breachAt) {
        out.waiting++;
        continue;
      }
      const targets = await deps.escalationTargets(push);
      if (targets.length === 0) continue;
      const late = Math.max(0, Math.round((now.getTime() - push.dueAt.getTime()) / 60_000));
      const task = await deps.createTask({ clientId: push.clientId, assignedToId: targets[0], title: `Lead not contacted within ${push.slaMinutes} min: ${push.clientName}`, dueAt: now, source: `lead-sla:${push.id}` });
      await deps.notify(targets, "lead_sla_breach", { clientId: push.clientId, clientName: push.clientName, campaign: push.campaign, pushId: push.id, minutesPastSla: late, slaMinutes: push.slaMinutes, taskId: task.id });
      await deps.update(push.id, { status: "ESCALATED", escalatedAt: now, escalationTaskId: task.id });
      await safely(() => deps.events?.breached(push, late));
      out.escalated++;
    } catch (error) {
      warn(`push ${push.id}`, error);
    }
  }
  return out;
}

/**
 * What the lead-clock event consumer does for a customer who was just contacted (lead.contacted, call.logged, whatsapp.message.sent): the same
 * definition of "reached" as the sweep (first-contact.ts), applied sooner, so a lead reached inside the SLA is closed before the sweep ever looks.
 * Idempotent: a push that is not open is never touched again, and no contact means no change.
 */
export type ClockDeps = {
  openFor: (clientId: string) => Promise<OpenPush[]>;
  contactedAt: (push: OpenPush) => Promise<Date | null>;
  update: (id: string, data: Record<string, unknown>) => Promise<void>;
  events?: Pick<SweepEvents, "contacted">;
};

export async function closeClockForClient(clientId: string, deps: ClockDeps): Promise<number> {
  let closed = 0;
  for (const push of await deps.openFor(clientId)) {
    if (push.status !== "OPEN") continue;
    const at = await deps.contactedAt(push);
    if (!at) continue;
    await deps.update(push.id, { status: "CONTACTED", contactedAt: at });
    await safely(() => deps.events?.contacted(push, at, Math.max(0, Math.round((at.getTime() - push.createdAt.getTime()) / 60_000))));
    closed++;
  }
  return closed;
}
