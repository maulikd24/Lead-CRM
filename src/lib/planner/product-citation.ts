/**
 * Product claims in a promise. A promise that mentions an investment product may only use what the Product and Eligibility Registry
 * approves, and it must cite the registry by id (`cite(productId)`).
 *
 * SEAM. The registry is built on a Wave 2 branch and is not on this base. Until it is merged, `getProductCiter()` returns a stub that FAILS
 * CLOSED: every product claim is "needs registry approval", so a plan whose promise names a product cannot be sent for review. At integration,
 * replace the body of `getProductCiter` with an adapter over the registry's `cite` (`@/lib/registry/service`):
 *
 *   const { cite } = await import("@/lib/registry/service");
 *   return async (id, now) => { const r = await cite(id, now); return r.ok ? { ok: true, productId: r.productId, asOf: r.asOf, claims: r.claims.map(...) } : { ok: false, reason: r.reason, productId: r.productId }; };
 *
 * and leave everything else (the checklist item, the screens, the tests) as is. The planner must never carry its own list of product facts.
 */

export type ProductCiteRefusalReason = "needs_registry_approval" | "unknown_product" | "unapproved" | "suspended" | "retired" | "no_approved_version" | "not_yet_valid" | "expired" | "example_product";
export type ProductCite =
  | { ok: true; productId: string; asOf: Date; claims: { id: string; text: string }[] }
  | { ok: false; reason: ProductCiteRefusalReason; productId: string };
export type ProductCiter = (productId: string, now?: Date) => Promise<ProductCite>;

/** The stand-in until the registry is on this base: nothing is ever approved. */
export const failClosedCite: ProductCiter = async (productId) => ({ ok: false, reason: "needs_registry_approval", productId });

export function getProductCiter(): ProductCiter {
  return failClosedCite;
}

/** Strong product words that make a promise "mention a product" even when its author did not tick the box (fail closed). */
const PRODUCT_WORDS = /\b(?:PMS|AIF|SIF|ELSS|NFO|ULIP|NCD|debentures?|bonds?|schemes?|portfolio\s+management\s+service)\b/i;

export function mentionsProduct(p: { mentionsProduct: boolean; hook: string; allowedClaims: string[] }): boolean {
  return p.mentionsProduct || PRODUCT_WORDS.test(p.hook) || p.allowedClaims.some((c) => PRODUCT_WORDS.test(c));
}

export const NEEDS_REGISTRY_TEXT = "This promise names an investment product. A product can only be mentioned with wording the Product Registry has approved, and no product is approved there yet: it needs registry approval.";
