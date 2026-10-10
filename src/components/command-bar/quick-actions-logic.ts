/** Pure rules for the command bar's quick actions (Add task, Log call). The server actions enforce them again; this is the friendly early check. */

export type DueChoice = "today" | "tomorrow" | "3days";
export const DUE_CHOICES: { key: DueChoice; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "3days", label: "In 3 days" },
];

// India Standard Time is UTC+5:30: 6 pm is 12:30 UTC and 10 am is 04:30 UTC.
export function dueDate(choice: DueChoice, now: Date): Date {
  const at = (days: number, utcH: number, utcM: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(utcH, utcM, 0, 0);
    return d;
  };
  if (choice === "today") {
    const evening = at(0, 12, 30);
    return evening.getTime() > now.getTime() ? evening : new Date(now.getTime() + 3600_000);
  }
  return choice === "tomorrow" ? at(1, 4, 30) : at(3, 4, 30);
}

export function validateTask(input: { clientId: string; title: string }): string | null {
  if (!input.clientId) return "Pick a client first.";
  if (!input.title.trim()) return "Say what needs doing.";
  return null;
}

export const CALL_OUTCOMES = ["Connected", "Call back requested", "Interested", "Not interested", "Unreachable", "Wrong number"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

const NEEDS_NOTES = ["Not interested", "Unreachable", "Wrong number"];
const NEEDS_NEXT = ["Call back requested", "Interested"];

export function validateCall(input: { clientId: string; outcome: string; notes: string; nextAction: string }): string | null {
  if (!input.clientId) return "Pick a client first.";
  if (!input.outcome) return "Choose the outcome of the call.";
  if (NEEDS_NOTES.includes(input.outcome) && !input.notes.trim()) return `Add notes for "${input.outcome}".`;
  if (NEEDS_NEXT.includes(input.outcome) && !input.nextAction.trim()) return `Add the next action for "${input.outcome}".`;
  return null;
}
