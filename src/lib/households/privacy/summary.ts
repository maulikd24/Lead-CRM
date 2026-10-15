import { facetVisible, type ConsentRow, type Facet } from "./policy";

/**
 * The household summary, built behind the privacy wall. It decides every facet of every member with the policy table and only
 * then asks the fetchers for data, and only for the members whose facet is visible: a hidden member's portfolio or service state
 * is never queried, so it cannot leak through a log line, a cache or a careless serialiser. A hidden member's id, name, code,
 * relationship and amounts are not in the output at all.
 */

export type MemberInput = { clientId: string; name: string; clientCode: string; relationship: string | null; isPrimary: boolean; inScope: boolean };
export type PortfolioFact = { aum: number; accountCount: number; asOf: Date | null };
export type ServiceFact = { openComplaintCount: number; overdueCommitmentCount: number; asOf: Date };

export type Fetchers = {
  portfolio: (clientIds: readonly string[]) => Promise<Map<string, PortfolioFact>>;
  service: (clientIds: readonly string[]) => Promise<Map<string, ServiceFact>>;
};

export type Facetted<T> = { visible: true; value: T } | { visible: false; value?: undefined };

export type MemberRow = {
  /** Position in the household, not an id. */
  key: string;
  inScope: boolean;
  relationshipExists: true;
  identity: Facetted<{ clientId: string; name: string; clientCode: string }> & { label?: string };
  relationshipType: Facetted<{ type: string | null; isPrimary: boolean }>;
  portfolio: Facetted<{ band: string; accountCount: number; aum: number | null; asOf: string | null }>;
  service: Facetted<{ openComplaints: number; overdueCommitments: number }>;
};

export type HouseholdSummary = {
  asOf: Date | null;
  memberCount: number;
  members: MemberRow[];
  aggregate: { aum: number | null; partial: boolean };
  wall: { hiddenMembers: number; note: string };
};

export function aumBand(aum: number): string {
  if (aum < 1_000_000) return "under 10 lakh";
  if (aum < 10_000_000) return "10 lakh to 1 crore";
  if (aum < 50_000_000) return "1 crore to 5 crore";
  return "over 5 crore";
}

type Input = {
  role: string;
  members: readonly MemberInput[];
  consents: readonly ConsentRow[];
  /** The household members whose record scope the viewer has (the grantees a consent can name). */
  viewerMemberIds: readonly string[];
  now: Date;
  fetchers: Fetchers;
};

export async function buildHouseholdSummary(input: Input): Promise<HouseholdSummary | null> {
  const { role, members, consents, viewerMemberIds, now, fetchers } = input;
  const can = (m: MemberInput, facet: Facet) => facetVisible({ facet, role, inScope: m.inScope, consents, viewerMemberIds, now, subjectClientId: m.clientId });

  // A role the policy does not admit sees nothing of the household, not even that it exists.
  if (!members.some((m) => can(m, "relationship_exists"))) return null;

  const portfolioIds = members.filter((m) => can(m, "portfolio_summary")).map((m) => m.clientId);
  const serviceIds = members.filter((m) => can(m, "service_state")).map((m) => m.clientId);
  const [portfolio, service] = await Promise.all([portfolioIds.length ? fetchers.portfolio(portfolioIds) : new Map<string, PortfolioFact>(), serviceIds.length ? fetchers.service(serviceIds) : new Map<string, ServiceFact>()]);

  let asOf: Date | null = null;
  let total = 0;
  let totalMembers = 0;
  const rows: MemberRow[] = members.map((m, i) => {
    const identityOk = can(m, "member_identity");
    const typeOk = can(m, "relationship_type");
    const pf = can(m, "portfolio_summary") ? portfolio.get(m.clientId) : undefined;
    const sv = can(m, "service_state") ? service.get(m.clientId) : undefined;
    if (pf?.asOf && (!asOf || pf.asOf > asOf)) asOf = pf.asOf;
    if (pf && m.inScope) { total += pf.aum; totalMembers++; }
    return {
      key: `m${i + 1}`,
      inScope: m.inScope,
      relationshipExists: true,
      identity: identityOk ? { visible: true, value: { clientId: m.clientId, name: m.name, clientCode: m.clientCode } } : { visible: false, label: "Another household member" },
      relationshipType: typeOk ? { visible: true, value: { type: m.relationship, isPrimary: m.isPrimary } } : { visible: false },
      portfolio: pf ? { visible: true, value: { band: aumBand(pf.aum), accountCount: pf.accountCount, aum: m.inScope ? pf.aum : null, asOf: pf.asOf?.toISOString() ?? null } } : { visible: false },
      service: sv ? { visible: true, value: { openComplaints: sv.openComplaintCount, overdueCommitments: sv.overdueCommitmentCount } } : { visible: false },
    };
  });

  const hidden = members.filter((m) => !m.inScope).length;
  const allSummed = members.every((m) => m.inScope && portfolio.has(m.clientId));
  return {
    asOf,
    memberCount: members.length,
    members: rows,
    // The total only ever adds the exact amounts the viewer may already see; consented members show a band and stay out of it.
    aggregate: { aum: totalMembers > 0 ? total : null, partial: !allSummed },
    wall: { hiddenMembers: hidden, note: hidden > 0 ? "Some members are looked after by other relationship managers. What is shown of them is limited to what each member consented to share." : "Everyone in this household is in your scope." },
  };
}
