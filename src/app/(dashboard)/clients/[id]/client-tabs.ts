/** The sections of the client record workspace. One is on screen at a time; the URL (?tab=) says which. */
export const CLIENT_TAB_FALLBACK = "overview";

export type ClientTabDef = { key: string; label: string; count: number | null };

export function buildClientTabs(opts: { consent: boolean; openTickets: number }): ClientTabDef[] {
  const tab = (key: string, label: string, count: number | null = null): ClientTabDef => ({ key, label, count });
  return [
    tab("overview", "Overview"),
    tab("onboarding", "Onboarding"),
    tab("activity", "Activity"),
    tab("tasks", "Tasks"),
    tab("funding", "Funds & Dealer"),
    tab("opportunities", "Opportunities"),
    tab("wealth", "Wealth"),
    ...(opts.consent ? [tab("consent", "Consent")] : []),
    tab("support", "Support", opts.openTickets > 0 ? opts.openTickets : null),
    tab("audit", "Audit History"),
  ];
}
