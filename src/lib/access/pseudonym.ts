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

/** MARKETING sees customer lists as stand-ins only: no name, no relationship manager, no real id, no link into the CRM. Takes a plain string so an unknown role is refused. */
export function isPseudonymousViewer(role: string | null | undefined): boolean {
  return role === "MARKETING";
}

/** Only a signed-in ADMIN is shown exact times, AUM and revenue behind an aggregate; every other reader, and every system reader whose output reaches MARKETING, gets coarse bands. */
export function seesExactFigures(role: string | null | undefined): boolean {
  return role === "ADMIN";
}
