"use client";

import { useState, useTransition } from "react";
import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { revealPartnerFieldAction } from "./actions";

export function RevealField({ profileId, field, hasValue }: { profileId: string; field: "panNumber" | "gstin"; hasValue: boolean }) {
  const [value, setValue] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!hasValue) return <p>—</p>;

  if (value !== null) return <p className="font-mono">{value}</p>;

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-auto gap-1 px-1 py-0.5 text-xs"
      disabled={pending}
      onClick={() => startTransition(async () => setValue(await revealPartnerFieldAction(profileId, field)))}
    >
      <Eye className="size-3" /> Reveal
    </Button>
  );
}
