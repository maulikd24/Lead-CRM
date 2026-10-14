"use client";

import { useState, useTransition } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { revealClientContactAction } from "./contact-actions";

/**
 * The PAN in the edit dialog. The page sends only the masked form. Admin or the assigned RM can reveal it (the server logs that),
 * and only then does the field become editable and submit a value; everyone else sees the masked PAN and cannot change it.
 */
export function PanField({ clientId, masked, canReveal }: { clientId: string; masked: string | null; canReveal: boolean }) {
  const [raw, setRaw] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (raw === null) {
    const reveal = () =>
      start(async () => {
        try {
          setRaw((await revealClientContactAction(clientId, "pan")).value ?? "");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not reveal this value");
        }
      });
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>{masked ?? "Not set"}</span>
        {canReveal && (
          <Button type="button" variant="ghost" size="xs" disabled={pending} aria-label="Show PAN to edit it (this is logged)" onClick={reveal}>
            <Eye aria-hidden /> Show to edit
          </Button>
        )}
      </div>
    );
  }
  return (
    <Input id="edit-pan" name="pan" maxLength={10} placeholder="ABCDE1234F" className="uppercase" defaultValue={raw} onChange={(e) => { e.target.value = e.target.value.toUpperCase(); }} />
  );
}
