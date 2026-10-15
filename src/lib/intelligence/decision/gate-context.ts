// What the suppression rules and the policy gate need to know about one customer, as plain data. The loader builds it from the
// database; tests build it by hand. Nothing here is a Prisma type, so the whole pipeline runs without a database.
import type { ConsentRow } from "@/lib/consent/decision";
import type { ConsentPolicy } from "@/lib/consent/policy";
import type { AssetClass, NbaProgramme } from "../constants";

export type ProductStance = {
  assetClass: AssetClass;
  stance: "interested" | "not_interested" | "objection";
  /** Confirmed by a person (or stated by the customer and logged by one). AI-inferred stances are unconfirmed. */
  confirmed: boolean;
  until: Date | null;
  because: string;
};

export type RegistryBlock = { assetClass: AssetClass | null; programme: NbaProgramme | null; reason: string };

/** An authoritative memory do-not-do item, mapped to what a machine can apply: an asset class, a suggestion rule, or both null (see GateContext.doNotDoUnmapped). */
export type DoNotDoItem = { assetClass: AssetClass | null; ruleKey: string | null; because: string };
/** A formal Complaint (service state, workstream B) that is open. Ids, severity and the SLA clock only: never its title or text. */
export type OpenComplaintFact = { id: string; severity: string; slaDueAt: Date; breached: boolean };
/** A person-confirmed Commitment that is overdue. Id, due date and who must deliver it: never the promise's wording. */
export type OverdueCommitmentFact = { id: string; dueAt: Date; ownerId: string | null };
/** What the product registry (workstream C) says may be cited right now, per asset class. `enforced` is false while the registry flag is off: nothing is blocked then. */
export type RegistryCitations = { enforced: boolean; citable: Partial<Record<AssetClass, string[]>>; refused: Partial<Record<AssetClass, string>> };

export type Dismissal = { ruleKey: string; fingerprint: string; snoozeUntil: Date; reason: string | null };

export type GateContext = {
  now: Date;
  clientId: string;
  /** `policy` defaults to the ledger policy (CONSENT_POLICY with the CONSENT_RECORD_ONLY_PURPOSES override). Shadow decisions always apply it, whether or not CONSENT_ENFORCEMENT is on: a recommendation that enforcement would later block is wrong. */
  consent: { rows: ConsentRow[]; legacyMarketingConsentAt: Date | null; policy?: ConsentPolicy };
  lastContactAt: Date | null;
  lastInboundWhatsAppAt: Date | null;
  approvedTemplateExists: boolean;
  complaint: { open: boolean; lastAt: Date | null; because: string | null };
  complianceConcernOpen: boolean;
  declined: { assetClass: AssetClass; because: string }[];
  rmLow: { assetClass: AssetClass; because: string }[];
  dismissals: Dismissal[];
  unreachableAttempts: number;
  kycException: { open: boolean; label: string | null };
  agentEnabled: boolean;
  productStances: ProductStance[];
  registryBlocks: RegistryBlock[];
  /** Evidence that disagrees with itself (for example interest and a decline on the same class, both unresolved). The engine abstains on that topic. */
  evidenceConflicts: { assetClass: AssetClass | null; because: string }[];
  /** Authoritative memory do-not-do items that name a class or a suggestion rule. */
  doNotDo: DoNotDoItem[];
  /** Authoritative do-not-do items that name neither: a machine cannot apply them, so a sales step waits for a person to read them. */
  doNotDoUnmapped: number;
  openComplaints: OpenComplaintFact[];
  overdueCommitments: OverdueCommitmentFact[];
  registry: RegistryCitations;
};

export function emptyGateContext(clientId: string, now: Date): GateContext {
  return {
    now,
    clientId,
    consent: { rows: [], legacyMarketingConsentAt: null },
    lastContactAt: null,
    lastInboundWhatsAppAt: null,
    approvedTemplateExists: true,
    complaint: { open: false, lastAt: null, because: null },
    complianceConcernOpen: false,
    declined: [],
    rmLow: [],
    dismissals: [],
    unreachableAttempts: 0,
    kycException: { open: false, label: null },
    agentEnabled: true,
    productStances: [],
    registryBlocks: [],
    evidenceConflicts: [],
    doNotDo: [],
    doNotDoUnmapped: 0,
    openComplaints: [],
    overdueCommitments: [],
    registry: { enforced: false, citable: {}, refused: {} },
  };
}
