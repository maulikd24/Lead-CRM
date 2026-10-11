import { Prisma } from "@/generated/prisma/client";
import { isAgentEnabled } from "@/lib/agents/wiring";
import { callModel, gatewayProvider } from "@/lib/ai/gateway";
import { getCampaignOutcomeProvider } from "@/lib/attribution";
import { prisma } from "@/lib/db/prisma";
import type { EventTx } from "@/lib/events/emit-db";
import { addDays, todayInTimeZone } from "@/lib/marketing/dates";

import { buildMissing, type MissingItem } from "./board";
import { CHANNELS, isChannelKey, requiresRegisteredCreator, type ChannelKey } from "./channels";
import { PLANNER_COPY_AGENT_KEY, appendDisclaimer, checkCopyDraft, draftCopyWithAi, type AiCopyDeps } from "./copy";
import { DEFAULT_AUDIENCES, DEFAULT_PROMISES } from "./defaults";
import { checkDestinationPattern, isDestinationKind, isDestinationStatus } from "./destinations";
import { checkPromise } from "./guardrails";
import { buildTrackedLinks, type TrackedLinksResult } from "./links";
import { newCampaignCode } from "./naming";
import { getProductCiter, mentionsProduct, type ProductCiter } from "./product-citation";
import { campaignOptions, funnelEstimateFor, planOutcomeFor } from "./outcomes";
import { resolveOwner, validateRule, type LeadFacts, type RoutingDecision, type RoutingRule } from "./routing";
import type { AudienceView, PlanView } from "./types";
import { FOLLOW_UP_PURPOSES, buildChecklist, decideTransition, isPlanStatus, isRegisteredCreator, type ChecklistContext, type ChecklistItem, type PlanAction, type PlanStatus } from "./workflow";

/**
 * All planner reads and writes. The caller (a server action or page) has already checked canAccessMarketing; the
 * registry tables (audiences, destinations, creators, routing rules) are Admin-only and the caller checks that too.
 * Nothing here selects a customer's name, phone, email or PAN: the only customer rows it reads are counted.
 */

export type Actor = { id: string; role: string };
export type Result<T = { id: string }> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const TZ = "Asia/Kolkata";
export const todayYmd = (now = new Date()) => todayInTimeZone(now, TZ);

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");
const list = (v: unknown, max = 30, each = 80): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : []).map((x) => text(x, each)).filter(Boolean).slice(0, max);
const ymd = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);
const toDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);
const fromDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// ------------------------------------------------------------------ defaults

/** Loads the three audiences and the starter promises the first time the planner is opened. Idempotent. */
export async function ensurePlannerDefaults(): Promise<void> {
  const audiences = await prisma.plannerAudience.count();
  if (audiences === 0) {
    for (const [i, a] of DEFAULT_AUDIENCES.entries()) await prisma.plannerAudience.upsert({ where: { key: a.key }, update: {}, create: { ...a, sortOrder: i } });
  }
  if ((await prisma.plannerPromise.count()) === 0) await prisma.plannerPromise.createMany({ data: DEFAULT_PROMISES });
}

// ------------------------------------------------------------------ audiences

export type AudienceInput = { key?: unknown; name: unknown; description: unknown; languages: unknown; cities: unknown; channels: unknown; tone: unknown; productFit: unknown; objections: unknown; complianceNote: unknown };

function audienceData(i: AudienceInput) {
  return { name: text(i.name, 80), description: text(i.description, 600), languages: list(i.languages), cities: list(i.cities), channels: list(i.channels).filter(isChannelKey), tone: text(i.tone, 400), productFit: text(i.productFit, 600), objections: text(i.objections, 600), complianceNote: text(i.complianceNote, 800) };
}

export async function saveAudience(id: string | null, input: AudienceInput): Promise<Result> {
  const data = audienceData(input);
  if (!data.name) return fail("Give the audience a name.");
  if (!data.complianceNote) return fail("Every audience needs a compliance note.");
  if (id) {
    const row = await prisma.plannerAudience.update({ where: { id }, data }).catch(() => null);
    return row ? { ok: true, id: row.id } : fail("That audience no longer exists.");
  }
  const base = text(input.key, 40).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "audience";
  let key = base;
  for (let n = 2; await prisma.plannerAudience.findUnique({ where: { key }, select: { id: true } }); n++) key = `${base}_${n}`;
  const count = await prisma.plannerAudience.count();
  const row = await prisma.plannerAudience.create({ data: { ...data, key, sortOrder: count } });
  return { ok: true, id: row.id };
}

export async function setAudienceArchived(id: string, archived: boolean): Promise<Result> {
  const row = await prisma.plannerAudience.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } }).catch(() => null);
  return row ? { ok: true, id } : fail("That audience no longer exists.");
}

export const listAudiences = () => prisma.plannerAudience.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });

// ------------------------------------------------------------------ promises

export type PromiseInput = { hook: unknown; evidence: unknown; product: unknown; mentionsProduct?: unknown; productRegistryId?: unknown; destinationId?: unknown; allowedClaims: unknown; disallowedClaims: unknown };

export async function savePromise(id: string | null, input: PromiseInput): Promise<Result> {
  const data = { hook: text(input.hook, 200), evidence: text(input.evidence, 800), product: text(input.product, 120), mentionsProduct: input.mentionsProduct === true || input.mentionsProduct === "on" || input.mentionsProduct === "true", productRegistryId: text(input.productRegistryId, 80) || null, allowedClaims: list(input.allowedClaims, 20, 200), disallowedClaims: list(input.disallowedClaims, 20, 200), destinationId: text(input.destinationId, 40) || null };
  if (!data.hook) return fail("Write the promise (the hook).");
  if (!data.product) return fail("Say which product or tool the promise leads to.");
  if (data.destinationId && !(await prisma.plannerDestination.findUnique({ where: { id: data.destinationId }, select: { id: true } }))) return fail("That destination does not exist.");
  if (id) {
    const row = await prisma.plannerPromise.update({ where: { id }, data }).catch(() => null);
    return row ? { ok: true, id } : fail("That promise no longer exists.");
  }
  const row = await prisma.plannerPromise.create({ data });
  return { ok: true, id: row.id };
}

export async function setPromiseArchived(id: string, archived: boolean): Promise<Result> {
  if (archived && (await prisma.plannerPlan.count({ where: { promiseId: id, status: { in: ["NEEDS_REVIEW", "APPROVED", "SCHEDULED"] } } })) > 0) return fail("Plans that are in review, approved or scheduled still use this promise.");
  const row = await prisma.plannerPromise.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } }).catch(() => null);
  return row ? { ok: true, id } : fail("That promise no longer exists.");
}

export const listPromises = () => prisma.plannerPromise.findMany({ orderBy: { createdAt: "asc" }, include: { destination: { select: { name: true, status: true } } } });

// ------------------------------------------------------------------ destinations

export type DestinationInput = { name: unknown; kind: unknown; urlPattern: unknown; ownerId?: unknown; status: unknown; notes?: unknown };

export async function saveDestination(id: string | null, input: DestinationInput): Promise<Result> {
  const kind = text(input.kind, 20);
  const status = text(input.status, 10);
  const urlPattern = text(input.urlPattern, 500);
  const name = text(input.name, 100);
  if (!name) return fail("Name the destination.");
  if (!isDestinationKind(kind)) return fail("Choose what kind of destination it is.");
  if (!isDestinationStatus(status)) return fail("Choose a status: live, planned or off.");
  const ownerId = text(input.ownerId, 40) || null;
  if (ownerId && !(await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } }))) return fail("That owner does not exist.");
  const check = checkDestinationPattern(kind, urlPattern);
  // A destination is saved even with a bad pattern (it can be planned before it exists), but it cannot be live.
  if (status === "LIVE" && !check.ok) return fail(`A live destination needs a valid URL: ${check.message}`);
  const data = { name, kind, urlPattern, status, ownerId, notes: text(input.notes, 400) || null, lastCheckedAt: new Date(), lastCheckOk: check.ok, lastCheckMessage: check.message };
  if (id) {
    const row = await prisma.plannerDestination.update({ where: { id }, data }).catch(() => null);
    return row ? { ok: true, id } : fail("That destination no longer exists.");
  }
  const row = await prisma.plannerDestination.create({ data });
  return { ok: true, id: row.id };
}

/** Re-runs the URL pattern check for every destination and stores the result. Checks the pattern only; it never calls the URL. */
export async function runDestinationHealthChecks(): Promise<number> {
  const rows = await prisma.plannerDestination.findMany();
  const now = new Date();
  for (const r of rows) {
    const c = checkDestinationPattern(r.kind, r.urlPattern);
    await prisma.plannerDestination.update({ where: { id: r.id }, data: { lastCheckedAt: now, lastCheckOk: c.ok, lastCheckMessage: c.message } });
  }
  return rows.length;
}

export const listDestinations = () => prisma.plannerDestination.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { _count: { select: { plans: true } } } });

// ------------------------------------------------------------------ creators

export type CreatorInput = { name: unknown; handle: unknown; platform: unknown; sebiRegistration?: unknown; notes?: unknown };

export async function saveCreator(id: string | null, input: CreatorInput): Promise<Result> {
  const reg = text(input.sebiRegistration, 20).toUpperCase() || null;
  if (reg && !isRegisteredCreator({ sebiRegistration: reg })) return fail("A SEBI registration number looks like INH000012345 (three letters, then nine digits).");
  const data = { name: text(input.name, 100), handle: text(input.handle, 100), platform: text(input.platform, 40) || "YouTube", sebiRegistration: reg, notes: text(input.notes, 400) || null };
  if (!data.name || !data.handle) return fail("Enter the creator's name and handle.");
  if (id) {
    const row = await prisma.plannerCreator.update({ where: { id }, data }).catch(() => null);
    return row ? { ok: true, id } : fail("That creator no longer exists.");
  }
  const row = await prisma.plannerCreator.create({ data });
  return { ok: true, id: row.id };
}

export const listCreators = () => prisma.plannerCreator.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { plans: true } } } });

// ------------------------------------------------------------------ routing rules

export type RuleInput = { name: unknown; priority?: unknown; enabled?: unknown; cities: unknown; languages: unknown; products: unknown; audienceKey?: unknown; ownerId?: unknown; ownerLabel?: unknown; isFallback?: unknown };

export async function saveRule(id: string | null, input: RuleInput): Promise<Result> {
  const data = { name: text(input.name, 80), priority: Math.max(1, Math.min(9999, Math.trunc(Number(input.priority) || 100))), enabled: input.enabled !== false, cities: list(input.cities, 20), languages: list(input.languages, 20), products: list(input.products, 20), audienceKey: text(input.audienceKey, 40) || null, ownerId: text(input.ownerId, 40) || null, ownerLabel: text(input.ownerLabel, 60) || null, isFallback: input.isFallback === true };
  const errors = validateRule(data);
  if (errors.length) return fail(errors[0]);
  if (data.ownerId) {
    const u = await prisma.user.findUnique({ where: { id: data.ownerId }, select: { isActive: true } });
    if (!u?.isActive) return fail("The owner must be an active user.");
  }
  if (data.isFallback && data.enabled) await prisma.plannerRoutingRule.updateMany({ where: { isFallback: true, ...(id ? { id: { not: id } } : {}) }, data: { isFallback: false } });
  if (id) {
    const row = await prisma.plannerRoutingRule.update({ where: { id }, data }).catch(() => null);
    return row ? { ok: true, id } : fail("That rule no longer exists.");
  }
  const row = await prisma.plannerRoutingRule.create({ data });
  return { ok: true, id: row.id };
}

export async function deleteRule(id: string): Promise<Result> {
  const row = await prisma.plannerRoutingRule.delete({ where: { id } }).catch(() => null);
  return row ? { ok: true, id } : fail("That rule no longer exists.");
}

export async function loadRules(): Promise<RoutingRule[]> {
  const rows = await prisma.plannerRoutingRule.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  return rows.map(({ id, name, priority, enabled, cities, languages, products, audienceKey, ownerId, ownerLabel, isFallback }) => ({ id, name, priority, enabled, cities, languages, products, audienceKey, ownerId, ownerLabel, isFallback }));
}

/** For the lead intake: who owns a lead that arrived with this campaign code? Null means "not ours: use the existing assignment". */
export async function ownerForCampaignLead(code: string, lead: Omit<LeadFacts, "audienceKey">): Promise<{ decision: RoutingDecision; planId: string } | null> {
  const plan = await prisma.plannerPlan.findUnique({ where: { code }, select: { id: true, status: true, audience: { select: { key: true } }, promise: { select: { product: true } } } });
  if (!plan || plan.status === "DRAFT") return null;
  const decision = resolveOwner(await loadRules(), { product: plan.promise.product, ...lead, audienceKey: plan.audience.key });
  if (!decision.ownerId) return null;
  const owner = await prisma.user.findUnique({ where: { id: decision.ownerId }, select: { isActive: true } });
  return owner?.isActive ? { decision, planId: plan.id } : null;
}

// ------------------------------------------------------------------ plans

const PLAN_INCLUDE = { audience: true, promise: true, destination: true, creator: true, copies: { select: { id: true, status: true } } } satisfies Prisma.PlannerPlanInclude;
type PlanRow = Prisma.PlannerPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

function contextFor(row: PlanRow, rules: RoutingRule[], product: ProductState): ChecklistContext {
  const routing = resolveOwner(rules, { audienceKey: row.audience.key, product: row.promise.product });
  return {
    promiseOk: checkPromise({ hook: row.promise.hook, evidence: row.promise.evidence, product: row.promise.product, allowedClaims: row.promise.allowedClaims, disallowedClaims: row.promise.disallowedClaims }).ok,
    destination: { status: row.destination.status, patternOk: checkDestinationPattern(row.destination.kind, row.destination.urlPattern).ok },
    linksTested: !!row.linksTestedAt,
    routing: { via: routing.via, ownerId: routing.ownerId },
    consentPurpose: row.consentPurpose,
    copies: row.copies,
    creator: row.creator ? { sebiRegistration: row.creator.sebiRegistration } : null,
    channel: row.channel as ChannelKey,
    product,
  };
}
export const checklistOf = (row: PlanRow, rules: RoutingRule[], product: ProductState): ChecklistItem[] => buildChecklist(contextFor(row, rules, product));

export type ProductState = { mentions: boolean; cited: boolean };
type PromiseLike = { id: string; hook: string; allowedClaims: string[]; mentionsProduct: boolean; productRegistryId: string | null };

/** Does each promise name a product, and did the Product Registry approve it? Fails closed (product-citation.ts). */
export async function productStates(promises: PromiseLike[], citer: ProductCiter = getProductCiter()): Promise<Map<string, ProductState>> {
  const out = new Map<string, ProductState>();
  for (const p of promises) {
    if (out.has(p.id)) continue;
    const mentions = mentionsProduct(p);
    let cited = false;
    if (mentions && p.productRegistryId) {
      try {
        cited = (await citer(p.productRegistryId)).ok;
      } catch {
        cited = false;
      }
    }
    out.set(p.id, { mentions, cited });
  }
  return out;
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(rows.map((u) => [u.id, u.name]));
}

function viewOf(row: PlanRow, rules: RoutingRule[], names: Map<string, string>, product: ProductState): PlanView {
  return {
    id: row.id, code: row.code, title: row.title, audienceId: row.audienceId, audienceKey: row.audience.key, audienceName: row.audience.name, promiseId: row.promiseId, promiseHook: row.promise.hook,
    channel: row.channel as ChannelKey, destinationId: row.destinationId, destinationName: row.destination.name, destinationStatus: row.destination.status, creatorId: row.creatorId, budgetInr: row.budgetInr,
    startDate: fromDate(row.startDate), endDate: fromDate(row.endDate), ownerId: row.ownerId, ownerName: names.get(row.ownerId) ?? "Unknown", status: (isPlanStatus(row.status) ? row.status : "DRAFT") as PlanStatus,
    failing: checklistOf(row, rules, product).filter((i) => i.status === "fail").map((i) => i.id),
  };
}

export async function loadPlanViews(): Promise<PlanView[]> {
  const [rows, rules] = await Promise.all([prisma.plannerPlan.findMany({ include: PLAN_INCLUDE, orderBy: [{ startDate: "asc" }, { createdAt: "desc" }] }), loadRules()]);
  const names = await userNames(rows.map((r) => r.ownerId));
  const products = await productStates(rows.map((r) => r.promise));
  return rows.map((r) => viewOf(r, rules, names, products.get(r.promiseId) ?? { mentions: false, cited: false }));
}

export async function loadMissing(): Promise<MissingItem[]> {
  const [plans, audiences, rules] = await Promise.all([loadPlanViews(), prisma.plannerAudience.findMany(), loadRules()]);
  const live = rules.filter((r) => r.enabled && r.ownerId);
  return buildMissing({
    audiences: audiences.map((a): AudienceView => ({ id: a.id, key: a.key, name: a.name, archived: !!a.archivedAt })),
    plans,
    routing: { hasFallback: live.some((r) => r.isFallback), audienceKeysWithRule: live.filter((r) => !r.isFallback && r.audienceKey).map((r) => r.audienceKey as string) },
  });
}

export type PlanInput = { title: unknown; audienceId: unknown; promiseId: unknown; channel: unknown; destinationId: unknown; creatorId?: unknown; budgetInr?: unknown; startDate?: unknown; endDate?: unknown; ownerId: unknown; consentPurpose?: unknown; outcomeKey?: unknown; notes?: unknown };

async function planData(i: PlanInput): Promise<Result<{ data: Prisma.PlannerPlanUncheckedCreateInput }>> {
  const channel = text(i.channel, 30);
  if (!isChannelKey(channel)) return fail("Choose a channel.");
  const title = text(i.title, 120);
  if (!title) return fail("Give the plan a title.");
  const [audience, promise, destination, owner] = await Promise.all([
    prisma.plannerAudience.findUnique({ where: { id: text(i.audienceId, 40) } }),
    prisma.plannerPromise.findUnique({ where: { id: text(i.promiseId, 40) } }),
    prisma.plannerDestination.findUnique({ where: { id: text(i.destinationId, 40) } }),
    prisma.user.findUnique({ where: { id: text(i.ownerId, 40) }, select: { id: true, isActive: true } }),
  ]);
  if (!audience || audience.archivedAt) return fail("Choose an audience that is not archived.");
  if (!promise || promise.archivedAt) return fail("Choose a promise that is not archived.");
  if (!destination) return fail("Choose a destination.");
  if (!owner?.isActive) return fail("Choose an active person as the owner.");
  const creatorId = text(i.creatorId, 40) || null;
  if (creatorId) {
    const creator = await prisma.plannerCreator.findUnique({ where: { id: creatorId } });
    if (!creator) return fail("That creator does not exist.");
    if (!isRegisteredCreator(creator)) return fail("This creator has no valid SEBI registration number. Unregistered creators cannot be attached.");
  }
  if (creatorId && !requiresRegisteredCreator(channel)) return fail("Only short-video plans use a creator.");
  const startDate = i.startDate ? ymd(i.startDate) : null;
  const endDate = i.endDate ? ymd(i.endDate) : null;
  if ((i.startDate && !startDate) || (i.endDate && !endDate)) return fail("Dates look like 2026-11-15.");
  if (startDate && endDate && endDate < startDate) return fail("The end date is before the start date.");
  const budget = i.budgetInr === "" || i.budgetInr == null ? null : Number(i.budgetInr);
  if (budget !== null && (!Number.isInteger(budget) || budget < 0 || budget > 1_000_000_000)) return fail("The budget is a whole number of rupees.");
  const purpose = text(i.consentPurpose, 40) || null;
  if (purpose && !(FOLLOW_UP_PURPOSES as readonly string[]).includes(purpose)) return fail("Choose marketing or service messages as the follow-up consent purpose.");
  return { ok: true, data: { code: "", title, audienceId: audience.id, promiseId: promise.id, channel, destinationId: destination.id, creatorId, budgetInr: budget, startDate: toDate(startDate), endDate: toDate(endDate), ownerId: owner.id, consentPurpose: purpose, outcomeKey: text(i.outcomeKey, 120) || null, notes: text(i.notes, 600) || null, createdById: "" } };
}

async function logEvent(planId: string, actorId: string, kind: string, extra: { fromStatus?: string; toStatus?: string; note?: string } = {}, tx: EventTx | typeof prisma = prisma) {
  await tx.plannerEvent.create({ data: { planId, actorId, kind, fromStatus: extra.fromStatus ?? null, toStatus: extra.toStatus ?? null, note: extra.note?.slice(0, 500) ?? null } });
}

export async function createPlan(input: PlanInput, actor: Actor, random?: () => number): Promise<Result<{ id: string; code: string }>> {
  const built = await planData(input);
  if (!built.ok) return built;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newCampaignCode(random);
    try {
      const row = await prisma.plannerPlan.create({ data: { ...built.data, code, createdById: actor.id } });
      await logEvent(row.id, actor.id, "CREATED", { toStatus: "DRAFT" });
      return { ok: true, id: row.id, code };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return fail("Could not generate a free campaign code. Try again.");
}

export async function updatePlan(id: string, input: PlanInput, actor: Actor): Promise<Result> {
  const current = await prisma.plannerPlan.findUnique({ where: { id } });
  if (!current) return fail("That plan no longer exists.");
  const built = await planData(input);
  if (!built.ok) return built;
  const { code: _c, createdById: _b, ...data } = built.data;
  void _c; void _b;
  const sameContent = (["title", "audienceId", "promiseId", "channel", "destinationId", "creatorId", "budgetInr", "ownerId", "consentPurpose"] as const).every((k) => current[k] === (data as Record<string, unknown>)[k]) && fromDate(current.startDate) === fromDate((data.startDate as Date | null) ?? null) && fromDate(current.endDate) === fromDate((data.endDate as Date | null) ?? null);
  const decision = decideTransition({ plan: planForFlow(current), action: "edit", actor: actor.id, checklist: [], today: todayYmd() });
  const patch = sameContent ? {} : decision.ok ? decision.patch : {};
  const res = await prisma.plannerPlan.updateMany({ where: { id, status: current.status }, data: { ...data, ...patch } });
  if (res.count === 0) return fail("Someone else changed this plan. Reload and try again.");
  if (!sameContent) await logEvent(id, actor.id, "EDITED", { fromStatus: current.status, toStatus: "DRAFT", note: current.status === "DRAFT" ? undefined : "Edited: approval withdrawn" });
  return { ok: true, id };
}

function planForFlow(p: { status: string; createdById: string; ownerId: string; startDate: Date | null; endDate: Date | null; linksTestedAt: Date | null; approvedById: string | null; channel: string }) {
  return { status: (isPlanStatus(p.status) ? p.status : "DRAFT") as PlanStatus, createdById: p.createdById, ownerId: p.ownerId, startDate: fromDate(p.startDate), endDate: fromDate(p.endDate), linksTestedAt: p.linksTestedAt, approvedById: p.approvedById, channel: p.channel as ChannelKey };
}

export async function transitionPlan(id: string, action: Exclude<PlanAction, "edit">, actor: Actor, opts: { confirmed?: boolean; note?: string } = {}): Promise<Result> {
  const row = await prisma.plannerPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
  if (!row) return fail("That plan no longer exists.");
  const rules = await loadRules();
  const d = decideTransition({ plan: planForFlow(row), action, actor: actor.id, checklist: checklistOf(row, rules, (await productStates([row.promise])).get(row.promiseId) ?? { mentions: false, cited: false }), today: todayYmd(), confirmed: opts.confirmed, note: opts.note });
  if (!d.ok) return fail(d.error);
  const patch = { ...d.patch, ...(action === "approve" ? { approvedAt: new Date() } : {}) } as Prisma.PlannerPlanUncheckedUpdateManyInput;
  const done = await prisma.$transaction(async (tx) => {
    const res = await tx.plannerPlan.updateMany({ where: { id, status: row.status }, data: patch });
    if (res.count === 0) return false;
    await logEvent(id, actor.id, "STATUS", { fromStatus: row.status, toStatus: d.to, note: opts.note }, tx);
    return true;
  });
  return done ? { ok: true, id } : fail("Someone else changed this plan. Reload and try again.");
}

export async function setLinksTested(id: string, tested: boolean, actor: Actor): Promise<Result> {
  const row = await prisma.plannerPlan.findUnique({ where: { id }, select: { status: true } });
  if (!row) return fail("That plan no longer exists.");
  await prisma.plannerPlan.update({ where: { id }, data: { linksTestedAt: tested ? new Date() : null, linksTestedById: tested ? actor.id : null } });
  await logEvent(id, actor.id, "LINKS_TESTED", { note: tested ? "Tracked links tested" : "Tested mark removed" });
  return { ok: true, id };
}

export async function deletePlan(id: string, actor: Actor): Promise<Result> {
  const row = await prisma.plannerPlan.findUnique({ where: { id }, select: { status: true } });
  if (!row) return fail("That plan no longer exists.");
  if (row.status !== "DRAFT") return fail("Only a draft can be deleted. Send the plan back to draft first.");
  await prisma.plannerPlan.delete({ where: { id } });
  void actor;
  return { ok: true, id };
}

// ------------------------------------------------------------------ plan detail

export async function loadPlanDetail(id: string, now = new Date()) {
  const row = await prisma.plannerPlan.findUnique({ where: { id }, include: { audience: true, promise: true, destination: true, creator: true, copies: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "desc" }, take: 100 } } });
  if (!row) return null;
  const rules = await loadRules();
  const asRow = { ...row, copies: row.copies.map((c) => ({ id: c.id, status: c.status })) } as PlanRow;
  const names = await userNames([row.ownerId, row.createdById, ...(row.approvedById ? [row.approvedById] : []), ...row.copies.flatMap((c) => [c.createdById, ...(c.reviewedById ? [c.reviewedById] : [])]), ...row.events.map((e) => e.actorId)]);
  const product = (await productStates([row.promise])).get(row.promiseId) ?? { mentions: false, cited: false };
  const checklist = checklistOf(asRow, rules, product);
  const links: TrackedLinksResult = buildTrackedLinks({
    code: row.code,
    channel: row.channel as ChannelKey,
    audienceName: row.audience.name,
    hook: row.promise.hook,
    startDate: fromDate(row.startDate) ?? todayYmd(now),
    destination: { kind: row.destination.kind, urlPattern: row.destination.urlPattern },
  });
  const routing = resolveOwner(rules, { audienceKey: row.audience.key, product: row.promise.product });
  const provider = getCampaignOutcomeProvider();
  const today = todayYmd(now);
  const [funnel, outcome] = await Promise.all([funnelEstimateFor(provider, { channel: row.channel as ChannelKey, budgetInr: row.budgetInr }, today), planOutcomeFor(provider, row.outcomeKey, today)]);
  return { row, checklist, links, routing, routingOwnerName: routing.ownerId ? (await userNames([routing.ownerId])).get(routing.ownerId) ?? null : null, promiseCheck: checkPromise(row.promise), product, funnel, outcome, names };
}

// ------------------------------------------------------------------ outcomes and funnel
// Every number comes from the canonical CampaignOutcomeProvider (outcomes.ts). This file counts nothing and reads no customer or spend table.

export const campaignChoices = (now = new Date()) => campaignOptions(getCampaignOutcomeProvider(), todayYmd(now));

// ------------------------------------------------------------------ copy drafts

export async function addCopy(planId: string, body: unknown, actor: Actor): Promise<Result> {
  const plan = await prisma.plannerPlan.findUnique({ where: { id: planId }, select: { channel: true } });
  if (!plan) return fail("That plan no longer exists.");
  const raw = text(body, 20_000);
  if (!raw) return fail("Write the copy first.");
  const withDisclaimer = appendDisclaimer(plan.channel as ChannelKey, raw);
  const check = checkCopyDraft({ channel: plan.channel, body: withDisclaimer });
  const row = await prisma.plannerCopy.create({ data: { planId, body: withDisclaimer, source: "STAFF", status: "DRAFT", issues: check.issues, createdById: actor.id } });
  await logEvent(planId, actor.id, "COPY_ADDED", { note: "Copy draft added" });
  return { ok: true, id: row.id };
}

async function withdrawPlanApproval(planId: string, actor: Actor, why: string) {
  const plan = await prisma.plannerPlan.findUnique({ where: { id: planId }, select: { status: true } });
  if (plan && (plan.status === "APPROVED" || plan.status === "SCHEDULED" || plan.status === "NEEDS_REVIEW")) {
    await prisma.plannerPlan.update({ where: { id: planId }, data: { status: "DRAFT", approvedById: null, approvedAt: null } });
    await logEvent(planId, actor.id, "STATUS", { fromStatus: plan.status, toStatus: "DRAFT", note: why });
  }
}

export async function editCopy(copyId: string, body: unknown, actor: Actor): Promise<Result> {
  const copy = await prisma.plannerCopy.findUnique({ where: { id: copyId }, include: { plan: { select: { channel: true } } } });
  if (!copy) return fail("That copy no longer exists.");
  const raw = text(body, 20_000);
  if (!raw) return fail("Write the copy first.");
  const withDisclaimer = appendDisclaimer(copy.plan.channel as ChannelKey, raw);
  await prisma.plannerCopy.update({ where: { id: copyId }, data: { body: withDisclaimer, status: "DRAFT", issues: checkCopyDraft({ channel: copy.plan.channel, body: withDisclaimer }).issues, reviewedById: null, reviewedAt: null } });
  if (copy.status === "APPROVED") await withdrawPlanApproval(copy.planId, actor, "Approved copy was edited: plan back to draft");
  return { ok: true, id: copyId };
}

export async function copyAction(copyId: string, action: "submit" | "approve" | "request_changes", actor: Actor, opts: { confirmed?: boolean } = {}): Promise<Result> {
  const copy = await prisma.plannerCopy.findUnique({ where: { id: copyId }, include: { plan: { select: { channel: true } } } });
  if (!copy) return fail("That copy no longer exists.");
  const check = checkCopyDraft({ channel: copy.plan.channel, body: copy.body });
  if (action === "submit") {
    if (copy.status !== "DRAFT") return fail("Only a draft can be sent for review.");
    if (!check.ok) return fail(`Fix the compliance issues first: ${check.issues[0].message}`);
    await prisma.plannerCopy.update({ where: { id: copyId }, data: { status: "NEEDS_REVIEW", issues: check.issues } });
    return { ok: true, id: copyId };
  }
  if (copy.status !== "NEEDS_REVIEW") return fail("Only copy that is waiting for review can be decided.");
  if (action === "request_changes") {
    await prisma.plannerCopy.update({ where: { id: copyId }, data: { status: "DRAFT", reviewedById: actor.id, reviewedAt: new Date() } });
    return { ok: true, id: copyId };
  }
  if (!opts.confirmed) return fail("Tick the box to confirm you have read this copy and its disclaimer.");
  if (copy.source === "STAFF" && copy.createdById === actor.id) return fail("A different person must approve this copy: the person who wrote it cannot.");
  if (!check.ok) return fail(`The copy fails a compliance check: ${check.issues[0].message}`);
  await prisma.plannerCopy.update({ where: { id: copyId }, data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date(), issues: [] } });
  await logEvent(copy.planId, actor.id, "COPY_APPROVED", { note: "Copy approved" });
  return { ok: true, id: copyId };
}

export async function deleteCopy(copyId: string): Promise<Result> {
  const copy = await prisma.plannerCopy.findUnique({ where: { id: copyId }, select: { status: true } });
  if (!copy) return fail("That copy no longer exists.");
  if (copy.status === "APPROVED") return fail("Approved copy cannot be deleted. Edit it to send it back to draft first.");
  await prisma.plannerCopy.delete({ where: { id: copyId } });
  return { ok: true, id: copyId };
}

/** The real wiring: callModel() for the draft, the gateway-backed provider for the compliance judge, the planner_copy kill switch. */
export const aiCopyDeps = (): AiCopyDeps => ({
  call: (input) => callModel(input),
  judge: gatewayProvider(),
  isEnabled: () => isAgentEnabled(PLANNER_COPY_AGENT_KEY),
});

export async function aiDraftCopy(planId: string, actor: Actor, deps: AiCopyDeps = aiCopyDeps()): Promise<Result> {
  const plan = await prisma.plannerPlan.findUnique({ where: { id: planId }, include: { audience: true, promise: true } });
  if (!plan) return fail("That plan no longer exists.");
  const r = await draftCopyWithAi({ channel: plan.channel as ChannelKey, hook: plan.promise.hook, product: plan.promise.product, audienceName: plan.audience.name, tone: plan.audience.tone }, deps);
  if (!r.ok) {
    const why: Record<string, string> = { disabled: "AI drafting is switched off.", invalid: "The plan needs a channel and a promise.", unavailable: "The AI service could not be reached. Nothing was saved.", blocked: "The AI gateway refused the call (a budget or a kill switch). Nothing was saved.", abstained: "The AI declined to draft this and asked for a person to write it.", no_draft: "The AI did not produce a draft.", unsafe: `The draft failed a compliance check and was not kept${r.detail ? `: ${r.detail}` : "."}` };
    return fail(why[r.reason] ?? "No draft was produced.");
  }
  const row = await prisma.plannerCopy.create({ data: { planId, body: r.body, source: "AI", status: "DRAFT", issues: [], createdById: actor.id } });
  await logEvent(planId, actor.id, "COPY_ADDED", { note: "AI copy draft added" });
  return { ok: true, id: row.id };
}

export { CHANNELS };
