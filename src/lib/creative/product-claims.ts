/**
 * SEAM: the Product Registry's cite() guard.
 *
 * Ad copy that names a product (a fund, a scheme, a fee, a minimum) must cite the one place those facts live, the Product Registry, so a number in an ad
 * can never drift from the offer document. There is no Product Registry on this base. Instead of a half-built stand-in, this is the seam: evaluateVariant()
 * takes an optional ProductClaimGuard and shows a "product_claims" check. With no guard the check is "not applicable" and says so in words, so a reviewer
 * knows product names and figures were NOT cross-checked and confirms them by hand. When the registry lands, give the creative service its cite() as a
 * ProductClaimGuard (ServiceDeps.productGuard); nothing else in this module changes. A guard that throws fails closed.
 *
 * See docs/creative-intelligence.md, "Product Registry seam".
 */
export type ProductClaimResult = { ok: true } | { ok: false; reason: string; matched?: string };
export type ProductClaimGuard = { cite(text: string): ProductClaimResult };
