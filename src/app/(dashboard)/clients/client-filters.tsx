"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { X } from "lucide-react";

import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { LEAD_SOURCES, CLIENT_TYPES } from "@/lib/clients/options";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type StageOption = { id: string; name: string };
type UserOption = { id: string; name: string };

const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH"];
const SLA_OPTIONS = ["ON_TRACK", "DUE_SOON", "OVERDUE", "NOT_APPLICABLE"];
const STATUS_OPTIONS = ["ACTIVE", "ON_HOLD", "COMPLETED", "NOT_PROCEEDING"];
const KYC_OPTIONS = ["PENDING", "APPROVED", "REJECTED", "ADDITIONAL_INFO_REQUIRED"];
const FUNDING_OPTIONS = ["PENDING", "PARTIALLY_FUNDED", "FULLY_FUNDED", "NOT_PROCEEDING"];
const DEALER_OPTIONS = ["PENDING", "SCHEDULED", "COMPLETED"];

const LABELS: Record<string, string> = {
  ON_TRACK: "On Track",
  DUE_SOON: "Due Soon",
  OVERDUE: "Overdue",
  NOT_APPLICABLE: "N/A",
  ACTIVE: "Active",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
  NOT_PROCEEDING: "Not Proceeding",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ADDITIONAL_INFO_REQUIRED: "Additional Info Required",
  PARTIALLY_FUNDED: "Partially Funded",
  FULLY_FUNDED: "Fully Funded",
  SCHEDULED: "Scheduled",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export function ClientFilters({ stages, users }: { stages: StageOption[]; users: UserOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [pathname, router, searchParams],
  );

  const debouncedSetParam = useDebouncedCallback(setParam, 300);

  function clearAll() {
    startTransition(() => {
      router.push(pathname);
    });
  }

  const hasFilters = [...searchParams.keys()].some((k) => k !== "page");

  const FIELD_LABELS: Record<string, string> = {
    q: "Search",
    stage: "Stage",
    priority: "Priority",
    sla: "SLA",
    status: "Status",
    rm: "Assigned RM",
    kyc: "KYC",
    funding: "Funding",
    dealer: "Dealer",
    clientType: "Client Type",
    leadSource: "Lead Source",
    createdFrom: "Created From",
    createdTo: "Created To",
  };

  function valueLabel(key: string, value: string): string {
    if (key === "stage") return stages.find((s) => s.id === value)?.name ?? value;
    if (key === "rm") return users.find((u) => u.id === value)?.name ?? value;
    return LABELS[value] ?? value;
  }

  const activeFilters = [...searchParams.entries()].filter(([key]) => key !== "page" && key !== "q");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          defaultValue={searchParams.get("q") ?? ""}
          placeholder="Search name, mobile, email, client ID, KYC ref, dealer ID..."
          className="w-80"
          onChange={(e) => debouncedSetParam("q", e.target.value)}
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear filters
          </Button>
        )}
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFilters.map(([key, value]) => (
            <Badge key={key} variant="accent" className="gap-1 py-1 pr-1">
              {FIELD_LABELS[key] ?? key}: {valueLabel(key, value)}
              <button
                type="button"
                onClick={() => setParam(key, "")}
                className="ml-0.5 rounded-full p-0.5 hover:bg-accent/20"
                aria-label={`Clear ${FIELD_LABELS[key] ?? key} filter`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Select value={searchParams.get("stage") ?? ""} onValueChange={(v) => setParam("stage", v ?? "")}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Stage">{(v: string) => stages.find((s) => s.id === v)?.name ?? "Stage"}</SelectValue></SelectTrigger>
          <SelectContent>
            {stages.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
          </SelectContent>
        </Select>

        <Select value={searchParams.get("priority") ?? ""} onValueChange={(v) => setParam("priority", v ?? "")}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Priority">{(v: string) => LABELS[v] ?? "Priority"}</SelectValue></SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((p) => (<SelectItem key={p} value={p}>{LABELS[p]}</SelectItem>))}
          </SelectContent>
        </Select>

        <Select value={searchParams.get("sla") ?? ""} onValueChange={(v) => setParam("sla", v ?? "")}>
          <SelectTrigger className="w-full"><SelectValue placeholder="SLA Status">{(v: string) => LABELS[v] ?? "SLA Status"}</SelectValue></SelectTrigger>
          <SelectContent>
            {SLA_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{LABELS[s]}</SelectItem>))}
          </SelectContent>
        </Select>

        <Select value={searchParams.get("status") ?? ""} onValueChange={(v) => setParam("status", v ?? "")}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Status">{(v: string) => LABELS[v] ?? "Status"}</SelectValue></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{LABELS[s]}</SelectItem>))}
          </SelectContent>
        </Select>

        <Select value={searchParams.get("rm") ?? ""} onValueChange={(v) => setParam("rm", v ?? "")}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Assigned RM">{(v: string) => users.find((u) => u.id === v)?.name ?? "Assigned RM"}</SelectValue></SelectTrigger>
          <SelectContent>
            {users.map((u) => (<SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>))}
          </SelectContent>
        </Select>

        <Select value={searchParams.get("kyc") ?? ""} onValueChange={(v) => setParam("kyc", v ?? "")}>
          <SelectTrigger className="w-full"><SelectValue placeholder="KYC Status">{(v: string) => LABELS[v] ?? "KYC Status"}</SelectValue></SelectTrigger>
          <SelectContent>
            {KYC_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{LABELS[s]}</SelectItem>))}
          </SelectContent>
        </Select>

        <Select value={searchParams.get("funding") ?? ""} onValueChange={(v) => setParam("funding", v ?? "")}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Funding Status">{(v: string) => LABELS[v] ?? "Funding Status"}</SelectValue></SelectTrigger>
          <SelectContent>
            {FUNDING_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{LABELS[s]}</SelectItem>))}
          </SelectContent>
        </Select>

        <Select value={searchParams.get("dealer") ?? ""} onValueChange={(v) => setParam("dealer", v ?? "")}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Dealer Status">{(v: string) => LABELS[v] ?? "Dealer Status"}</SelectValue></SelectTrigger>
          <SelectContent>
            {DEALER_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{LABELS[s]}</SelectItem>))}
          </SelectContent>
        </Select>

        <Select value={searchParams.get("clientType") ?? ""} onValueChange={(v) => setParam("clientType", v ?? "")}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Client Type">{(v: string) => v || "Client Type"}</SelectValue></SelectTrigger>
          <SelectContent>
            {CLIENT_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
          </SelectContent>
        </Select>

        <Select value={searchParams.get("leadSource") ?? ""} onValueChange={(v) => setParam("leadSource", v ?? "")}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Lead Source">{(v: string) => v || "Lead Source"}</SelectValue></SelectTrigger>
          <SelectContent>
            {LEAD_SOURCES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          defaultValue={searchParams.get("createdFrom") ?? ""}
          onChange={(e) => setParam("createdFrom", e.target.value)}
        />
        <Input
          type="date"
          defaultValue={searchParams.get("createdTo") ?? ""}
          onChange={(e) => setParam("createdTo", e.target.value)}
        />
      </div>
    </div>
  );
}
