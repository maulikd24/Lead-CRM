"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SegmentedToggle } from "@/components/wow/segmented-toggle";

/** The range picker (Today, Week, Quarter): the shared sliding toggle, with the choice kept in the URL as ?range=. */
export function SegmentedControl({ options, fallback = "week" }: { options: { label: string; value: string }[]; fallback?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const raw = searchParams.get("range");
  const current = options.some((o) => o.value === raw) ? raw! : fallback;

  function setRange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", value);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return <SegmentedToggle label="Pipeline period" options={options.map((o) => ({ key: o.value, label: o.label }))} value={current} onChange={setRange} />;
}
