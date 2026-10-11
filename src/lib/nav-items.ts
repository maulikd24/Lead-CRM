import {
  LayoutDashboard,
  Users,
  UserCog,
  CheckSquare,
  Workflow,
  BarChart3,
  Settings,
  MessageSquareText,
  SlidersHorizontal,
  Plug,
  Sparkles,
  HelpCircle,
  AlertTriangle,
  Handshake,
  History,
  Activity,
  Shuffle,
  Briefcase,
  Landmark,
  LifeBuoy,
  Building2,
  Banknote,
  ClipboardCheck,
  ShieldCheck,
  KeyRound,
  Contact,
  Coins,
  Gift,
  Bug,
  TrendingUp,
  Server,
  Gauge,
  PackageCheck,
  BellRing,
  SearchCheck,
  BadgeCheck,
  FlaskConical,
  BookOpen,
  FileText,
  MessagesSquare,
  MessageCircle,
  Headphones,
  ChartLine,
  LibraryBig,
  Rocket,
  FileUp,
  Brain,
  PhoneCall,
  Merge,
  Headset,
  Megaphone,
  Network,
  IndianRupee,
  ListChecks,
  Kanban,
  Target,
  Route,
  Lightbulb,
  Palette,
  House,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/generated/prisma/client";
import type { NavFlag } from "@/lib/nav-flags";
import { can, type Area } from "@/lib/access/policy";

export type WorkspaceKey = "core" | "partner" | "management" | "finance" | "marketing";

/**
 * The workspaces: the slim rail's icons. Five primary surfaces (Today, Customers, Growth, Insights, Admin) and two supporting ones (Service,
 * Partners). `reference` is not on the rail: Help, Handbook and release notes live in All modules and the panel footer.
 */
export type SpaceKey = "today" | "customers" | "growth" | "service" | "partners" | "insights" | "admin" | "reference";
export const SPACES: Record<SpaceKey, { label: string; icon: LucideIcon; blurb: string; onRail: boolean }> = {
  today: { label: "Today", icon: House, blurb: "What needs you now: attention, approvals, tasks, commitments, complaints", onRail: true },
  customers: { label: "Customers", icon: Users, blurb: "Clients, Customer 360, households, duplicates, goals", onRail: true },
  growth: { label: "Growth", icon: Megaphone, blurb: "Campaigns, creative, attribution, referrals", onRail: true },
  service: { label: "Service", icon: Headset, blurb: "Inbox, calls, quality and support", onRail: true },
  partners: { label: "Partners", icon: Network, blurb: "Partner workspace, payouts, statements and earnings", onRail: true },
  insights: { label: "Insights", icon: ChartLine, blurb: "Insights, Ask, decisions and evidence, agents", onRail: true },
  admin: { label: "Admin", icon: Gauge, blurb: "Control plane: health, jobs, integrations, flags, users, roles", onRail: true },
  reference: { label: "Help and reference", icon: LibraryBig, blurb: "Handbook, release notes, help", onRail: false },
};
export const SPACE_ORDER: SpaceKey[] = ["today", "customers", "growth", "service", "partners", "insights", "admin", "reference"];

/** The order of a panel's groups. A group a later module declares that is not listed here follows these, in the order it first appears. */
export const GROUP_ORDER: Partial<Record<SpaceKey, string[]>> = {
  today: ["Needs me", "My work"],
  customers: ["People", "Lifecycle"],
  growth: ["Plan", "Run", "Grow", "Measure", "Connect"],
  service: ["Respond", "Review", "Track"],
  partners: ["Programme", "Money"],
  insights: ["Ask", "Understand", "Agents", "Measure", "Watch"],
  admin: ["Health", "People and access", "Connect", "Configure"],
  reference: ["Account", "Learn"],
};

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The registry area this item opens (src/lib/access/policy.ts). `roles` can only narrow it: the access test fails if an item lists a role the registry refuses. */
  area: Area;
  roles: Role[];
  /** Defaults to "core" when absent: the role's landing workspace layout (descriptive; does not affect the sidebar). */
  workspace?: WorkspaceKey;
  /** The rail workspace this item lives in, and the group inside its panel. Data only: a module that arrives later declares these two and slots in. */
  space: SpaceKey;
  group: string;
  /** A different rail workspace for particular roles (Finance sees Referrals under Partners, Marketing sees Integrations under Growth). */
  roleSpace?: Partial<Record<Role, SpaceKey>>;
  /** Also listed in these workspaces' panels (Approvals: Today and the control plane). All modules still lists it once. */
  alsoIn?: SpaceKey[];
  /** Tucked behind "More" in the panel (rarely used); always in All modules and Cmd+K. */
  more?: boolean;
  /** When set, the item is hidden unless this feature flag is enabled (greyed with its state for ADMIN). Flags are defined and evaluated in one place, src/lib/nav-flags.ts. */
  flag?: NavFlag;
  /** Set false while the page itself ships from another branch, so the sidebar does not prefetch a route that may not exist yet. */
  prefetch?: boolean;
};

export type { NavFlag };

export function navItemEnabled(item: NavItem, enabledFlags: readonly string[]): boolean {
  return !item.flag || enabledFlags.includes(item.flag);
}

// Roles that can reach the universal, role-agnostic utility pages (own account settings, help,
// release notes) regardless of which workspace their other nav items put them in.
const DISTRIBUTION_OS_ROLES: Role[] = ["TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE", "MARKETING"];

// Array order is the order inside a panel group. The panel, All modules, Cmd+K, Help and the tour all read this one list.
const ALL_ROLES: Role[] = ["ADMIN", "MANAGER", "RM", "DEALER", ...DISTRIBUTION_OS_ROLES];

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: LayoutDashboard, area: "dashboard", roles: ["ADMIN", "MANAGER", "RM"], space: "today", group: "Needs me" },
  { href: "/copilot", label: "Co-pilot", icon: Sparkles, area: "copilot", roles: ["ADMIN", "MANAGER", "RM"], space: "insights", group: "Ask" },
  { href: "/leads", label: "Leads", icon: Kanban, area: "clients", roles: ["ADMIN", "MANAGER", "RM"], flag: "kanban", space: "customers", group: "People" },
  { href: "/clients", label: "Clients", icon: Users, area: "clients", roles: ["ADMIN", "MANAGER", "RM"], space: "customers", group: "People" },
  { href: "/clients/duplicates", label: "Duplicate customers", icon: Merge, area: "duplicates", roles: ["ADMIN", "MANAGER", "RM"], flag: "merge-review", space: "customers", group: "People" },
  { href: "/households", label: "Households", icon: Landmark, area: "households", roles: ["ADMIN", "MANAGER"], space: "customers", group: "People" },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, area: "tasks", roles: ["ADMIN", "MANAGER", "RM", "MARKETING"], space: "today", group: "Needs me" },
  { href: "/approvals", label: "Approvals", icon: ListChecks, area: "approvals", roles: ["ADMIN", "MANAGER", "RM", "FINANCE", "MARKETING"], flag: "approvals-inbox", space: "today", group: "Needs me", alsoIn: ["admin"] },
  { href: "/service", label: "Complaints and promises", icon: LifeBuoy, area: "service-state", roles: ["ADMIN", "MANAGER", "RM"], flag: "service-state", space: "today", group: "Needs me" },
  { href: "/inbox", label: "Inbox", icon: MessagesSquare, area: "inbox", roles: ["ADMIN", "MANAGER", "RM"], space: "service", group: "Respond" },
  { href: "/agents", label: "Agent drafts", icon: Sparkles, area: "agent-drafts", roles: ["ADMIN", "MANAGER", "RM"], space: "insights", group: "Agents" },
  { href: "/product-registry", label: "Products", icon: PackageCheck, area: "product-registry", roles: ["ADMIN", "MANAGER", "RM"], flag: "product-registry", space: "customers", group: "Lifecycle" },
  { href: "/dashboard?tab=attention", label: "Goals at risk", icon: Target, area: "outcomes", roles: ["ADMIN", "MANAGER", "RM"], flag: "outcomes", space: "today", group: "Needs me" },
  { href: "/marketing?tab=campaigns", label: "Attribution", icon: Route, area: "marketing", roles: ["ADMIN", "MARKETING"], flag: "attribution", space: "growth", group: "Measure" },
  { href: "/reports", label: "Reports", icon: BarChart3, area: "reports", roles: ["ADMIN", "MANAGER"], space: "insights", group: "Measure" },
  { href: "/management-dashboard", label: "Manager Dashboard", icon: TrendingUp, area: "management-dashboard", roles: ["ADMIN", "MANAGER"], space: "insights", group: "Measure" },
  { href: "/intelligence", label: "Customer Intelligence", icon: Brain, area: "intelligence", roles: ["ADMIN", "MANAGER"], space: "insights", group: "Understand" },
  { href: "/decisions", label: "Decision review", icon: ListChecks, area: "decision-review", roles: ["ADMIN", "MANAGER"], flag: "decision-drawer", space: "insights", group: "Understand" },
  { href: "/marketing", label: "Marketing", icon: Megaphone, area: "marketing", roles: ["ADMIN", "MARKETING"], flag: "marketing", space: "growth", group: "Plan" },
  { href: "/marketing/needs-attention", label: "Campaign anomalies", icon: BellRing, area: "attention-marketing", roles: ["ADMIN", "MARKETING"], flag: "attention-engine", space: "insights", group: "Watch" },
  { href: "/marketing?tab=creative", label: "Creative", icon: Palette, area: "marketing", roles: ["ADMIN", "MARKETING"], flag: "marketing", space: "growth", group: "Run" },
  { href: "/marketing/approved-claims", label: "Approved claims", icon: BadgeCheck, area: "product-registry-claims", roles: ["ADMIN", "MARKETING"], flag: "product-registry", space: "growth", group: "Run" },
  { href: "/quality-audit", label: "Quality Audit", icon: Headphones, area: "quality-audit", roles: ["ADMIN", "MANAGER", "RM"], space: "service", group: "Review" },
  { href: "/calls", label: "Call recordings", icon: PhoneCall, area: "calls", roles: ["ADMIN", "MANAGER"], flag: "calls-review", space: "service", group: "Review" },
  { href: "/support", label: "Support SLA", icon: Headset, area: "support", roles: ["ADMIN", "MANAGER"], flag: "support-sla", space: "service", group: "Track" },
  { href: "/exceptions", label: "Exceptions", icon: AlertTriangle, area: "exceptions", roles: ["ADMIN", "MANAGER"], space: "service", group: "Review" },
  { href: "/journeys", label: "Journeys", icon: Workflow, area: "journeys", roles: ["ADMIN", "MANAGER"], space: "customers", group: "Lifecycle" },
  { href: "/dealer-desk", label: "Dealer Desk", icon: Handshake, area: "dealer-desk", roles: ["DEALER"], space: "today", group: "My work" },
  { href: "/partner-home", label: "Partner Home", icon: Briefcase, area: "partner-home", roles: ["PARTNER", "AFFILIATE", "DISTRIBUTOR"], workspace: "partner", space: "today", group: "My work" },
  { href: "/management-console", label: "Management Console", icon: Building2, area: "management-console", roles: ["TEAM_MANAGER"], workspace: "management", space: "today", group: "My work" },
  { href: "/partners", label: "Partner workspace", icon: Network, area: "partner-workspace", roles: ["ADMIN", "FINANCE", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"], flag: "partner-workspace", space: "partners", group: "Programme" },
  { href: "/referrals", label: "Referrals", icon: Gift, area: "referral-program", roles: ["ADMIN", "FINANCE", "MARKETING"], flag: "referral-program", space: "growth", group: "Grow", roleSpace: { FINANCE: "partners" } },
  { href: "/earnings", label: "Earnings", icon: Coins, area: "earnings", roles: ["ADMIN", "FINANCE"], space: "partners", group: "Money" },
  { href: "/finance-console", label: "Finance Console", icon: Banknote, area: "finance-console", roles: ["FINANCE", "ADMIN"], workspace: "finance", space: "today", group: "My work" },
  { href: "/settings/account", label: "Settings", icon: Settings, area: "account", roles: ALL_ROLES, space: "reference", group: "Account" },
  { href: "/settings/stages", label: "Stages", icon: SlidersHorizontal, area: "settings-stages", roles: ["ADMIN"], space: "admin", group: "Configure" },
  { href: "/settings/templates", label: "Templates", icon: MessageSquareText, area: "settings-templates", roles: ["ADMIN"], space: "admin", group: "Configure", more: true },
  { href: "/settings/access", label: "Who can see what", icon: ShieldCheck, area: "settings-access", roles: ["ADMIN"], space: "admin", group: "People and access" },
  { href: "/settings/sign-in", label: "Sign-in", icon: KeyRound, area: "settings-sign-in", roles: ["ADMIN"], flag: "google-signin", space: "admin", group: "People and access" },
  { href: "/settings/users", label: "Users", icon: UserCog, area: "settings-users", roles: ["ADMIN"], space: "admin", group: "People and access" },
  { href: "/settings/integrations", label: "Apps & Integrations", icon: Plug, area: "marketing-ad-integrations", roles: ["ADMIN", "MARKETING"], space: "admin", group: "Connect", roleSpace: { MARKETING: "growth" } },
  { href: "/settings/whatsapp", label: "WhatsApp Accounts", icon: MessageCircle, area: "settings-whatsapp", roles: ["ADMIN"], space: "admin", group: "Connect" },
  { href: "/settings/approval-workflows", label: "Approval Workflows", icon: ClipboardCheck, area: "settings-approvals", roles: ["ADMIN"], space: "admin", group: "Configure" },
  { href: "/settings/lead-assignment", label: "Lead Assignment", icon: Shuffle, area: "settings-lead-assignment", roles: ["ADMIN"], space: "admin", group: "Configure", more: true },
  { href: "/activity-log", label: "Activity Log", icon: Activity, area: "activity-log", roles: ["ADMIN", "MANAGER"], space: "admin", group: "Health", roleSpace: { MANAGER: "insights" } },
  { href: "/settings/data-privacy", label: "Data Privacy", icon: ShieldCheck, area: "settings-data-privacy", roles: ["ADMIN"], space: "admin", group: "People and access" },
  { href: "/settings/partner-tiers", label: "Partner Directory", icon: Contact, area: "partner-directory", roles: ["ADMIN"], space: "partners", group: "Programme" },
  { href: "/settings/partner-finance", label: "Partner finance", icon: IndianRupee, area: "partner-finance", roles: ["ADMIN", "FINANCE"], flag: "partner-workspace", space: "partners", group: "Money" },
  { href: "/settings/backoffice-import", label: "Back-office import", icon: FileUp, area: "settings-backoffice-import", roles: ["ADMIN"], flag: "backoffice-import", space: "admin", group: "Connect" },
  { href: "/settings/go-live", label: "Go-Live Checklist", icon: Rocket, area: "settings-go-live", roles: ["ADMIN"], space: "admin", group: "Health", more: true },
  { href: "/settings/system", label: "System Overview", icon: Server, area: "settings-system", roles: ["ADMIN"], space: "admin", group: "Health" },
  { href: "/settings/product-registry", label: "Product registry", icon: PackageCheck, area: "settings-product-registry", roles: ["ADMIN"], flag: "product-registry", space: "admin", group: "Configure", more: true },
  { href: "/settings/decision-shadow", label: "Decision shadow report", icon: FlaskConical, area: "decision-report", roles: ["ADMIN"], flag: "decision-drawer", space: "admin", group: "Configure", more: true },
  { href: "/settings/control-plane/investigate", label: "Investigate an action", icon: SearchCheck, area: "action-ledger-investigate", roles: ["ADMIN"], flag: "action-ledger-investigate", space: "admin", group: "Health" },
  { href: "/settings/control-plane", label: "Control plane", icon: Gauge, area: "control-plane", roles: ["ADMIN"], flag: "control-plane", space: "admin", group: "Health" },
  { href: "/debugger", label: "Debugger", icon: Bug, area: "debugger", roles: ["ADMIN"], space: "admin", group: "Health", more: true },
  { href: "/handbook", label: "Handbook", icon: BookOpen, area: "reference", roles: ALL_ROLES, space: "reference", group: "Learn" },
  { href: "/feature-specs", label: "Feature Specs", icon: FileText, area: "feature-specs", roles: ["ADMIN", "MANAGER"], space: "reference", group: "Learn" },
  { href: "/release-notes", label: "Release Notes", icon: History, area: "reference", roles: ALL_ROLES, space: "reference", group: "Learn" },
  { href: "/help", label: "Help", icon: HelpCircle, area: "reference", roles: ALL_ROLES, space: "reference", group: "Learn" },
  { href: "/agents/insights", label: "Insights", icon: Lightbulb, area: "agent-insights", roles: ["ADMIN", "MANAGER"], flag: "insights", space: "insights", group: "Understand" },
  { href: "/partners/payouts", label: "Payouts", icon: Banknote, area: "partner-workspace", roles: ["ADMIN", "FINANCE", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"], flag: "partner-workspace", space: "partners", group: "Programme" },
  { href: "/partners/statements", label: "Statements", icon: FileText, area: "partner-workspace", roles: ["ADMIN", "FINANCE", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"], flag: "partner-workspace", space: "partners", group: "Programme" },
];

/** The one place that decides what a role sees: role match, and any feature flag the item sits behind. Sidebar, palette and help all use it. */
export function visibleNavItems(role: Role, enabledFlags: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role) && can(role, item.area, "view") && navItemEnabled(item, enabledFlags));
}
