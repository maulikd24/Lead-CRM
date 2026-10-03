"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EVENT_TYPE_OPTIONS } from "@/lib/activity/query";

export function ActivityFilters({ users }: { users: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete("page"); // any filter change restarts pagination
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );
  const debouncedSearch = useDebouncedCallback((v: string) => setParam("q", v), 300);

  const hasFilters = ["user", "type", "from", "to", "q"].some((k) => searchParams.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={searchParams.get("user") ?? ""} onValueChange={(v) => setParam("user", v ?? "")}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="All users">{(v: string) => users.find((u) => u.id === v)?.name ?? "All users"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={searchParams.get("type") ?? ""} onValueChange={(v) => setParam("type", v ?? "")}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All events">{(v: string) => EVENT_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? "All events"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {EVENT_TYPE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input type="date" defaultValue={searchParams.get("from") ?? ""} onChange={(e) => setParam("from", e.target.value)} className="w-40" />
      <span className="text-sm text-muted-foreground">to</span>
      <Input type="date" defaultValue={searchParams.get("to") ?? ""} onChange={(e) => setParam("to", e.target.value)} className="w-40" />
      <Input
        placeholder="Search details, page, email…"
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(e) => debouncedSearch(e.target.value)}
        className="w-60"
      />
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => startTransition(() => router.push(pathname))}>
          Clear
        </Button>
      )}
    </div>
  );
}
