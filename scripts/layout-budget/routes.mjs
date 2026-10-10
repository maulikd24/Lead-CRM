// Every converted screen and tab the layout budget covers. `{BUSY}` is the id of the seeded busy customer, `{CALL}` the id of
// one of its calls, `{AFFILIATE}` the id of the first affiliate in the sample partner data; the runner resolves them.
//
// To add a screen: add one line here. A screen that cannot meet the phone budget goes in EXCEPTIONS with a reason (aim for none).
export const PHONE = { width: 390, height: 844 };
export const LAPTOPS = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }];
/** A phone page may be at most this many viewport heights tall. */
export const PHONE_BUDGET = 1.7;

const tabs = (id, role, base, keys, group, join = "?") => keys.map((k) => ({ id: `${id}-${k || "default"}`, role, group, path: k ? `${base}${join}tab=${k}` : base }));

export const ROUTES = [
  ...tabs("today-admin", "admin", "/dashboard", ["", "attention", "pipeline", "myday"], "Home"),
  ...tabs("today-manager", "manager", "/dashboard", ["", "attention", "pipeline", "myday"], "Home"),
  ...tabs("today-rm", "rm", "/dashboard", ["", "attention", "pipeline"], "Home"),
  ...tabs("dashboard-full", "admin", "/dashboard?view=full", ["", "attention", "pipeline", "team"], "Home", "&"),
  ...tabs("manager-dashboard", "manager", "/management-dashboard", ["", "activity", "team"], "Home"),
  ...tabs("insights", "admin", "/agents/insights", ["", "replies", "conversion", "quality"], "Insights and agents"),
  ...tabs("agents", "admin", "/agents", ["", "sent", "rules"], "Insights and agents"),
  { id: "inbox", role: "admin", group: "Insights and agents", path: "/inbox?client={BUSY}" },
  ...tabs("client", "admin", "/clients/{BUSY}", ["", "onboarding", "activity", "tasks", "funding", "opportunities", "wealth", "consent", "support", "audit"], "Customer record"),
  ...tabs("c360", "admin", "/clients/{BUSY}/360", ["", "timeline", "portfolio", "consent", "tickets", "outcomes"], "Customer 360"),
  ...tabs("consent", "admin", "/settings/consent", ["", "ledger", "withdrawals", "policy"], "Operations"),
  ...tabs("support", "admin", "/support", ["", "breaching", "resolved", "workload"], "Operations"),
  ...tabs("calls", "admin", "/calls", ["", "rollup"], "Operations"),
  ...tabs("call", "admin", "/calls/{CALL}", ["", "scores", "actions", "recording"], "Operations"),
  ...tabs("marketing", "admin", "/marketing", ["", "campaigns", "creative", "posts"], "Marketing"),
  { id: "partners-overview", role: "admin", group: "Partners", path: "/partners" },
  { id: "partners-affiliates", role: "admin", group: "Partners", path: "/partners/affiliates" },
  { id: "partners-payouts", role: "admin", group: "Partners", path: "/partners/payouts" },
  { id: "partners-referred", role: "admin", group: "Partners", path: "/partners/referred-users" },
  { id: "partners-detail", role: "admin", group: "Partners", path: "/partners/affiliates/{AFFILIATE}" },
  { id: "partners-contract", role: "admin", group: "Partners", path: "/partners/contract" },
  ...tabs("duplicates", "manager", "/clients/duplicates", ["", "plan"], "Duplicate customers"),
  ...tabs("integrations", "admin", "/settings/integrations", ["", "marketing", "data", "ai"], "Admin"),
  ...tabs("backoffice", "admin", "/settings/backoffice-import", ["", "preview", "runs", "mapping"], "Admin"),
];

/** Screens allowed to exceed the phone budget, with the reason. Aim for none. */
export const EXCEPTIONS = {};
