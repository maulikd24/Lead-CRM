"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setRmTargetAction } from "./actions";

/** One RM's target for the quarter: type an amount in rupees and save. Blank removes it. */
export function TargetInput({ rmId, rmName, quarterKey, current }: { rmId: string; rmName: string; quarterKey: string; current: number }) {
  const [value, setValue] = useState(current > 0 ? String(current) : "");
  const [saved, setSaved] = useState(current > 0 ? String(current) : "");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    try {
      const result = await setRmTargetAction({ rmId, quarterKey, amount: value });
      if (result.ok) {
        setSaved(value);
        toast.success(value.trim() ? `Target saved for ${rmName}` : `Target removed for ${rmName}`);
      } else {
        toast.error(result.reason);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="flex items-center justify-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="No target"
        aria-label={`Funded-amount target for ${rmName}, in rupees`}
        className="h-8 w-36 text-right tabular-nums"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending || value === saved}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
