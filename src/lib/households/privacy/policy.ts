/**
 * Household privacy walls. THE explicit policy table: what the person looking after one household member may see of another.
 *
 * Default deny. Inside a household each member is a separate customer with their own RM, their own consent and their own
 * data. Being in the same household is not permission. For a member the viewer cannot already open (a member of another RM's
 * book), the ONLY thing visible by default is that the relationship exists. Anything more needs the relationship-level consent
 * of that member (a HouseholdRelationshipConsent row naming the facet), and two facets (their memory and their contact
 * details) never cross the wall at all, consent or not. Roles outside ADMIN, MANAGER and RM see nothing about a household.
 *
 * Pure: no database. The loaders (summary.ts, context.ts) feed it the rows and never query a facet it says is hidden.
 */

export const FACETS = ["relationship_exists", "relationship_type", "member_identity", "portfolio_summary", "service_state", "memory_confirmed", "contact_details"] as const;
export type Facet = (typeof FACETS)[number];

export type CrossScope = "always" | "consent" | "never";

export const HOUSEHOLD_POLICY: Record<Facet, { crossScope: CrossScope; label: string; note: string }> = {
  relationship_exists: { crossScope: "always", label: "That a household relationship exists", note: "The default: the viewer learns only that this customer is part of a household with other members." },
  relationship_type: { crossScope: "consent", label: "How members are related (spouse, parent, child)", note: "Needs the member's relationship consent." },
  member_identity: { crossScope: "consent", label: "Name and customer code of the other member", note: "Needs the member's relationship consent." },
  portfolio_summary: { crossScope: "consent", label: "Portfolio size band and number of accounts", note: "Needs the member's relationship consent. Holdings are never shown, only the summary." },
  service_state: { crossScope: "consent", label: "Whether the member has an open complaint or overdue promise", note: "Needs the member's relationship consent. Counts only, never the text." },
  memory_confirmed: { crossScope: "never", label: "What we know about the member (memory)", note: "Never crosses the wall. Each member's memory is for their own RM." },
  contact_details: { crossScope: "never", label: "Phone, email and other contact details", note: "Never crosses the wall." },
};

/** The facets a member may grant. The relationship itself needs no consent, and the never-facets cannot be granted. */
export const CONSENTABLE_FACETS: readonly Facet[] = FACETS.filter((f) => HOUSEHOLD_POLICY[f].crossScope === "consent");

/** Roles that can see anything about a household member at all. Everyone else is refused before any rule runs. */
const DESK_ROLES = new Set(["ADMIN", "MANAGER", "RM"]);

export type ConsentRow = {
  subjectClientId: string;
  /** null = every member of the household; otherwise the one member whose RM the consent is for. */
  granteeClientId: string | null;
  scopes: readonly string[];
  status: string;
  capturedAt: Date;
  expiresAt: Date | null;
};

const effective = (r: ConsentRow, now: Date) => r.capturedAt.getTime() <= now.getTime();
const isConsentable = (s: string): s is Facet => (CONSENTABLE_FACETS as readonly string[]).includes(s);

/**
 * Whether the subject's consent covers `facet` for a viewer who looks after `viewerMemberIds`. For each of those members the
 * newest row that names them wins; with none, the newest "everyone" row. A withdrawal, an expiry or a future date means no.
 */
export function consentCovers(rows: readonly ConsentRow[], facet: Facet, viewerMemberIds: readonly string[], now: Date): boolean {
  if (!isConsentable(facet)) return false; // the never-facets and the relationship itself are not consent matters
  const live = rows.filter((r) => effective(r, now)).sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
  const grants = (r: ConsentRow | undefined) => !!r && r.status === "GRANTED" && (!r.expiresAt || r.expiresAt.getTime() > now.getTime()) && r.scopes.includes(facet);
  const general = live.find((r) => r.granteeClientId === null);
  for (const member of viewerMemberIds) {
    const specific = live.find((r) => r.granteeClientId === member);
    if (grants(specific ?? general)) return true;
  }
  // a viewer who looks after no member of this household (a manager over the whole household) is covered only by the general consent
  if (viewerMemberIds.length === 0) return grants(general);
  return false;
}

export type FacetQuery = {
  facet: Facet;
  role: string;
  /** The viewer can already open this member's customer record (their own, their team's, or an admin). */
  inScope: boolean;
  /** Consent rows where THIS member is the subject. */
  consents: readonly ConsentRow[];
  /** The household members whose RM record scope the viewer has (the grantees a consent can name). */
  viewerMemberIds: readonly string[];
  now: Date;
  /** When given, consent rows for any other subject are ignored. */
  subjectClientId?: string;
};

export function facetVisible(q: FacetQuery): boolean {
  if (!DESK_ROLES.has(q.role)) return false;
  if (q.inScope) return true;
  const rule = HOUSEHOLD_POLICY[q.facet].crossScope;
  if (rule === "always") return true;
  if (rule === "never") return false;
  const rows = q.subjectClientId ? q.consents.filter((c) => c.subjectClientId === q.subjectClientId) : q.consents;
  return consentCovers(rows, q.facet, q.viewerMemberIds, q.now);
}

export function validateConsentScopes(input: readonly string[]): { ok: true; scopes: Facet[] } | { ok: false; message: string } {
  const unique = [...new Set(input)];
  if (unique.length === 0) return { ok: false, message: "Choose what the member agrees to share." };
  for (const s of unique) {
    if (!(FACETS as readonly string[]).includes(s)) return { ok: false, message: `Unknown item: ${s}.` };
    if (!isConsentable(s)) return { ok: false, message: `"${HOUSEHOLD_POLICY[s as Facet].label}" cannot be shared across members.` };
  }
  return { ok: true, scopes: unique as Facet[] };
}
