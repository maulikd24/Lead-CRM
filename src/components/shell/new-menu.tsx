"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Role } from "@/generated/prisma/client";
import { createActionsFor, type PaletteCommand } from "@/lib/palette/commands";
import { dispatchShell, onShell } from "@/lib/shortcuts/events";

import { Kbd } from "./kbd";

/**
 * The global action hub: everything this role can create, from one button in every page's header (and the C key). The list is the
 * palette's own create actions, so the menu and Cmd+K never disagree. Quick forms (task, call) open in the palette.
 */
export function NewMenu({ role, flags }: { role: Role; flags: string[] }) {
  const actions = useMemo(() => createActionsFor(role, flags), [role, flags]);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => onShell((c) => { if (c.type === "new-menu") setOpen(true); }), []);

  if (actions.length === 0) return null;

  const run = (a: PaletteCommand) => {
    setOpen(false);
    if (a.effect.type === "mode") dispatchShell({ type: "palette", mode: a.effect.mode });
    else if (a.effect.type === "go") router.push(a.effect.href);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button size="sm" aria-label="Create new (C)" title="Create new (C)">
            <Plus aria-hidden /> <span className="max-sm:sr-only">New</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            Create <Kbd>C</Kbd>
          </DropdownMenuLabel>
          {actions.map((a) => (
            <DropdownMenuItem key={a.id} onClick={() => run(a)} className="gap-2 py-1.5">
              <a.icon aria-hidden /> {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
