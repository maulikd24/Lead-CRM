import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

import { citeFromRecords, type CitationResult } from "./cite";
import { decideReview, retire, submitForReview, suspend, type Actor } from "./lifecycle";
import { validateContent, type ContentInput, type EligibilityRule, type MarketingClaim, type ProductContent, type ProductHead, type ProductStatus, type SalesRestriction, type VersionRow, type VersionState } from "./model";

/**
 * The registry's data service (Prisma). Every write is one transaction with its AuditLog row. The only callers are the ADMIN
 * server actions and the seed; reads for other roles go through the narrow loaders at the bottom.
 */

type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type VersionDb = NonNullable<Awaited<ReturnType<typeof prisma.registryProductVersion.findFirst>>>;
type HeadDb = NonNullable<Awaited<ReturnType<typeof prisma.registryProduct.findFirst>>>;

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const toVersionRow = (v: VersionDb): VersionRow & { createdById: string | null; productId: string } => ({
  id: v.id,
  productId: v.productId,
  versionNo: v.versionNo,
  state: v.state as VersionState,
  name: v.name,
  category: v.category as VersionRow["category"],
  summary: v.summary,
  availability: v.availability as VersionRow["availability"],
  minInvestmentMinor: v.minInvestmentMinor === null ? null : Number(v.minInvestmentMinor),
  currency: v.currency,
  riskCategory: v.riskCategory as VersionRow["riskCategory"],
  jurisdictions: v.jurisdictions,
  requiredDocuments: v.requiredDocuments,
  eligibility: (v.eligibility ?? []) as unknown as EligibilityRule[],
  salesRestrictions: (v.salesRestrictions ?? []) as unknown as SalesRestriction[],
  claims: (v.claims ?? []) as unknown as MarketingClaim[],
  validFrom: v.validFrom,
  validTo: v.validTo,
  createdById: v.createdBy,
});

export const toHead = (p: HeadDb): ProductHead => ({ id: p.id, key: p.key, isExample: p.isExample, status: p.status as ProductStatus, activeVersionId: p.activeVersionId });

const contentData = (c: ProductContent) => ({
  name: c.name,
  category: c.category,
  summary: c.summary,
  availability: c.availability,
  minInvestmentMinor: c.minInvestmentMinor === null ? null : BigInt(c.minInvestmentMinor),
  currency: c.currency,
  riskCategory: c.riskCategory,
  jurisdictions: c.jurisdictions,
  requiredDocuments: c.requiredDocuments,
  eligibility: c.eligibility as unknown as Prisma.InputJsonValue,
  salesRestrictions: c.salesRestrictions as unknown as Prisma.InputJsonValue,
  claims: c.claims as unknown as Prisma.InputJsonValue,
  validFrom: c.validFrom,
  validTo: c.validTo,
});

const audit = (db: Db, userId: string, productId: string, action: string, newValue: Prisma.InputJsonValue | null, reason: string | null = null) =>
  db.auditLog.create({ data: { userId, entity: "RegistryProduct", entityId: productId, action, newValue: newValue ?? undefined, reason } });

const KEY = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export async function createProduct(input: { key: string; content: ContentInput; isExample?: boolean }, actor: Actor): Promise<Result<{ productId: string; versionId: string }>> {
  if (actor.role !== "ADMIN") return fail("Only an Admin can add a product.");
  if (!KEY.test(input.key)) return fail("The key is lowercase letters, digits and hyphens (3 to 60 characters).");
  const v = validateContent(input.content);
  if (!v.ok) return fail(v.errors.join(" "));
  if (await prisma.registryProduct.findUnique({ where: { key: input.key }, select: { id: true } })) return fail("A product with this key already exists.");
  return prisma.$transaction(async (db) => {
    const p = await db.registryProduct.create({ data: { key: input.key, isExample: input.isExample === true, createdBy: actor.userId } });
    const ver = await db.registryProductVersion.create({ data: { productId: p.id, versionNo: 1, createdBy: actor.userId, ...contentData(v.content) } });
    await audit(db, actor.userId, p.id, "registry.product_created", { key: input.key, versionNo: 1, isExample: input.isExample === true });
    return { ok: true as const, productId: p.id, versionId: ver.id };
  });
}

/** A new DRAFT version copied from the newest version. At most one open (DRAFT or IN_REVIEW) version per product. */
export async function reviseProduct(productId: string, actor: Actor): Promise<Result<{ versionId: string }>> {
  if (actor.role !== "ADMIN") return fail("Only an Admin can revise a product.");
  return prisma.$transaction(async (db) => {
    const head = await db.registryProduct.findUnique({ where: { id: productId } });
    if (!head) return fail("Product not found.");
    if (head.status === "RETIRED") return fail("A retired product cannot be revised.");
    const open = await db.registryProductVersion.findFirst({ where: { productId, state: { in: ["DRAFT", "IN_REVIEW"] } }, select: { id: true } });
    if (open) return fail("There is already a draft or a version in review for this product.");
    const last = await db.registryProductVersion.findFirst({ where: { productId }, orderBy: { versionNo: "desc" } });
    if (!last) return fail("Product has no version to copy.");
    const { id: _id, versionNo, state: _s, createdAt: _c, submittedAt: _sa, reviewedBy: _rb, reviewedAt: _ra, reviewNote: _rn, createdBy: _cb, productId: _p, ...copy } = last;
    void [_id, _s, _c, _sa, _rb, _ra, _rn, _cb, _p];
    const ver = await db.registryProductVersion.create({ data: { ...copy, eligibility: copy.eligibility as Prisma.InputJsonValue, salesRestrictions: copy.salesRestrictions as Prisma.InputJsonValue, claims: copy.claims as Prisma.InputJsonValue, productId, versionNo: versionNo + 1, state: "DRAFT", createdBy: actor.userId } });
    await audit(db, actor.userId, productId, "registry.draft_created", { versionNo: ver.versionNo });
    return { ok: true as const, versionId: ver.id };
  });
}

export async function updateDraft(versionId: string, content: ContentInput, actor: Actor): Promise<Result> {
  if (actor.role !== "ADMIN") return fail("Only an Admin can edit a draft.");
  const v = validateContent(content);
  if (!v.ok) return fail(v.errors.join(" "));
  return prisma.$transaction(async (db) => {
    const cur = await db.registryProductVersion.findUnique({ where: { id: versionId } });
    if (!cur) return fail("Version not found.");
    if (cur.state !== "DRAFT") return fail("Only a draft can be edited. Approved versions are never changed: revise the product instead.");
    await db.registryProductVersion.update({ where: { id: versionId }, data: contentData(v.content) });
    await audit(db, actor.userId, cur.productId, "registry.draft_updated", { versionNo: cur.versionNo });
    return { ok: true as const };
  });
}

export async function submitVersion(versionId: string, actor: Actor): Promise<Result> {
  return prisma.$transaction(async (db) => {
    const cur = await db.registryProductVersion.findUnique({ where: { id: versionId } });
    if (!cur) return fail("Version not found.");
    const r = submitForReview({ id: cur.id, productId: cur.productId, state: cur.state as VersionState, createdById: cur.createdBy }, actor);
    if (!r.ok) return fail(r.error);
    await db.registryProductVersion.update({ where: { id: versionId }, data: { state: r.state, submittedAt: new Date() } });
    await audit(db, actor.userId, cur.productId, "registry.submitted", { versionNo: cur.versionNo });
    return { ok: true as const };
  });
}

export async function decideVersion(versionId: string, decision: "approve" | "reject", note: string | null, actor: Actor): Promise<Result> {
  return prisma.$transaction(async (db) => {
    const cur = await db.registryProductVersion.findUnique({ where: { id: versionId } });
    if (!cur) return fail("Version not found.");
    const head = await db.registryProduct.findUnique({ where: { id: cur.productId } });
    if (!head) return fail("Product not found.");
    const r = decideReview({ id: head.id, status: head.status as ProductStatus, activeVersionId: head.activeVersionId }, { id: cur.id, productId: cur.productId, state: cur.state as VersionState, createdById: cur.createdBy }, actor, decision);
    if (!r.ok) return fail(r.error);
    const now = new Date();
    await db.registryProductVersion.update({ where: { id: versionId }, data: { state: r.versionState, reviewedBy: actor.userId, reviewedAt: now, reviewNote: note?.slice(0, 500) ?? null } });
    if (r.versionState === "APPROVED") {
      if (r.supersede) await db.registryProductVersion.update({ where: { id: r.supersede }, data: { state: "SUPERSEDED" } });
      await db.registryProduct.update({ where: { id: head.id }, data: { status: r.product.status, activeVersionId: r.product.activeVersionId, statusReason: null, statusChangedAt: now, statusChangedBy: actor.userId } });
    }
    await audit(db, actor.userId, head.id, decision === "approve" ? "registry.approved" : "registry.rejected", { versionNo: cur.versionNo, reinstated: decision === "approve" && head.status === "SUSPENDED" }, note?.slice(0, 500) ?? null);
    return { ok: true as const };
  });
}

async function setStatus(productId: string, to: "SUSPENDED" | "RETIRED", reason: string, actor: Actor): Promise<Result> {
  return prisma.$transaction(async (db) => {
    const head = await db.registryProduct.findUnique({ where: { id: productId } });
    if (!head) return fail("Product not found.");
    const h = { id: head.id, status: head.status as ProductStatus, activeVersionId: head.activeVersionId };
    const r = to === "SUSPENDED" ? suspend(h, actor, reason) : retire(h, actor, reason);
    if (!r.ok) return fail(r.error);
    await db.registryProduct.update({ where: { id: productId }, data: { status: r.status, statusReason: reason.trim().slice(0, 500), statusChangedAt: new Date(), statusChangedBy: actor.userId } });
    await audit(db, actor.userId, productId, to === "SUSPENDED" ? "registry.suspended" : "registry.retired", { from: head.status }, reason.trim().slice(0, 500));
    return { ok: true as const };
  });
}
export const suspendProduct = (productId: string, reason: string, actor: Actor) => setStatus(productId, "SUSPENDED", reason, actor);
export const retireProduct = (productId: string, reason: string, actor: Actor) => setStatus(productId, "RETIRED", reason, actor);

// ---- Reads -------------------------------------------------------------------------------------------------------------

export type ProductListRow = { head: ProductHead & { statusReason: string | null }; name: string; category: string; riskCategory: string; availability: string; openVersion: { id: string; versionNo: number; state: VersionState } | null; activeVersionNo: number | null };

export async function listProducts(): Promise<ProductListRow[]> {
  const heads = await prisma.registryProduct.findMany({ orderBy: [{ isExample: "desc" }, { key: "asc" }], include: { versions: { orderBy: { versionNo: "desc" } } } });
  return heads.map((p) => {
    const newest = p.versions[0];
    const active = p.versions.find((v) => v.id === p.activeVersionId) ?? null;
    const shown = active ?? newest;
    const open = p.versions.find((v) => v.state === "DRAFT" || v.state === "IN_REVIEW") ?? null;
    return {
      head: { ...toHead(p), statusReason: p.statusReason },
      name: shown?.name ?? p.key,
      category: shown?.category ?? "",
      riskCategory: shown?.riskCategory ?? "",
      availability: shown?.availability ?? "",
      openVersion: open ? { id: open.id, versionNo: open.versionNo, state: open.state as VersionState } : null,
      activeVersionNo: active?.versionNo ?? null,
    };
  });
}

export async function getProduct(productId: string) {
  const p = await prisma.registryProduct.findUnique({ where: { id: productId }, include: { versions: { orderBy: { versionNo: "desc" } } } });
  if (!p) return null;
  return { head: { ...toHead(p), statusReason: p.statusReason, statusChangedAt: p.statusChangedAt }, versions: p.versions.map((v) => ({ ...toVersionRow(v), reviewedBy: v.reviewedBy, reviewedAt: v.reviewedAt, reviewNote: v.reviewNote, createdAt: v.createdAt })) };
}

/** Examples are citable outside production only (the owner replaces them before go-live). */
export const examplesAllowed = (env: Record<string, string | undefined> = process.env) => env.NODE_ENV !== "production";

/** THE entry point for agents, the campaign planner and copy tools. Reads the live record and applies the guard. */
export async function cite(productId: string, now: Date = new Date()): Promise<CitationResult> {
  const p = typeof productId === "string" && productId.length > 0 && productId.length <= 64 ? await prisma.registryProduct.findUnique({ where: { id: productId } }) : null;
  if (!p) return citeFromRecords(null, { now, allowExamples: examplesAllowed() }, typeof productId === "string" ? productId.slice(0, 64) : "");
  const v = p.activeVersionId ? await prisma.registryProductVersion.findUnique({ where: { id: p.activeVersionId } }) : null;
  return citeFromRecords({ product: toHead(p), version: v ? toVersionRow(v) : null }, { now, allowExamples: examplesAllowed() });
}

/** Every product that can be cited right now (read-only list for RMs, managers and the agents' product picker). */
export async function listCitable(now: Date = new Date()) {
  const heads = await prisma.registryProduct.findMany({ where: { status: "APPROVED" }, select: { id: true }, orderBy: { key: "asc" } });
  const out = [];
  for (const h of heads) {
    const c = await cite(h.id, now);
    if (c.ok) out.push(c);
  }
  return out;
}

export type ApprovedClaimRow = { productId: string; productName: string; claimId: string; text: string; validUntil: string | null; isExample: boolean };

/** What MARKETING may see: approved, in-date claims only, with the product name. No eligibility, minimum, risk detail, restriction or draft. */
export async function listApprovedClaims(now: Date = new Date()): Promise<ApprovedClaimRow[]> {
  const rows: ApprovedClaimRow[] = [];
  for (const c of await listCitable(now)) for (const claim of c.claims) rows.push({ productId: c.productId, productName: c.name, claimId: claim.id, text: claim.text, validUntil: claim.validUntil, isExample: c.isExample });
  return rows;
}


// ---- Review reads for the canonical approval inbox (Wave 2 integration) -------------------------------------------------------------------------------
/** One version as the approvals inbox needs it: ids, names, enums and counts. Claim wording stays in the registry screens. */
export type ReviewItem = {
  versionId: string; productId: string; productKey: string; productName: string; isExample: boolean; productStatus: string; versionNo: number; state: string;
  category: string; riskCategory: string; availability: string; claimCount: number; createdById: string | null; submittedAt: Date | null; reviewedById: string | null; reviewedAt: Date | null; reviewNote: string | null;
};
type ReviewDb = VersionDb & { product: HeadDb };
const toReviewItem = (v: ReviewDb): ReviewItem => ({
  versionId: v.id, productId: v.productId, productKey: v.product.key, productName: v.name, isExample: v.product.isExample, productStatus: v.product.status, versionNo: v.versionNo, state: v.state,
  category: v.category, riskCategory: v.riskCategory, availability: v.availability, claimCount: Array.isArray(v.claims) ? v.claims.length : 0, createdById: v.createdBy, submittedAt: v.submittedAt,
  reviewedById: v.reviewedBy, reviewedAt: v.reviewedAt, reviewNote: v.reviewNote,
});

/** Versions waiting for a second Admin, oldest first. */
export async function listReviewItems(limit: number): Promise<ReviewItem[]> {
  const rows = await prisma.registryProductVersion.findMany({ where: { state: "IN_REVIEW" }, include: { product: true }, orderBy: { submittedAt: "asc" }, take: limit });
  return rows.map(toReviewItem);
}

/** One version in any state (the inbox shows decided ones too). */
export async function getReviewItem(versionId: string): Promise<ReviewItem | null> {
  const v = typeof versionId === "string" && versionId.length > 0 && versionId.length <= 64 ? await prisma.registryProductVersion.findUnique({ where: { id: versionId }, include: { product: true } }) : null;
  return v ? toReviewItem(v) : null;
}
