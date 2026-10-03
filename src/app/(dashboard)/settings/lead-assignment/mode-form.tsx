"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ASSIGNMENT_MODE_LABELS } from "@/lib/assignment/modes";
import { updateAssignmentModeAction } from "./actions";

type Mode = keyof typeof ASSIGNMENT_MODE_LABELS;
const MODES = Object.keys(ASSIGNMENT_MODE_LABELS) as Mode[];

export function ModeForm({ current }: { current: Mode }) {
  const [selected, setSelected] = useState<Mode>(current);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      try {
        await updateAssignmentModeAction(selected);
        toast.success(`Lead assignment is now ${ASSIGNMENT_MODE_LABELS[selected].label.toLowerCase()}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't save");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" className="flex flex-col gap-2">
        {MODES.map((mode) => (
          <label
            key={mode}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
              selected === mode ? "border-primary bg-primary/5" : "hover:bg-muted/50"
            }`}
          >
            <input
              type="radio"
              name="assignment-mode"
              className="mt-1 accent-[var(--primary)]"
              checked={selected === mode}
              onChange={() => setSelected(mode)}
            />
            <span>
              <span className="block text-sm font-medium">
                {ASSIGNMENT_MODE_LABELS[mode].label}
                {mode === current && <span className="ml-2 text-xs font-normal text-muted-foreground">(current)</span>}
              </span>
              <span className="block text-sm text-muted-foreground">{ASSIGNMENT_MODE_LABELS[mode].description}</span>
            </span>
          </label>
        ))}
      </div>
      <Button onClick={save} disabled={pending || selected === current} className="w-fit">
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
