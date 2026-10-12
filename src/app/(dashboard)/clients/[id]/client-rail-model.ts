import { formatDate, formatStageAge } from "@/lib/utils/format";

/** What the client record's rail shows, as plain data (so the wording and tones are testable). */

type Tone = "default" | "success" | "warning" | "destructive";
type SlaStatus = "ON_TRACK" | "DUE_SOON" | "OVERDUE" | "NOT_APPLICABLE";

export type RailFactModel = { key: string; label: string; value: string; hint?: string; tone: Tone; count?: number };
export type RailChipModel = { key: string; label: string; tab: string };
export type RailDateModel = { label: string; value: string; hint?: string };

export type ClientRailInput = {
  stageName: string;
  ageHours: number;
  slaStatus: SlaStatus;
  nba: { label: string; detail: string };
  openTickets: number;
  kyc: string | null;
  funding: string | null;
  dealer: string | null;
  createdAt: Date;
  stageEnteredAt: Date;
  daysSinceLastActivity: number;
  nextActionTitle: string | null;
  nextActionDueAt: Date | null;
};

const SLA_TONE: Record<SlaStatus, Tone> = { OVERDUE: "destructive", DUE_SOON: "warning", ON_TRACK: "success", NOT_APPLICABLE: "default" };

const lastActivity = (days: number) => (days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`);

export function buildClientRail(i: ClientRailInput): { facts: RailFactModel[]; onboarding: RailChipModel[]; dates: RailDateModel[] } {
  return {
    facts: [
      { key: "stage", label: "Current stage", value: i.stageName, hint: `${formatStageAge(i.ageHours)} in this stage`, tone: "default" },
      { key: "sla", label: "SLA status", value: i.slaStatus.replace(/_/g, " "), tone: SLA_TONE[i.slaStatus] },
      { key: "next", label: "Next step", value: i.nba.label, hint: i.nba.detail, tone: "default" },
      { key: "tickets", label: "Open tickets", value: String(i.openTickets), count: i.openTickets, tone: i.openTickets > 0 ? "warning" : "default", hint: i.openTickets > 0 ? "See the Support tab" : "None open" },
    ],
    onboarding: [
      { key: "kyc", label: `KYC: ${i.kyc ?? "Not started"}`, tab: "onboarding" },
      { key: "funding", label: `Funding: ${i.funding ?? "Not started"}`, tab: "funding" },
      { key: "dealer", label: `Dealer: ${i.dealer ?? "Not started"}`, tab: "funding" },
    ],
    dates: [
      { label: "Created", value: formatDate(i.createdAt) },
      { label: "In stage since", value: formatDate(i.stageEnteredAt) },
      { label: "Last activity", value: lastActivity(i.daysSinceLastActivity) },
      { label: "Next action due", value: i.nextActionDueAt ? formatDate(i.nextActionDueAt) : "Not set", hint: i.nextActionTitle ?? undefined },
    ],
  };
}
