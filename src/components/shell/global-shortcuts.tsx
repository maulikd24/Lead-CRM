"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Role } from "@/generated/prisma/client";
import { createActionsFor } from "@/lib/palette/commands";
import { dispatchShell, onShell } from "@/lib/shortcuts/events";
import { shortcutsFor, type Shortcut } from "@/lib/shortcuts/registry";
import { IDLE, isTypingTarget, step } from "@/lib/shortcuts/sequence";

import { Keys } from "./kbd";

const GROUPS: Shortcut["group"][] = ["General", "Create", "Go to"];
const OPEN_POPUP = ["dialog", "menu", "alertdialog"].map((r) => `[role="${r}"]:not([data-closed])`).join(", ");

/**
 * The one global keydown listener (mounted once in the dashboard layout). Single keys and G-sequences from src/lib/shortcuts; nothing
 * fires while typing, while a dialog or menu is open, or with a modifier held, so Cmd+K and the browser's own keys are untouched.
 */
export function GlobalShortcuts({ role, flags }: { role: Role; flags: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const shortcuts = useMemo(() => shortcutsFor(role, flags, createActionsFor(role, flags).length > 0), [role, flags]);
  const state = useRef(IDLE);

  useEffect(() => onShell((c) => { if (c.type === "shortcuts") setOpen(true); }), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat || isTypingTarget(e.target as HTMLElement | null)) return;
      // A dialog, sheet or menu owns the keyboard while it is open. One that is animating out stays in the DOM marked data-closed: not open.
      if (document.querySelector(OPEN_POPUP)) return;
      const r = step(state.current, e, e.timeStamp);
      state.current = r.state;
      const hit = r.match ? shortcuts.find((s) => s.match === r.match) : undefined;
      if (!hit) return;
      e.preventDefault();
      if (hit.kind === "go") router.push(hit.href);
      else if (hit.command === "shortcuts") setOpen(true);
      else if (hit.command === "palette") dispatchShell({ type: "palette" });
      else dispatchShell({ type: "new-menu" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, shortcuts]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press G, then a letter, to jump. Shortcuts are off while you type.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {[...GROUPS.map((g) => ({ g, list: shortcuts.filter((s) => s.group === g) })), { g: "Palette" as const, list: null }].map(({ g, list }) =>
            list === null ? (
              <section key={g} aria-label={g}>
                <h3 className="mb-1.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Search</h3>
                <ShortcutRow label="Open search and commands" keys={["⌘", "K"]} />
              </section>
            ) : list.length > 0 ? (
              <section key={g} aria-label={g}>
                <h3 className="mb-1.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{g}</h3>
                {list.map((s) => <ShortcutRow key={s.id} label={s.label} keys={s.keys} />)}
              </section>
            ) : null,
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: readonly string[] }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-sm">
      <span>{label}</span>
      <Keys keys={keys} />
    </div>
  );
}
