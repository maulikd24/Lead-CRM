// Every converted screen and tab the layout budget covers. `{BUSY}` is the id of the seeded busy customer, `{CALL}` the id of
// one of its calls, `{AFFILIATE}` the id of the first partner on the partners list, `{STMT}` the first statement link there
// (partner id and run, as a path); the runner resolves them. Roles: admin, manager, rm (the standard seed), finance, teammanager,
// distributor and partner (the synthetic partner data from `npm run layout-budget:seed`, see docs/workspace-pattern.md).
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
  ...tabs("referrals", "admin", "/referrals", ["", "referrers", "rewards", "rules", "statements"], "Referrals"),
  ...tabs("referrals-finance", "finance", "/referrals", ["", "statements"], "Referrals"),
  { id: "partners-overview", role: "admin", group: "Partners", path: "/partners" },
  { id: "partners-affiliates", role: "admin", group: "Partners", path: "/partners/affiliates" },
  { id: "partners-detail", role: "admin", group: "Partners", path: "/partners/affiliates/{AFFILIATE}" },
  { id: "partners-network", role: "admin", group: "Partners", path: "/partners/network" },
  { id: "partners-referred", role: "admin", group: "Partners", path: "/partners/referred-users" },
  { id: "partners-commissions", role: "admin", group: "Partners", path: "/partners/commissions" },
  { id: "partners-adjustments", role: "admin", group: "Partners", path: "/partners/commissions?view=adjustments" },
  { id: "partners-runs", role: "admin", group: "Partners", path: "/partners/payouts" },
  { id: "partners-payouts", role: "admin", group: "Partners", path: "/partners/payouts?view=payouts" },
  { id: "partners-statements", role: "admin", group: "Partners", path: "/partners/statements" },
  { id: "partners-statements-open", role: "admin", group: "Partners", path: "/partners/statements?view=open" },
  { id: "partners-statements-month", role: "admin", group: "Partners", path: "/partners/statements?view=month" },
  { id: "partners-statements-fy", role: "admin", group: "Partners", path: "/partners/statements?view=fy" },
  { id: "partners-statement-run", role: "admin", group: "Partners", path: "{STMT}" },
  { id: "partners-statement-month", role: "admin", group: "Partners", path: "{STMT_BASE}?run=m-{MONTH}" },
  { id: "partners-statement-fy", role: "admin", group: "Partners", path: "{STMT_BASE}?run=fy-{FY}" },
  { id: "partners-statement-ytd", role: "admin", group: "Partners", path: "{STMT_BASE}?run=fyc-{FY}" },
  ...tabs("partner-finance", "admin", "/settings/partner-finance", ["", "overrides", "statements", "referrals", "approve"], "Partners"),
  { id: "partners-finance-role", role: "finance", group: "Partners", path: "/partners" },
  { id: "partners-statements-finance", role: "finance", group: "Partners", path: "/partners/statements" },
  { id: "partner-home-overview", role: "distributor", group: "Partners", path: "/partner-home" },
  { id: "partner-home-clients", role: "distributor", group: "Partners", path: "/partner-home?tab=clients" },
  { id: "partners-own-overview", role: "distributor", group: "Partners", path: "/partners" },
  { id: "partners-own-network", role: "distributor", group: "Partners", path: "/partners/network" },
  { id: "partners-own-commissions", role: "distributor", group: "Partners", path: "/partners/commissions" },
  { id: "partners-own-payouts", role: "distributor", group: "Partners", path: "/partners/payouts" },
  { id: "partners-own-statements", role: "distributor", group: "Partners", path: "/partners/statements" },
  ...tabs("management-console", "teammanager", "/management-console", ["", "partners"], "Management Console"),
  { id: "partners-team-overview", role: "teammanager", group: "Management Console", path: "/partners" },
  { id: "partners-team-affiliates", role: "teammanager", group: "Management Console", path: "/partners/affiliates" },
  ...tabs("duplicates", "manager", "/clients/duplicates", ["", "plan"], "Duplicate customers"),
  ...tabs("integrations", "admin", "/settings/integrations", ["", "marketing", "data", "ai"], "Admin"),
  ...tabs("backoffice", "admin", "/settings/backoffice-import", ["", "preview", "runs", "mapping"], "Admin"),
];

/** Screens allowed to exceed the phone budget, with the reason. Aim for none. */
export const EXCEPTIONS = {};
