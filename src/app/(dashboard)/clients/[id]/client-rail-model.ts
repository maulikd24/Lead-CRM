import { formatDate, formatStageAge } from "@/lib/utils/format";

/** What the client record's rail shows, as plain data (so the wording and tones are testable). */

type Tone = "default" | "success" | "warning" | "destructive";
type SlaStatus = "ON_TRACK" | "DUE_SOON" | "OVERDUE" | "NOT_APPLICABLE";

export type RailFactModel = { key: string; label: string; value: string; hint?: string; tone: Tone; count?: number };
export type RailDateModel = { label: string; value: string; hint?: string };

export type ClientRailInput = {
  ageHours: number;
  slaStatus: SlaStatus;
  openTickets: number;
  createdAt: Date;
  daysSinceLastActivity: number;
};

const SLA_TONE: Record<SlaStatus, Tone> = { OVERDUE: "destructive", DUE_SOON: "warning", ON_TRACK: "success", NOT_APPLICABLE: "default" };

const lastActivity = (days: number) => (days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`);

export function buildClientRail(i: ClientRailInput): { facts: RailFactModel[]; dates: RailDateModel[] } {
  return {
    facts: [
      // The stage name itself is in the tracker at the top of the page and the next step is in the header: only what they do not show is here.
      { key: "stage", label: "Time in stage", value: formatStageAge(i.ageHours), tone: "default" },
      { key: "sla", label: "SLA status", value: i.slaStatus.replace(/_/g, " "), tone: SLA_TONE[i.slaStatus] },
      { key: "tickets", label: "Open tickets", value: String(i.openTickets), count: i.openTickets, tone: i.openTickets > 0 ? "warning" : "default", hint: i.openTickets > 0 ? "See the Support tab" : "None open" },
    ],
    dates: [
      { label: "Created", value: formatDate(i.createdAt) },
      { label: "Last activity", value: lastActivity(i.daysSinceLastActivity) },
    ],
  };
}
