import type { LucideIcon } from "lucide-react";
import { ListPlus, PhoneCall, Settings, SunMoon, UserPlus } from "lucide-react";

import { can, type Area } from "@/lib/access/policy";
import { SPACES } from "@/lib/nav-items";
import { navEntriesFor, railFor, spaceHome } from "@/lib/nav/model";
import type { Role } from "@/generated/prisma/client";

/** What running a command does. The palette interprets it; nothing here touches data. */
export type CommandEffect = { type: "mode"; mode: "task" | "call" } | { type: "go"; href: string } | { type: "theme" };

export type PaletteCommand = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The registry area and action the command needs. Absent only for commands that touch nothing (theme). */
  area?: Area;
  effect: CommandEffect;
};

/**
 * The Cmd+K commands a role may run, from the central policy registry: create task and log call need manage on tasks/calls AND the right
 * to open customers (their forms pick a customer); new client needs manage on clients; "open <workspace>" exists only for a workspace
 * the role has pages in (the rail's own list). A command a role cannot run is not offered, so it cannot be run from the palette either.
 */
export function commandsFor(role: Role, enabledFlags: readonly string[]): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const customersOk = can(role, "clients", "view");
  if (can(role, "tasks", "manage") && customersOk) out.push({ id: "create-task", label: "Add task", icon: ListPlus, area: "tasks", effect: { type: "mode", mode: "task" } });
  if (can(role, "calls", "manage") && customersOk) out.push({ id: "log-call", label: "Log call", icon: PhoneCall, area: "calls", effect: { type: "mode", mode: "call" } });
  if (can(role, "clients", "manage")) out.push({ id: "new-client", label: "New client", icon: UserPlus, area: "clients", effect: { type: "go", href: "/clients?new=1" } });

  const entries = navEntriesFor(role, enabledFlags);
  for (const r of railFor(entries)) {
    const href = spaceHome(entries, r.space);
    if (href) out.push({ id: `open-${r.space}`, label: `Open ${SPACES[r.space].label}`, icon: SPACES[r.space].icon, effect: { type: "go", href } });
  }
  out.push({ id: "toggle-theme", label: "Toggle theme", icon: SunMoon, effect: { type: "theme" } });
  out.push({ id: "settings", label: "Go to Settings", icon: Settings, area: "account", effect: { type: "go", href: "/settings/account" } });
  return out;
}
