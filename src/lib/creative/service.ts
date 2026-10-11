import { canAccessMarketing } from "@/lib/access/marketing-access";

import type { BrandProfile } from "./brand";
import { attachReference as addReference } from "./competitor";
import { evaluateVariant, type VariantEvaluation } from "./evaluate";
import { isFormatKey, type FieldValues, type FormatKey } from "./formats";
import type { BriefInput, Kit } from "./kit";
import type { RuleCheck } from "@/lib/guardrails";
import { planVariantTransition, type VariantAction, type VariantStatus } from "./variant-workflow";

/**
 * Creative briefs and their variants: creation, editing and the Draft > Needs review > Approved workflow. The store and
 * the clock are injected, so the whole workflow is tested without a database. Every entry point checks the role again
 * (ADMIN or MARKETING), recomputes the compliance check on the text as saved (never trusting a stored result), and writes
 * with compare-and-set on the status so two people cannot both move one variant. Nothing here publishes anything.
 */

export type BriefRow = {
  id: string;
  title: string;
  topic: string;
  audience: string;
  language: "en" | "hinglish";
  hookType: string;
  usp: string | null;
  cta: string | null;
  master: { hook: string; usp: string; cta: string };
  formats: string[];
  referenceIds: string[];
  brandVersion: number | null;
  createdById: string;
};

export type VariantRow = {
  id: string;
  briefId: string;
  format: FormatKey;
  language: "en" | "hinglish";
  fields: FieldValues;
  disclaimer: string;
  status: VariantStatus;
  source: "STAFF" | "AI";
  complianceStatus: "PASS" | "FAIL";
  complianceChecks: RuleCheck[];
  score: number | null;
  verdict: string | null;
  authorId: string;
  approvedById: string | null;
  approvedAt: Date | null;
  reviewNote: string | null;
};

export type CreativeStore = {
  insertBrief(data: Omit<BriefRow, "id">): Promise<BriefRow>;
  insertVariant(data: Omit<VariantRow, "id">): Promise<VariantRow>;
  getBrief(id: string): Promise<BriefRow | null>;
  getVariant(id: string): Promise<VariantRow | null>;
  variantsOf(briefId: string): Promise<VariantRow[]>;
  casUpdateVariant(id: string, expected: VariantStatus, data: Partial<Omit<VariantRow, "id" | "briefId">>): Promise<boolean>;
  updateBriefReferences(id: string, referenceIds: string[]): Promise<void>;
  addEvent(e: { variantId: string; action: string; fromStatus?: string | null; toStatus?: string | null; actorId: string; note?: string | null }): Promise<void>;
  deleteBrief(id: string): Promise<void>;
};

export type Actor = { id: string; role: string };
export type ServiceDeps = {
  store: CreativeStore;
  getProfile(): Promise<{ version: number; profile: BrandProfile }>;
  loadReferenceCopies(ids: string[]): Promise<string[]>;
  audit(entry: { action: string; entityId: string; userId: string }): Promise<void>;
  now(): Date;
};

type Fail = { ok: false; error: string };
const NO_ACCESS: Fail = { ok: false, error: "Only an Admin or the marketing team can use creative drafts." };

export function createCreativeService(deps: ServiceDeps) {
  const { store } = deps;

  async function evaluate(brief: BriefRow, v: { format: FormatKey; fields: FieldValues; disclaimer: string; language: "en" | "hinglish" }, profile: BrandProfile): Promise<VariantEvaluation> {
    const referenceCopies = brief.referenceIds.length ? await deps.loadReferenceCopies(brief.referenceIds) : [];
    return evaluateVariant({ ...v, topic: brief.topic, profile, referenceCopies });
  }

  return {
    evaluate,

    async createFromKit(args: { input: BriefInput; kit: Kit; source: "STAFF" | "AI"; actor: Actor; referenceIds?: string[] }): Promise<{ ok: true; briefId: string } | Fail> {
      if (!canAccessMarketing(args.actor.role)) return NO_ACCESS;
      const { version, profile } = await deps.getProfile();
      const referenceIds = args.referenceIds ?? [];
      const brief = await store.insertBrief({
        title: args.input.title, topic: args.input.topic, audience: args.input.audience, language: args.input.language, hookType: args.input.hookType,
        usp: args.input.usp ?? null, cta: args.input.cta ?? null, master: args.kit.master, formats: args.kit.variants.map((v) => v.format), referenceIds, brandVersion: version, createdById: args.actor.id,
      });
      for (const draft of args.kit.variants) {
        if (!isFormatKey(draft.format)) continue;
        const ev = await evaluate(brief, { format: draft.format, fields: draft.fields, disclaimer: draft.disclaimer, language: args.input.language }, profile);
        const row = await store.insertVariant({
          briefId: brief.id, format: draft.format, language: args.input.language, fields: draft.fields, disclaimer: draft.disclaimer, status: "DRAFT", source: args.source,
          complianceStatus: ev.complianceStatus, complianceChecks: ev.checks, score: ev.score, verdict: ev.verdict, authorId: args.actor.id, approvedById: null, approvedAt: null, reviewNote: null,
        });
        await store.addEvent({ variantId: row.id, action: "created", toStatus: "DRAFT", actorId: args.actor.id, note: args.source === "AI" ? "Drafted by the AI path" : null });
      }
      return { ok: true, briefId: brief.id };
    },

    async editVariant(id: string, change: { fields?: FieldValues; disclaimer?: string }, actor: Actor): Promise<{ ok: true } | Fail> {
      if (!canAccessMarketing(actor.role)) return NO_ACCESS;
      const v = await store.getVariant(id);
      if (!v) return { ok: false, error: "That variant no longer exists." };
      const brief = await store.getBrief(v.briefId);
      if (!brief) return { ok: false, error: "That brief no longer exists." };
      const plan = planVariantTransition({ variant: { status: v.status, complianceStatus: v.complianceStatus, authorId: v.authorId, source: v.source }, action: "edit", actor });
      if (!plan.ok) return plan;
      const fields = change.fields ?? v.fields;
      const disclaimer = change.disclaimer ?? v.disclaimer;
      const { profile } = await deps.getProfile();
      const ev = await evaluate(brief, { format: v.format, fields, disclaimer, language: v.language }, profile);
      const ok = await store.casUpdateVariant(id, v.status, { fields, disclaimer, status: "DRAFT", approvedById: null, approvedAt: null, complianceStatus: ev.complianceStatus, complianceChecks: ev.checks, score: ev.score, verdict: ev.verdict });
      if (!ok) return { ok: false, error: "Someone else changed this variant first. Reload and try again." };
      await store.addEvent({ variantId: id, action: "edit", fromStatus: v.status, toStatus: "DRAFT", actorId: actor.id, note: plan.event.note ?? null });
      return { ok: true };
    },

    async transition(id: string, action: Exclude<VariantAction, "edit">, actor: Actor, opts: { confirmed?: boolean; note?: string } = {}): Promise<{ ok: true } | Fail> {
      if (!canAccessMarketing(actor.role)) return NO_ACCESS;
      const v = await store.getVariant(id);
      if (!v) return { ok: false, error: "That variant no longer exists." };
      const brief = await store.getBrief(v.briefId);
      if (!brief) return { ok: false, error: "That brief no longer exists." };
      // The check is run again on the copy as it is saved now; a stored PASS is never trusted.
      const { profile } = await deps.getProfile();
      const ev = await evaluate(brief, { format: v.format, fields: v.fields, disclaimer: v.disclaimer, language: v.language }, profile);
      const plan = planVariantTransition({ variant: { status: v.status, complianceStatus: ev.complianceStatus, authorId: v.authorId, source: v.source }, action, actor, confirmed: opts.confirmed, note: opts.note, now: deps.now() });
      if (!plan.ok) return plan;
      const ok = await store.casUpdateVariant(id, v.status, { ...plan.next, complianceStatus: ev.complianceStatus, complianceChecks: ev.checks, score: ev.score, verdict: ev.verdict });
      if (!ok) return { ok: false, error: "Someone else changed this variant first. Reload and try again." };
      await store.addEvent({ variantId: id, action, fromStatus: plan.event.from, toStatus: plan.event.to, actorId: actor.id, note: plan.event.note ?? null });
      if (action === "approve") await deps.audit({ action: "creative_variant_approved", entityId: id, userId: actor.id });
      return { ok: true };
    },

    async attachReference(briefId: string, adId: string, actor: Actor): Promise<{ ok: true } | Fail> {
      if (!canAccessMarketing(actor.role)) return NO_ACCESS;
      const brief = await store.getBrief(briefId);
      if (!brief) return { ok: false, error: "That brief no longer exists." };
      const next = addReference(brief.referenceIds, adId);
      if (next === brief.referenceIds) return { ok: false, error: "That reference is already attached, or the brief has the most it can hold." };
      await store.updateBriefReferences(briefId, next);
      const updated = { ...brief, referenceIds: next };
      const { profile } = await deps.getProfile();
      for (const v of await store.variantsOf(briefId)) {
        const ev = await evaluate(updated, { format: v.format, fields: v.fields, disclaimer: v.disclaimer, language: v.language }, profile);
        // A variant that now fails cannot stay in review or approved.
        const status: VariantStatus = ev.complianceStatus === "FAIL" ? "DRAFT" : v.status;
        await store.casUpdateVariant(v.id, v.status, { complianceStatus: ev.complianceStatus, complianceChecks: ev.checks, score: ev.score, verdict: ev.verdict, status, ...(status !== v.status ? { approvedById: null, approvedAt: null } : {}) });
        if (status !== v.status) await store.addEvent({ variantId: v.id, action: "edit", fromStatus: v.status, toStatus: status, actorId: actor.id, note: "Sent back to Draft: the copy echoes a competitor reference." });
      }
      return { ok: true };
    },

    async discardBrief(briefId: string, actor: Actor): Promise<{ ok: true } | Fail> {
      if (!canAccessMarketing(actor.role)) return NO_ACCESS;
      const variants = await store.variantsOf(briefId);
      if (variants.some((v) => v.status === "APPROVED")) return { ok: false, error: "A brief with approved copy cannot be deleted." };
      await store.deleteBrief(briefId);
      return { ok: true };
    },
  };
}
