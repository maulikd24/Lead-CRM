"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Sheet } from "@/components/workspace";

/**
 * An editor in a sheet: a full-height bottom sheet on a phone, a side drawer from 1024px. The server renders it only while the URL says an editor is open
 * (`?edit=` or `?new=1`), so it is open whenever it exists; closing goes to `closeHref`. Real dialog semantics come from <Sheet> (focus trapped and returned, Esc closes).
 */
export function EditSheet({ name, title, description, closeHref, children }: { name: string; title: string; description?: string; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open name={name} title={title} description={description} onClose={() => router.push(closeHref, { scroll: false })}>
      {children}
    </Sheet>
  );
}
