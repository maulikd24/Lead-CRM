// The Households LIST under the privacy walls (the fix for a leak that predates the walls: the list used to show every member's name and the household-wide AUM
// to a manager who looked after one member). Pure: the rows and the AUM of the viewer's OWN members come in, plain data goes out. Default deny, the same policy as the
// household page: another member's name needs that member's relationship consent (member_identity); their holdings never add to the list's total (the page shows a band
// where consent allows); memory and contact details are not on this list at all.
import { facetVisible, type ConsentRow } from "./policy";
import type { MemberInput } from "./summary";

export type ListHousehold = { id: string; name: string; householdCode: string; members: readonly MemberInput[] };
export type HouseholdListRow = {
  id: string;
  name: string;
  householdCode: string;
  /** Names the viewer may see: their own members, and others only with that member's consent. */
  memberNames: string[];
  /** Members shown only as a count. */
  hiddenMembers: number;
  totalMembers: number;
  /** The exact AUM of the viewer's own members; null never (0 when they hold nothing). */
  aum: number;
  /** True when some members are not included in the total. */
  partial: boolean;
};

export function buildHouseholdList(input: { role: string; households: readonly ListHousehold[]; consents: readonly ConsentRow[]; now: Date; aum: ReadonlyMap<string, number> }): HouseholdListRow[] {
  const out: HouseholdListRow[] = [];
  for (const h of input.households) {
    const viewerMemberIds = h.members.filter((m) => m.inScope).map((m) => m.clientId);
    const can = (m: MemberInput) => facetVisible({ facet: "member_identity", role: input.role, inScope: m.inScope, consents: input.consents, viewerMemberIds, now: input.now, subjectClientId: m.clientId });
    // A household nobody the viewer looks after belongs to is not listed: it must not even be known to exist.
    if (!h.members.some((m) => m.inScope) || !facetVisible({ facet: "relationship_exists", role: input.role, inScope: true, consents: [], viewerMemberIds, now: input.now })) continue;
    const names = h.members.filter(can).map((m) => m.name);
    out.push({
      id: h.id, name: h.name, householdCode: h.householdCode,
      memberNames: names, hiddenMembers: h.members.length - names.length, totalMembers: h.members.length,
      aum: h.members.filter((m) => m.inScope).reduce((sum, m) => sum + (input.aum.get(m.clientId) ?? 0), 0),
      partial: h.members.some((m) => !m.inScope),
    });
  }
  return out;
}
