"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

export function SegmentedControl({ options }: { options: { label: string; value: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const current = searchParams.get("range") ?? options[0]?.value;

  function setRange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", value);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="hidden items-center gap-1 rounded-md border border-border p-0.5 md:flex">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setRange(option.value)}
          className={cn(
            "rounded px-3 py-1.5 text-xs font-semibold transition-colors",
            current === option.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
