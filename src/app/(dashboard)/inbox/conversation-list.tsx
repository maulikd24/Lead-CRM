"use client";

import { Search, UserCircle2 } from "lucide-react";

import { cn, initials } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ConversationFilters, ConversationSummary } from "@/lib/whatsapp/inbox-queries";
import { AccountStatusDot } from "./account-status-dot";
import { formatListTimestamp } from "./format";

export type AccountOption = { id: string; label: string; phoneNumber: string | null; online: boolean };
export type RmOption = { id: string; name: string };

const ALL = "all";

export function ConversationList({
  conversations,
  loading,
  selectedId,
  onSelect,
  filters,
  onFiltersChange,
  accounts,
  rms,
  showTeamFilters,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (clientId: string) => void;
  filters: ConversationFilters;
  onFiltersChange: (next: ConversationFilters) => void;
  accounts: AccountOption[];
  rms: RmOption[];
  showTeamFilters: boolean;
}) {
  const accountLabel = (id: string | undefined) => accounts.find((a) => a.id === id)?.label ?? "All numbers";
  const rmLabel = (id: string | undefined) => rms.find((r) => r.id === id)?.name ?? "All RMs";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            defaultValue={filters.q ?? ""}
            placeholder="Search name, number, client ID..."
            className="h-8 pl-8 text-xs"
            onChange={(e) => onFiltersChange({ ...filters, q: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {showTeamFilters && (
            <>
              <Select
                value={filters.accountId ?? ALL}
                onValueChange={(v) => onFiltersChange({ ...filters, accountId: v && v !== ALL ? v : undefined })}
              >
                <SelectTrigger size="sm" className="min-w-0 flex-1 text-xs">
                  <SelectValue>{(v: string) => (v === ALL ? "All numbers" : accountLabel(v))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All numbers</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                      {a.phoneNumber ? ` · +${a.phoneNumber}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.assigneeId ?? ALL}
                onValueChange={(v) => onFiltersChange({ ...filters, assigneeId: v && v !== ALL ? v : undefined })}
              >
                <SelectTrigger size="sm" className="min-w-0 flex-1 text-xs">
                  <SelectValue>{(v: string) => (v === ALL ? "All RMs" : rmLabel(v))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All RMs</SelectItem>
                  {rms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          <button
            type="button"
            onClick={() => onFiltersChange({ ...filters, unreadOnly: !filters.unreadOnly })}
            className={cn(
              "h-8 shrink-0 rounded-md border px-2.5 text-xs font-semibold transition-colors",
              filters.unreadOnly ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Unread
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && conversations.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">Loading conversations…</p>}
        {!loading && conversations.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">No conversations match.</p>
        )}
        {conversations.map((c) => (
          <button
            key={c.clientId}
            type="button"
            onClick={() => onSelect(c.clientId)}
            className={cn(
              "flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors hover:bg-muted/60",
              selectedId === c.clientId && "bg-muted",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {initials(c.clientName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className={cn("truncate text-sm", c.unread > 0 ? "font-bold" : "font-semibold")}>{c.clientName}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatListTimestamp(c.lastAt)}</span>
              </span>
              <span className="mt-0.5 flex items-center justify-between gap-2">
                <span className={cn("truncate text-xs", c.unread > 0 ? "text-foreground" : "text-muted-foreground")}>
                  {c.lastDirection === "OUTBOUND" ? "You: " : ""}
                  {c.lastBody}
                </span>
                {c.unread > 0 && (
                  <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {c.unread}
                  </span>
                )}
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px]">
                  <AccountStatusDot online={c.accountOnline} className="size-1.5" />
                  {c.accountLabel}
                  {c.accountPhone ? ` · +${c.accountPhone}` : ""}
                </Badge>
                {showTeamFilters &&
                  (c.assigneeName ? (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <UserCircle2 className="size-3" />
                      {c.assigneeName}
                    </span>
                  ) : (
                    <Badge variant="warning" className="h-4 px-1.5 text-[10px]">
                      Unassigned
                    </Badge>
                  ))}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
