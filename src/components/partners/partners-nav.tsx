"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/partners", label: "Overview", exact: true },
  { href: "/partners/affiliates", label: "Affiliates" },
  { href: "/partners/referred-users", label: "Referred users" },
  { href: "/partners/payouts", label: "Payouts" },
];

export function PartnersNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Partner workspace" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
