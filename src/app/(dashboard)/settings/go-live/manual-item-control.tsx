"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { setGoLiveCheckAction } from "./actions";

export function ManualItemControl({ itemId, title, done, note, doneLabel }: { itemId: string; title: string; done: boolean; note: string; doneLabel: string | null }) {
  const [checked, setChecked] = useState(done);
  const [text, setText] = useState(note);
  const [pending, startTransition] = useTransition();

  function save(nextDone: boolean, nextNote: string) {
    startTransition(async () => {
      try {
        await setGoLiveCheckAction(itemId, nextDone, nextNote);
      } catch (error) {
        setChecked(done);
        toast.error(error instanceof Error ? error.message : "Couldn't save");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={checked}
          disabled={pending}
          aria-label={`Mark "${title}" as verified`}
          onChange={(e) => {
            setChecked(e.target.checked);
            save(e.target.checked, text);
          }}
        />
        <span className={checked ? "text-success" : "text-muted-foreground"}>{checked ? (doneLabel ?? "Verified") : "Not verified yet"}</span>
      </label>
      <Input
        value={text}
        maxLength={500}
        placeholder="Note (owner, date, accepted risk…)"
        className="h-8 text-xs"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== note && save(checked, text)}
      />
    </div>
  );
}
