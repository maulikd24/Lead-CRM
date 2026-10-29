import type { Role } from "@/generated/prisma/client";
import { navEntriesFor, spaceHome } from "@/lib/nav/model";

/**
 * The global keyboard shortcuts: what the overlay lists and what the listener runs. "Go to" shortcuts are offered only for pages the
 * role can open (the sidebar's own entries), so a shortcut can never reach further than a click could.
 */
export type Shortcut = {
  id: string;
  /** What the sequence matcher emits (src/lib/shortcuts/sequence.ts). */
  match: string;
  /** Keys as shown, one chip each. */
  keys: string[];
  label: string;
  group: "General" | "Create" | "Go to";
} & ({ kind: "go"; href: string } | { kind: "shell"; command: "palette" | "new-menu" | "shortcuts" });

const GO: { key: string; label: string; target: string | { space: "today" | "insights" } }[] = [
  { key: "h", label: "Today", target: { space: "today" } },
  { key: "c", label: "Clients", target: "/clients" },
  { key: "p", label: "Pipeline", target: "/pipeline" },
  { key: "i", label: "Inbox", target: "/inbox" },
  { key: "m", label: "Marketing", target: "/marketing" },
  { key: "b", label: "Broadcasts", target: "/marketing/studio" },
  { key: "t", label: "Team", target: { space: "insights" } },
  { key: "s", label: "Settings", target: "/settings/account" },
];

export function shortcutsFor(role: Role, enabledFlags: readonly string[], hasCreateActions: boolean): Shortcut[] {
  const entries = navEntriesFor(role, enabledFlags).filter((e) => e.state !== "off");
  const allowed = new Set(entries.map((e) => e.href));
  const out: Shortcut[] = [
    { id: "palette", match: "/", keys: ["/"], label: "Search and commands", group: "General", kind: "shell", command: "palette" },
    { id: "shortcuts", match: "?", keys: ["?"], label: "Show keyboard shortcuts", group: "General", kind: "shell", command: "shortcuts" },
  ];
  if (hasCreateActions) out.push({ id: "new", match: "c", keys: ["C"], label: "Create something new", group: "Create", kind: "shell", command: "new-menu" });
  for (const g of GO) {
    const href = typeof g.target === "string" ? (allowed.has(g.target) ? g.target : null) : spaceHome(entries, g.target.space);
    if (href) out.push({ id: `go-${g.key}`, match: `g ${g.key}`, keys: ["G", g.key.toUpperCase()], label: g.label, group: "Go to", kind: "go", href });
  }
  return out;
}
