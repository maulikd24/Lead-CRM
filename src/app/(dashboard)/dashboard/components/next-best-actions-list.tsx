"use client";

import { useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { NbaKind } from "@/lib/copilot/next-best-action";

export type NbaListEntry = {
  clientId: string;
  clientName: string;
  kind: NbaKind;
  label: string;
  detail: string;
};

const CONTACT_KYC_KINDS: NbaKind[] = ["contact_client", "collect_documents", "submit_kyc", "follow_up_kyc", "resolve_kyc_issue"];
const FUNDING_DEALER_KINDS: NbaKind[] = ["follow_up_funding", "schedule_dealer_intro", "follow_up_dealer_intro", "mark_onboarding_completed"];

const FILTERS = [
  { label: "All", kinds: null },
  { label: "Contact & KYC", kinds: CONTACT_KYC_KINDS },
  { label: "Funding & Dealer", kinds: FUNDING_DEALER_KINDS },
] as const;

export function NextBestActionsList({ entries }: { entries: NbaListEntry[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["label"]>("All");
  const active = FILTERS.find((f) => f.label === filter) ?? FILTERS[0];
  const filtered = active.kinds ? entries.filter((e) => active.kinds!.includes(e.kind)) : entries;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setFilter(f.label)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-semibold transition-colors",
              filter === f.label ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {filtered.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nothing in this filter right now.</p>}
        {filtered.slice(0, 5).map((entry, i) => (
          <div key={`${entry.clientId}-${i}`} className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1.5 hover:bg-muted">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{entry.label}</p>
              <p className="truncate text-xs text-muted-foreground">
                {entry.clientName} · {entry.detail}
              </p>
            </div>
            <Link href={`/clients/${entry.clientId}`} className="shrink-0 text-[11px] font-bold text-primary hover:underline">
              Start
            </Link>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Showing {Math.min(5, filtered.length)} of {filtered.length} · sorted by priority
      </p>
    </div>
  );
}
