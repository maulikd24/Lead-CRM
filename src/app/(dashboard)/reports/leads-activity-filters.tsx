"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const GRANULARITY_OPTIONS = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly" },
  { value: "year", label: "Yearly" },
  { value: "custom", label: "Custom range" },
];

export function LeadsActivityFilters() {
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

  const granularity = searchParams.get("laGranularity") || "month";
  const isCustom = granularity === "custom";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={granularity} onValueChange={(v) => v && setParam("laGranularity", v)}>
        <SelectTrigger className="w-44">
          <SelectValue>{(v: string) => GRANULARITY_OPTIONS.find((o) => o.value === v)?.label ?? v}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {GRANULARITY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isCustom && (
        <>
          <Input
            type="date"
            defaultValue={searchParams.get("laFrom") ?? ""}
            onChange={(e) => setParam("laFrom", e.target.value)}
            className="w-40"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            defaultValue={searchParams.get("laTo") ?? ""}
            onChange={(e) => setParam("laTo", e.target.value)}
            className="w-40"
          />
        </>
      )}
    </div>
  );
}
