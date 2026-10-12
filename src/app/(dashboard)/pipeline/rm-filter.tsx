"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all__";

/** Narrows the board to one RM's clients (Managers and Admins). */
export function RmFilter({ rms, value }: { rms: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function onChange(next: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (next && next !== ALL) params.set("rm", next);
    else params.delete("rm");
    startTransition(() => router.push(params.size ? `${pathname}?${params.toString()}` : pathname));
  }

  return (
    <Select value={value || ALL} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-48 text-xs" aria-label="Relationship manager">
        <SelectValue>{(v: string) => (v === ALL ? "All RMs" : (rms.find((r) => r.id === v)?.name ?? "All RMs"))}</SelectValue>
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
  );
}
