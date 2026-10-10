import { SOCIAL_CHANNELS, isSocialChannel } from "./compliance";

/**
 * The seam between an approved post and a social network. Today the only implementation is a fake: no real publishing
 * adapter exists in this codebase and nothing calls `publish`. The Scheduled status records intent only; it does not
 * touch this interface except for the dry-run `checkReady`.
 *
 * A real adapter (for example one that talks to a self-hosted Postiz instance) would implement `SocialPublisher`, be
 * selected in `getSocialPublisher`, and be driven by a separate, human-triggered step. It is documented in
 * docs/marketing-workspace.md, not wired.
 */

export type PublishRequest = { postId: string; channel: string; body: string; scheduledFor: Date | null };
export type PublishReceipt = { accepted: boolean; providerRef: string; note?: string };
export type ReadyCheck = { ok: true } | { ok: false; reason: string };

export interface SocialPublisher {
  readonly id: string;
  /** True when nothing real happens (the fake). */
  readonly simulation: boolean;
  /** Dry run: could this post be handed over as it is? Has no side effects. */
  checkReady(request: PublishRequest): ReadyCheck;
  /** Hands the post to the network. Not called anywhere in the app today. */
  publish(request: PublishRequest): Promise<PublishReceipt>;
}

export type FakePublisher = SocialPublisher & { readonly published: PublishRequest[] };

export function createFakePublisher(): FakePublisher {
  const published: PublishRequest[] = [];
  return {
    id: "fake",
    simulation: true,
    published,
    checkReady(request) {
      if (!isSocialChannel(request.channel)) return { ok: false, reason: "That channel is not supported." };
      if (!request.body.trim()) return { ok: false, reason: "The post is empty." };
      const { label, maxLength } = SOCIAL_CHANNELS[request.channel];
      if (request.body.length > maxLength) return { ok: false, reason: `Too long for ${label} (limit ${maxLength} characters).` };
      return { ok: true };
    },
    async publish(request) {
      published.push(request);
      return { accepted: true, providerRef: `fake-${request.postId}`, note: "Simulated: nothing was posted anywhere." };
    },
  };
}

const fake = createFakePublisher();

/** Always the fake for now. A real adapter would be chosen here from Settings, behind its own flag. */
export function getSocialPublisher(): SocialPublisher {
  return fake;
}
