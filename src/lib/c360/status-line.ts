import type { ConsentStatus } from "@/lib/c360/consent";

const words = (s: string) => {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export type StatusLineInput = { status: string; kycStatus: string | null; stage: string; archived: boolean };
export type StatusLine = { parts: string[]; warning: string | null };

/**
 * The one quiet status line under a customer's name: where they stand, KYC, and the stage. A warning appears ONLY when consent
 * actually blocks something (a plain "not recorded" or "withdrawn" marketing opt-in does not stop service messages, so it stays quiet).
 */
export function statusLine(input: StatusLineInput, consent: Pick<ConsentStatus, "marketing" | "salesPaused" | "doNotPitch"> | null): StatusLine {
  const parts = [input.archived ? "Archived" : words(input.status), `KYC ${input.kycStatus ? input.kycStatus.replace(/_/g, " ").toLowerCase() : "not started"}`, `Stage: ${input.stage}`];
  let warning: string | null = null;
  if (consent) {
    if (consent.marketing === "do_not_contact") warning = "Do not contact";
    else if (consent.salesPaused) warning = "Sales messages paused";
    else if (consent.doNotPitch) warning = "Do not pitch";
  }
  return { parts, warning };
}

/** A due date for the task a suggestion creates, from the suggestion's own timing words ("Today", "This week"...). Default: tomorrow. */
export function dueFromTiming(timing: string | null | undefined, now: Date): Date {
  const t = (timing ?? "").toLowerCase();
  if (t.includes("today")) {
    const d = new Date(now);
    d.setUTCHours(12, 30, 0, 0); // 6 pm India time, end of the working day
    return d.getTime() > now.getTime() ? d : new Date(now.getTime() + 3600_000);
  }
  if (t.includes("tomorrow")) return new Date(now.getTime() + 24 * 3600_000);
  if (t.includes("week")) return new Date(now.getTime() + 3 * 24 * 3600_000);
  if (t.includes("month")) return new Date(now.getTime() + 14 * 24 * 3600_000);
  return new Date(now.getTime() + 24 * 3600_000);
}
