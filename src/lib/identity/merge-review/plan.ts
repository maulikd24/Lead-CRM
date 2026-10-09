import { normalizePan } from "@/lib/utils/normalize-contact";

/** Everything the merge planner needs to know about one customer. Loaded by the server, never by this pure module. */
export type SideFacts = {
  id: string;
  pan: string | null;
  kycStarted: boolean;
  kycCompleted: boolean;
  hasKycRecord: boolean;
  hasFundingRecord: boolean;
  hasDealerIntro: boolean;
  holders: { position: string | null }[];
  /** How many of the identity/profile fields are filled in (higher = more complete). */
  completeness: number;
  createdAt: Date;
  counts: {
    documents: number; tasks: number; activities: number; calls: number; payments: number; stageHistory: number; exceptions: number;
    tradingAccounts: number; revenueEvents: number; messages: number;
    /** Not moved on their own: positions travel with their trading account. Shown for context. */
    positions: number;
    /** Records the existing merge does NOT move; they stay on the archived record. */
    holdings: number; kycSteps: number; opportunities: number; householdMemberships: number; journeyRuns: number;
  };
};

const pan = (s: SideFacts) => (s.pan ? normalizePan(s.pan) : "");
const kycRank = (s: SideFacts) => (s.kycCompleted ? 2 : s.kycStarted ? 1 : 0);

/**
 * Default survivor: the record with a PAN (it is the unique legal identity), then the more complete KYC, then the more
 * complete profile, then the older record. Symmetric: argument order never changes the answer.
 */
export function chooseSurvivor(a: SideFacts, b: SideFacts): { survivorId: string; why: string } {
  const pick = (w: SideFacts, why: string) => ({ survivorId: w.id, why });
  if (!!pan(a) !== !!pan(b)) return pick(pan(a) ? a : b, "It has a PAN");
  if (kycRank(a) !== kycRank(b)) return pick(kycRank(a) > kycRank(b) ? a : b, "Its KYC is further along");
  if (a.completeness !== b.completeness) return pick(a.completeness > b.completeness ? a : b, "Its profile is more complete");
  if (a.createdAt.getTime() !== b.createdAt.getTime()) return pick(a.createdAt < b.createdAt ? a : b, "It is the older record");
  return pick(a.id < b.id ? a : b, "Tie-break by id");
}

/** Joint-holder rule of the existing merge (same wording), shared so the preview can never disagree with the merge. */
export function holderConflict(primary: { position: string | null }[], duplicate: { position: string | null }[]): string | null {
  if (duplicate.length === 0) return null;
  if (primary.length + duplicate.length > 2) {
    return `Cannot merge: combining holders would exceed the 3-holder limit (primary has ${primary.length + 1}, duplicate has ${duplicate.length + 1})`;
  }
  const taken = new Set(primary.map((h) => h.position));
  const colliding = duplicate.find((h) => h.position && taken.has(h.position));
  return colliding ? `Cannot merge: both accounts already have a ${colliding.position?.toLowerCase()} holder` : null;
}

export type PlanLine = { key: string; label: string; count: number };
export type MergePlan = { blocked: string | null; moves: PlanLine[]; stays: PlanLine[] };

const MOVED: [keyof SideFacts["counts"], string][] = [
  ["documents", "Documents"], ["tasks", "Tasks"], ["activities", "Activities"], ["calls", "Calls"], ["payments", "Payments"],
  ["stageHistory", "Stage history"], ["exceptions", "Exceptions"], ["tradingAccounts", "Trading accounts (with their positions)"],
  ["revenueEvents", "Revenue events"], ["messages", "Messages"],
];
const STAYING: [keyof SideFacts["counts"], string][] = [
  ["holdings", "PMS / AIF holdings"], ["kycSteps", "KYC steps"], ["opportunities", "Opportunities"],
  ["householdMemberships", "Household memberships"], ["journeyRuns", "Journey runs"],
];

/**
 * What merging `duplicate` INTO `survivor` will do, mirroring the existing merge implementation exactly:
 * the listed record types are re-pointed to the survivor, the duplicate is archived (never deleted), and a KYC / funding /
 * dealer record only moves when the survivor has none of its own. Different PANs are a hard block (two legal persons).
 */
export function planMerge(survivor: SideFacts, duplicate: SideFacts): MergePlan {
  const empty = { moves: [], stays: [] } as Pick<MergePlan, "moves" | "stays">;
  if (survivor.id === duplicate.id) return { blocked: "A customer cannot be merged into itself.", ...empty };
  const ps = pan(survivor);
  const pd = pan(duplicate);
  if (ps && pd && ps !== pd) return { blocked: "These customers have different PAN numbers, so they are different legal persons. They can never be merged.", ...empty };
  if (pd && !ps) return { blocked: "Keep the record that has the PAN: the archived record's PAN cannot be carried over. Switch the survivor and try again.", ...empty };

  const moves: PlanLine[] = [];
  for (const [key, label] of MOVED) if (duplicate.counts[key] > 0) moves.push({ key, label, count: duplicate.counts[key] });
  if (duplicate.holders.length > 0) moves.push({ key: "holders", label: "Joint account holders", count: duplicate.holders.length });

  const stays: PlanLine[] = [];
  const oneToOne: [boolean, boolean, string, string][] = [
    [duplicate.hasKycRecord, survivor.hasKycRecord, "kycRecord", "KYC record"],
    [duplicate.hasFundingRecord, survivor.hasFundingRecord, "fundingRecord", "Funding record"],
    [duplicate.hasDealerIntro, survivor.hasDealerIntro, "dealerIntro", "Dealer introduction"],
  ];
  for (const [dupHas, survHas, key, label] of oneToOne) {
    if (!dupHas) continue;
    (survHas ? stays : moves).push({ key, label, count: 1 });
  }
  for (const [key, label] of STAYING) if (duplicate.counts[key] > 0) stays.push({ key, label, count: duplicate.counts[key] });

  return { blocked: holderConflict(survivor.holders, duplicate.holders), moves, stays };
}
