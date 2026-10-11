import { createHmac } from "node:crypto";

/**
 * A stable, non-reversible label for a customer or referrer id, for screens that must not identify a person (marketing,
 * and the campaign-level referral view). Keyed with a server secret so the label cannot be recomputed or joined to
 * anything outside this deployment. Same id and secret always give the same label.
 */
export function pseudonymize(id: string, secret: string = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? ""): string {
  if (!secret) throw new Error("A secret is required to pseudonymize an id.");
  return `P-${createHmac("sha256", secret).update(`pseudonym:${id}`).digest("hex").slice(0, 10)}`;
}
