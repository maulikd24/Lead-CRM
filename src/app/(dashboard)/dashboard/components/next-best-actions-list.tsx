"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { SuggestionStack } from "@/components/suggest/suggestion-stack";
import { createTaskAction } from "@/app/(dashboard)/tasks/actions";
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

export function NextBestActionsList({ entries, userId }: { entries: NbaListEntry[]; userId: string }) {
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
      {filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Nothing in this filter right now.</p>
      ) : (
        <SuggestionStack
          storageKey={`allvest:suggest:nba:${userId}`}
          items={filtered.slice(0, 8).map((e) => ({ id: `${e.clientId}:${e.kind}`, title: e.label, subject: e.clientName, reason: e.detail, href: `/clients/${e.clientId}` }))}
          onAccept={async (item) => {
            const fd = new FormData();
            fd.set("clientId", item.id.split(":")[0]);
            fd.set("title", item.title);
            fd.set("dueAt", new Date(Date.now() + 24 * 3600_000).toISOString());
            fd.set("assignedToId", userId);
            fd.set("category", "FOLLOW_UP");
            fd.set("source", "next-best-action");
            await createTaskAction(fd);
          }}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {filtered.length} suggestion{filtered.length === 1 ? "" : "s"} · sorted by priority
      </p>
    </div>
  );
}
