"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SOURCE_TYPE_OPTIONS = [
  { value: "CALL", label: "Calls" },
  { value: "WHATSAPP_THREAD", label: "WhatsApp" },
];
const SENTIMENT_OPTIONS = [
  { value: "positive", label: "Positive" },
  { value: "neutral", label: "Neutral" },
  { value: "mixed", label: "Mixed" },
  { value: "negative", label: "Negative" },
];
const STATUS_OPTIONS = [
  { value: "pending_review", label: "Pending Review" },
  { value: "reviewed", label: "Reviewed" },
];

export function QualityAuditFilters({ rms }: { rms: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [pathname, router, searchParams],
  );

  const hasFilters = ["sourceType", "sentiment", "status", "rm"].some((k) => searchParams.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={searchParams.get("sourceType") ?? ""} onValueChange={(v) => setParam("sourceType", v ?? "")}>
        <SelectTrigger className="w-40">
          <SelectValue>{(v: string) => SOURCE_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "Channel"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SOURCE_TYPE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("sentiment") ?? ""} onValueChange={(v) => setParam("sentiment", v ?? "")}>
        <SelectTrigger className="w-36">
          <SelectValue>{(v: string) => SENTIMENT_OPTIONS.find((o) => o.value === v)?.label ?? "Sentiment"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SENTIMENT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("status") ?? ""} onValueChange={(v) => setParam("status", v ?? "")}>
        <SelectTrigger className="w-40">
          <SelectValue>{(v: string) => STATUS_OPTIONS.find((o) => o.value === v)?.label ?? "Review Status"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {rms.length > 0 && (
        <Select value={searchParams.get("rm") ?? ""} onValueChange={(v) => setParam("rm", v ?? "")}>
          <SelectTrigger className="w-40">
            <SelectValue>{(v: string) => rms.find((r) => r.id === v)?.name ?? "RM"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {rms.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
