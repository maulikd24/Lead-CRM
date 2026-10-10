/** The sections of the Partner workspace. Each is its own route, so a section loads only its own data and deep-links cleanly. */
export const PARTNER_TABS = [
  { key: "overview", label: "Overview", href: "/partners" },
  { key: "affiliates", label: "Affiliates", href: "/partners/affiliates" },
  { key: "referred-users", label: "Referred users", href: "/partners/referred-users" },
  { key: "payouts", label: "Payouts", href: "/partners/payouts" },
  { key: "contract", label: "Contract check", href: "/partners/contract" },
] as const;

export type PartnerTabKey = (typeof PARTNER_TABS)[number]["key"];

/** Which tab a URL belongs to. An affiliate's detail page belongs to Affiliates; anything unknown falls back to Overview. */
export function partnerTabFor(pathname: string): PartnerTabKey {
  const path = pathname.replace(/\/+$/, "") || "/";
  const hit = PARTNER_TABS.filter((t) => t.key !== "overview").find((t) => path === t.href || path.startsWith(`${t.href}/`));
  return hit?.key ?? "overview";
}
