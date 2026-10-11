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
  };
}
