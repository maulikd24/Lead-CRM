import type { Attribution, Confidence, Touch } from "./model";

/** The customer's journey from first touch to revenue: every step dated, every gap measured. Pure; the view only renders it. */

export type JourneyInput = {
  now: Date;
  createdAt: Date;
  attribution: Attribution;
  slaMinutes: number;
  firstContactAt: Date | null;
  kycSteps: { type: string; status: string; startedAt: Date; decidedAt: Date | null }[];
  kycApprovedAt: Date | null;
  firstFundedAt: Date | null;
  firstFundedAmount: number | null;
  firstTransactionAt: Date | null;
  firstRevenueAt: Date | null;
  revenueToDate: number;
};

export type StepState = "done" | "pending" | "overdue" | "failed" | "unknown";

export type JourneyStep = {
  key: string;
  label: string;
  at: Date | null;
  state: StepState;
  detail: string;
  /** Time since the lead was created, when the step happened. */
  sinceLead: string | null;
  /** First contact only: whether it was within the SLA (null until contacted). */
  slaMet?: boolean | null;
};

export type Journey = { steps: JourneyStep[]; first: Touch | null; last: Touch | null; confidence: Confidence | null; why: string };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatDuration(ms: number): string {
  const v = Math.max(0, ms);
  if (v < MIN) return "under a minute";
  if (v < HOUR) return `${Math.round(v / MIN)} min`;
  if (v < DAY) {
    const h = Math.floor(v / HOUR);
    const m = Math.round((v - h * HOUR) / MIN);
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const d = Math.floor(v / DAY);
  const h = Math.round((v - d * DAY) / HOUR);
  return h === 0 ? `${d} d` : `${d} d ${h} h`;
}

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(n));

const KYC_LABEL: Record<string, string> = {
  PAN_VERIFICATION: "PAN verification",
  ADDRESS_VERIFICATION: "Address verification",
  BANK_VERIFICATION: "Bank verification",
  RISK_PROFILE: "Risk profile",
  IPV: "Video verification",
  ESIGN: "eSign",
  KRA: "KRA",
  CKYC: "CKYC",
};

const CHANNEL_WORD: Record<Touch["kind"], string> = { meta_ad: "Meta ad", google_ad: "Google ad", partner_code: "Partner code", referral_code: "Customer referral", form: "Website form", organic: "Organic sign-up" };

export function describeTouch(t: Touch): string {
  const parts = [CHANNEL_WORD[t.kind]];
  if (t.campaign) parts.push(t.campaign.name ?? t.campaign.id ?? "unnamed campaign");
  if (t.code) parts.push(t.code);
  if (t.form && !t.campaign) parts.push(t.form);
  const head = parts.join(", ");
  return t.creative ? `${head}, creative "${t.creative}"` : head;
}

export function buildJourney(input: JourneyInput): Journey {
  const { now, createdAt, attribution } = input;
  const since = (d: Date) => formatDuration(d.getTime() - createdAt.getTime());
  const steps: JourneyStep[] = [];

  const first = attribution.status === "attributed" ? attribution.first : null;
  steps.push(
    first
      ? { key: "first_touch", label: "First touch", at: new Date(first.at), state: "done", detail: describeTouch(first), sinceLead: null }
      : { key: "first_touch", label: "First touch", at: null, state: "unknown", detail: "Where this customer came from is not known.", sinceLead: null },
  );
  steps.push({ key: "lead_created", label: "Lead created", at: createdAt, state: "done", detail: "Added to the CRM.", sinceLead: null });

  const sla = input.slaMinutes * MIN;
  if (input.firstContactAt) {
    const gap = input.firstContactAt.getTime() - createdAt.getTime();
    const met = gap <= sla;
    steps.push({
      key: "first_contact", label: "First contact", at: input.firstContactAt, state: "done", slaMet: met, sinceLead: since(input.firstContactAt),
      detail: met ? `Contacted ${formatDuration(gap)} after the lead arrived, within the ${input.slaMinutes} min SLA.` : `Contacted ${formatDuration(gap)} after the lead arrived, ${formatDuration(gap - sla)} past the ${input.slaMinutes} min SLA.`,
    });
  } else {
    const left = createdAt.getTime() + sla - now.getTime();
    steps.push(
      left > 0
        ? { key: "first_contact", label: "First contact", at: null, state: "pending", slaMet: null, sinceLead: null, detail: `Not contacted yet; ${formatDuration(left)} left in the ${input.slaMinutes} min SLA.` }
        : { key: "first_contact", label: "First contact", at: null, state: "overdue", slaMet: null, sinceLead: null, detail: `Not contacted. The ${input.slaMinutes} min SLA ended ${formatDuration(-left)} ago.` },
    );
  }

  for (const k of input.kycSteps) {
    const label = KYC_LABEL[k.type] ?? k.type.replace(/_/g, " ").toLowerCase();
    const key = `kyc_${k.type.toLowerCase()}`;
    if (k.status === "VERIFIED" && k.decidedAt) steps.push({ key, label, at: k.decidedAt, state: "done", sinceLead: since(k.decidedAt), detail: `Verified in ${formatDuration(k.decidedAt.getTime() - k.startedAt.getTime())}.` });
    else if (k.status === "FAILED") steps.push({ key, label, at: k.decidedAt, state: "failed", sinceLead: k.decidedAt ? since(k.decidedAt) : null, detail: k.decidedAt ? `Failed after ${formatDuration(k.decidedAt.getTime() - k.startedAt.getTime())}.` : "Failed." });
    else if (k.status === "SKIPPED") steps.push({ key, label, at: k.decidedAt, state: "done", sinceLead: k.decidedAt ? since(k.decidedAt) : null, detail: "Not applicable or waived." });
    else steps.push({ key, label, at: null, state: "pending", sinceLead: null, detail: `Open for ${formatDuration(now.getTime() - k.startedAt.getTime())}.` });
  }

  steps.push(
    input.kycApprovedAt
      ? { key: "kyc_approved", label: "KYC approved", at: input.kycApprovedAt, state: "done", sinceLead: since(input.kycApprovedAt), detail: "KYC approved." }
      : { key: "kyc_approved", label: "KYC approved", at: null, state: "pending", sinceLead: null, detail: "Not approved yet." },
  );
  steps.push(
    input.firstFundedAt
      ? { key: "first_funding", label: "First funding", at: input.firstFundedAt, state: "done", sinceLead: since(input.firstFundedAt), detail: input.firstFundedAmount ? `${inr(input.firstFundedAmount)} received.` : "Funds received." }
      : { key: "first_funding", label: "First funding", at: null, state: "pending", sinceLead: null, detail: "No funds received yet." },
  );
  steps.push(
    input.firstTransactionAt
      ? { key: "first_transaction", label: "First transaction", at: input.firstTransactionAt, state: "done", sinceLead: since(input.firstTransactionAt), detail: "First order or investment." }
      : { key: "first_transaction", label: "First transaction", at: null, state: "pending", sinceLead: null, detail: "No transaction yet." },
  );
  steps.push(
    input.revenueToDate > 0
      ? { key: "revenue", label: "Revenue to date", at: input.firstRevenueAt, state: "done", sinceLead: input.firstRevenueAt ? since(input.firstRevenueAt) : null, detail: `${inr(input.revenueToDate)} net brokerage and advisory revenue.` }
      : { key: "revenue", label: "Revenue to date", at: null, state: "pending", sinceLead: null, detail: "No revenue booked yet." },
  );

  return {
    steps,
    first,
    last: attribution.status === "attributed" ? attribution.last : null,
    confidence: attribution.confidence,
    why: attribution.status === "attributed" ? attribution.first.why : attribution.reasonText,
  };
}
