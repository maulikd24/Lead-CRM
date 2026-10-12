import { SOCIAL_CHANNELS, checkPost, isSocialChannel, type ComplianceIssue } from "./compliance";
import type { SocialPublisher } from "./publisher";
import { planTransition, type Actor, type PostAction, type PostStatus } from "./workflow";

/**
 * The social-post operations, over an injected store so they are tested without a database. Every write is a
 * compare-and-set on the status the decision was made against, and leaves an audit event. Nothing here publishes:
 * the publisher is only asked a dry-run question (`checkReady`) when a post is scheduled.
 */

export type PostRow = {
  id: string;
  channel: string;
  title: string | null;
  body: string;
  status: PostStatus;
  source: "STAFF" | "AI";
  scheduledFor: Date | null;
  createdById: string;
  approvedById: string | null;
  approvedAt: Date | null;
  reviewNote: string | null;
  complianceIssues: ComplianceIssue[] | unknown | null;
  brief: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EventRow = { postId: string; action: string; fromStatus: PostStatus | null; toStatus: PostStatus | null; actorId: string | null; note?: string | null };

export type NewPost = Pick<PostRow, "channel" | "title" | "body" | "status" | "source" | "createdById" | "complianceIssues" | "brief">;

export interface PostStore {
  get(id: string): Promise<PostRow | null>;
  insert(data: NewPost): Promise<PostRow>;
  /** Updates only if the post is still in `expected`; returns whether it was. */
  casUpdate(id: string, expected: PostStatus, data: Partial<Omit<PostRow, "id" | "createdAt" | "updatedAt">>): Promise<boolean>;
  remove(id: string): Promise<void>;
  addEvent(event: EventRow): Promise<void>;
  list(filter?: { status?: PostStatus }): Promise<PostRow[]>;
}

export type ServiceResult = { ok: true; post: PostRow } | { ok: false; error: string; issues?: ComplianceIssue[] };

const ALLOWED_ROLES = new Set(["ADMIN", "MANAGER"]);
const CHANGED = "This post changed while you were working on it. Reload and try again.";
const MAX_TITLE = 120;

export function createSocialService(deps: { store: PostStore; publisher: SocialPublisher; now: () => Date }) {
  const { store, publisher, now } = deps;
  const denied = (): ServiceResult => ({ ok: false, error: "Only an Admin or Manager can work on social posts." });

  function validateContent(channel: string, body: string): string | null {
    if (!isSocialChannel(channel)) return "Pick a supported channel.";
    if (!body.trim()) return "Write the post first.";
    if (body.length > SOCIAL_CHANNELS[channel].maxLength * 2) return "That text is far too long for any channel.";
    return null;
  }

  return {
    async createDraft(input: { channel: string; title?: string | null; body: string; actor: Actor; source: "STAFF" | "AI"; brief?: string | null }): Promise<ServiceResult> {
      if (!ALLOWED_ROLES.has(input.actor.role)) return denied();
      const problem = validateContent(input.channel, input.body);
      if (problem) return { ok: false, error: problem };
      const post = await store.insert({
        channel: input.channel,
        title: input.title?.trim().slice(0, MAX_TITLE) || null,
        body: input.body,
        status: "DRAFT",
        source: input.source,
        createdById: input.actor.id,
        complianceIssues: checkPost({ channel: input.channel, body: input.body }).issues,
        brief: input.brief ?? null,
      });
      await store.addEvent({ postId: post.id, action: "create", fromStatus: null, toStatus: "DRAFT", actorId: input.actor.id, note: input.source === "AI" ? "Drafted by AI" : null });
      return { ok: true, post };
    },

    async editPost(id: string, input: { channel?: string; title?: string | null; body: string; actor: Actor }): Promise<ServiceResult> {
      const post = await store.get(id);
      if (!post) return { ok: false, error: "That post no longer exists." };
      const channel = input.channel ?? post.channel;
      const problem = ALLOWED_ROLES.has(input.actor.role) ? validateContent(channel, input.body) : "Only an Admin or Manager can work on social posts.";
      if (problem) return { ok: false, error: problem };
      const plan = planTransition({ post: { status: post.status, channel, body: input.body, source: post.source, scheduledFor: post.scheduledFor, authorId: post.createdById }, action: "edit", actor: input.actor, now: now() });
      if (!plan.ok) return plan;
      const data = { ...plan.next, channel, body: input.body, title: input.title === undefined ? post.title : input.title?.trim().slice(0, MAX_TITLE) || null, complianceIssues: checkPost({ channel, body: input.body }).issues };
      if (!(await store.casUpdate(id, post.status, data))) return { ok: false, error: CHANGED };
      await store.addEvent({ postId: id, action: "edit", fromStatus: plan.event.from, toStatus: plan.event.to, actorId: input.actor.id, note: plan.event.note ?? null });
      return { ok: true, post: { ...post, ...data } as PostRow };
    },

    async transition(id: string, action: Exclude<PostAction, "edit">, input: { actor: Actor; confirmed?: boolean; note?: string; scheduledFor?: Date | null }): Promise<ServiceResult> {
      const post = await store.get(id);
      if (!post) return { ok: false, error: "That post no longer exists." };
      const plan = planTransition({ post: { status: post.status, channel: post.channel, body: post.body, source: post.source, scheduledFor: post.scheduledFor, authorId: post.createdById }, action, actor: input.actor, now: now(), confirmed: input.confirmed, note: input.note, scheduledFor: input.scheduledFor });
      if (!plan.ok) return plan;
      if (action === "schedule") {
        // A dry run only: scheduling records intent, it never hands anything to a network.
        const ready = publisher.checkReady({ postId: id, channel: post.channel, body: post.body, scheduledFor: plan.next.scheduledFor ?? null });
        if (!ready.ok) return { ok: false, error: ready.reason };
      }
      if (!(await store.casUpdate(id, post.status, plan.next))) return { ok: false, error: CHANGED };
      await store.addEvent({ postId: id, action, fromStatus: plan.event.from, toStatus: plan.event.to, actorId: input.actor.id, note: plan.event.note ?? null });
      return { ok: true, post: { ...post, ...plan.next } as PostRow };
    },

    /** Only a Draft can be discarded; anything further along is edited back to Draft first, which withdraws its approval. */
    async discardDraft(id: string, actor: Actor): Promise<{ ok: true } | { ok: false; error: string }> {
      if (!ALLOWED_ROLES.has(actor.role)) return { ok: false, error: "Only an Admin or Manager can work on social posts." };
      const post = await store.get(id);
      if (!post) return { ok: false, error: "That post no longer exists." };
      if (post.status !== "DRAFT") return { ok: false, error: "Only a draft can be discarded. Send a post back to Draft first." };
      await store.remove(id);
      return { ok: true };
    },
  };
}
