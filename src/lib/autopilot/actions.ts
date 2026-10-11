import { isAppliable, type AppliableKind, type Recommendation } from "./recommendations";

/**
 * The only door to a live ad account. Everything outward goes through an ActionProvider, and every provider is
 * wrapped by `guarded()`, which enforces the write-safety rules no matter which adapter sits behind it:
 *  - nothing is applied unless the proposal was approved by a person and applying is switched on;
 *  - only a short list of actions exists, and none of them can turn spending ON or raise a budget;
 *  - one proposal is applied at most once (idempotent), and every call is logged by the caller;
 *  - a new campaign is always created PAUSED, and turning it on is a separate act by a person with its own checks.
 */

export type ApplyRequest = { recId: string; kind: AppliableKind; targetIds: string[]; params: Record<string, unknown> };
export type ApplyResult = { ok: true; undoToken: string | null; note?: string } | { ok: false; error: string };

export type CampaignSpec = {
  name: string;
  platform: "meta" | "google";
  objective: string;
  dailyBudget: number;
  geo: Record<string, unknown>;
  schedule: Record<string, unknown>;
  bidding: Record<string, unknown>;
  landingUrl: string;
  copy: { headline: string; body: string };
  audience: Record<string, unknown>;
};

/** What an adapter must implement. The `status` of a created campaign is not a parameter: adapters create paused. */
export interface ActionProvider {
  readonly name: string;
  apply(req: ApplyRequest): Promise<ApplyResult>;
  undo?(token: string): Promise<{ ok: boolean; error?: string }>;
  createPausedCampaign(spec: CampaignSpec): Promise<{ ok: true; externalId: string } | { ok: false; error: string }>;
  activate(externalId: string): Promise<{ ok: boolean; error?: string }>;
}

export type GuardOptions = { applyEnabled: boolean; fourEyes?: boolean };

export type DraftForActivation = {
  externalId: string | null;
  status: string;
  createdById: string;
  complianceOk: boolean;
  annexureApproved: boolean;
};

export type GuardedProvider = {
  readonly name: string;
  /** Applying to a live ad account is switched on. Off by default; the registry refuses =1 in every environment, so in this build it is always off. */
  readonly applyEnabled: boolean;
  apply(rec: Recommendation, approvedById: string | null): Promise<ApplyResult>;
  undo(token: string): Promise<{ ok: boolean; error?: string }>;
  launchPaused(spec: CampaignSpec, actorId: string): Promise<{ ok: true; externalId: string } | { ok: false; error: string }>;
  activate(draft: DraftForActivation, actorId: string): Promise<{ ok: boolean; error?: string }>;
};

/**
 * Why a proposal may NOT be applied, or null when it may. The write-safety rules, in one place, so the decision layer can check them BEFORE it claims
 * the proposal (a refusal must leave it approved and untouched) and the guard re-checks them at the door: a person approved it, it is one of the few
 * appliable kinds, it names a campaign, and a budget change is a cut of at most 50% (nothing here can raise a budget or turn spending on).
 */
export function applyRefusal(rec: Recommendation, approvedById: string | null): string | null {
  if (rec.status !== "APPROVED" || !approvedById) return "A person must approve this proposal first.";
  if (!isAppliable(rec.action.kind)) return "This is a task for a person; it cannot be applied automatically.";
  if (rec.action.targetIds.length === 0) return "No campaign is named, so there is nothing to change.";
  if (rec.action.kind === "reduce_budget") {
    const cut = rec.action.params.cutFraction;
    if (typeof cut !== "number" || cut <= 0 || cut > 0.5) return "A budget change must be a reduction of at most 50%.";
  }
  return null;
}

export function guarded(inner: ActionProvider, opts: GuardOptions): GuardedProvider {
  const done = new Map<string, ApplyResult>();
  return {
    name: inner.name,
    applyEnabled: opts.applyEnabled,
    async apply(rec, approvedById) {
      if (!opts.applyEnabled) return { ok: false, error: "Applying changes to ad accounts is switched off." };
      const refusal = applyRefusal(rec, approvedById);
      if (refusal) return { ok: false, error: refusal };
      const prior = done.get(rec.id);
      if (prior) return prior;
      const kind = rec.action.kind;
      if (!isAppliable(kind)) return { ok: false, error: "This is a task for a person; it cannot be applied automatically." };
      const res = await inner.apply({ recId: rec.id, kind, targetIds: rec.action.targetIds, params: rec.action.params });
      if (res.ok) done.set(rec.id, res);
      return res;
    },
    async undo(token) { return inner.undo ? inner.undo(token) : { ok: false, error: "This platform cannot undo that change; reverse it in the ad account." }; },
    async launchPaused(spec, actorId) {
      if (!opts.applyEnabled) return { ok: false, error: "Creating campaigns in ad accounts is switched off." };
      if (!actorId) return { ok: false, error: "A person must launch the draft." };
      if (!/^https:\/\//i.test(spec.landingUrl)) return { ok: false, error: "The landing page must be an https address." };
      if (!(spec.dailyBudget > 0)) return { ok: false, error: "Set a daily budget." };
      return inner.createPausedCampaign(spec);
    },
    async activate(draft, actorId) {
      if (!opts.applyEnabled) return { ok: false, error: "Applying changes to ad accounts is switched off." };
      if (!actorId) return { ok: false, error: "A person must turn it on." };
      if (draft.status !== "LAUNCHED_PAUSED" || !draft.externalId) return { ok: false, error: "Only a campaign that was created paused by Autopilot can be turned on here." };
      if (!draft.complianceOk) return { ok: false, error: "The compliance checklist is not clear." };
      if (!draft.annexureApproved) return { ok: false, error: "The ad-approval annexure has not been recorded as approved." };
      if ((opts.fourEyes ?? true) && actorId === draft.createdById) return { ok: false, error: "A second person must turn this on." };
      return inner.activate(draft.externalId);
    },
  };
}

/** Adapter for tests and demos: remembers what it was asked and touches nothing. */
export function createFakeActionProvider() {
  const log: string[] = [];
  const campaigns = new Map<string, "PAUSED" | "ACTIVE">();
  let n = 0;
  const provider: ActionProvider & { log: string[]; campaigns: Map<string, "PAUSED" | "ACTIVE"> } = {
    name: "fake", log, campaigns,
    async apply(req) { log.push(`apply ${req.kind} ${req.targetIds.join(",")}`); return { ok: true, undoToken: `undo-${req.recId}` }; },
    async undo(token) { log.push(`undo ${token}`); return { ok: true }; },
    async createPausedCampaign(spec) { const id = `fake-${++n}`; campaigns.set(id, "PAUSED"); log.push(`create ${spec.name} PAUSED`); return { ok: true, externalId: id }; },
    async activate(id) { if (!campaigns.has(id)) return { ok: false, error: "unknown campaign" }; campaigns.set(id, "ACTIVE"); log.push(`activate ${id}`); return { ok: true }; },
  };
  return provider;
}

/**
 * Real adapter placeholder. The likely path for Meta is the ads connection (MCP) an Admin sets up in Settings. Until
 * credentials are entered there this adapter refuses every call, so nothing can reach a live account by accident.
 */
export function createUnconfiguredActionProvider(name = "unconfigured"): ActionProvider {
  const no = { ok: false as const, error: "No ad-account connection is configured. An Admin sets it up in Settings." };
  return { name, apply: async () => no, createPausedCampaign: async () => no, activate: async () => no };
}
