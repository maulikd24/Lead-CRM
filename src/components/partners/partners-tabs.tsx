"use client";

import { usePathname } from "next/navigation";

import { WorkspaceTabs } from "@/components/workspace";
import { PARTNER_TABS, partnerTabFor } from "@/lib/partners/tabs";

/** The section tabs. Each is a real link to its own route; the active one follows the URL (an affiliate's page stays under Affiliates). */
export function PartnersTabs() {
  const active = partnerTabFor(usePathname() ?? "/partners");
  return <WorkspaceTabs tabs={PARTNER_TABS.map((t) => ({ key: t.key, label: t.label, href: t.href }))} active={active} idPrefix="partners" label="Partner workspace sections" />;
}
