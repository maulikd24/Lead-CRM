import type { PartnerSource } from "./source";

/** The sections of the Partner workspace. Each is its own route, so a section loads only its own data and deep-links cleanly. */
export const PARTNER_TABS = [
  { key: "overview", label: "Overview", href: "/partners" },
  { key: "affiliates", label: "Affiliates", href: "/partners/affiliates" },
  { key: "referred-users", label: "Referred users", href: "/partners/referred-users" },
  { key: "payouts", label: "Payouts", href: "/partners/payouts" },
  { key: "contract", label: "Contract check", href: "/partners/contract" },
] as const;

/** The native source reads this CRM's own earnings records: it adds the network, commissions and statements, and has no contract to check. */
export const NATIVE_TABS = [
  { key: "overview", label: "Overview", href: "/partners" },
  { key: "affiliates", label: "Affiliates", href: "/partners/affiliates" },
  { key: "network", label: "Network", href: "/partners/network" },
  { key: "referred-users", label: "Referred", href: "/partners/referred-users" },
  { key: "commissions", label: "Commissions", href: "/partners/commissions" },
  { key: "payouts", label: "Payouts", href: "/partners/payouts" },
  { key: "statements", label: "Statements", href: "/partners/statements" },
] as const;

export type PartnerTabKey = (typeof PARTNER_TABS)[number]["key"] | (typeof NATIVE_TABS)[number]["key"];
export type PartnerTabDef = { key: PartnerTabKey; label: string; href: string };

export function partnerTabsFor(source: PartnerSource): readonly PartnerTabDef[] {
  return source === "native" ? NATIVE_TABS : PARTNER_TABS;
}

/** Which tab a URL belongs to. A detail page belongs to its list's tab; anything unknown falls back to Overview. */
export function partnerTabFor(pathname: string, tabs: readonly PartnerTabDef[] = PARTNER_TABS): PartnerTabKey {
  const path = pathname.replace(/\/+$/, "") || "/";
  const hit = tabs.filter((t) => t.key !== "overview").find((t) => path === t.href || path.startsWith(`${t.href}/`));
  return hit?.key ?? "overview";
}
