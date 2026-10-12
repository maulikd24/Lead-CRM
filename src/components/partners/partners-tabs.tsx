"use client";

import { usePathname } from "next/navigation";

import { WorkspaceTabs } from "@/components/workspace";
import { partnerTabFor, type PartnerTabDef } from "@/lib/partners/tabs";

/** The section tabs. Each is a real link to its own route; the active one follows the URL (a detail page stays under its list's tab). */
export function PartnersTabs({ tabs }: { tabs: readonly PartnerTabDef[] }) {
  const active = partnerTabFor(usePathname() ?? "/partners", tabs);
  return <WorkspaceTabs tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: t.href }))} active={active} idPrefix="partners" label="Partner workspace sections" />;
}
