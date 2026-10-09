"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Search, Users, SunMoon, UserPlus, Settings as SettingsIcon, Sparkles, LineChart } from "lucide-react";

import { Dialog, DialogPortal, DialogOverlay, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NAV_ITEMS } from "@/lib/nav-items";
import { searchClientsForPalette, type PaletteClientResult } from "@/app/(dashboard)/command-search-actions";
import { askSystemAction, type AskResponse } from "@/app/(dashboard)/intelligence/actions";
import { isAskIntent } from "@/lib/palette/ask-intent";
import { canAsk } from "@/lib/palette/ask-roles";
import { matchesPaletteQuery, orderPaletteItems } from "@/lib/palette/order-items";
import type { Role } from "@/generated/prisma/client";

type PaletteItem =
  | { kind: "nav"; key: string; label: string; icon: typeof Search; onSelect: () => void }
  | { kind: "client"; key: string; label: string; sublabel: string; onSelect: () => void }
  | { kind: "action"; key: string; label: string; icon: typeof Search; onSelect: () => void };

type AskState = { requestId: number; asking: boolean; answer: AskResponse | null };
const IDLE_ASK: AskState = { requestId: 0, asking: false, answer: null };
let nextAskId = 0;
let pendingAskId = 0; // id of the request in flight, 0 when none

function resetAsk(set: (s: AskState) => void) {
  pendingAskId = 0;
  set(IDLE_ASK);
}

export function CommandPalette({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<PaletteClientResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [askState, setAskState] = useState<AskState>(IDLE_ASK);
  const { answer, asking } = askState;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { setTheme, theme } = useTheme();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setClients([]);
      setSelectedIndex(0);
      resetAsk(setAskState);
    }
  }, [open]);

  const ask = useCallback(async (question: string) => {
    if (pendingAskId !== 0) return; // a request is already in flight
    const requestId = ++nextAskId;
    pendingAskId = requestId;
    setAskState({ requestId, asking: true, answer: null });
    let result: AskResponse;
    try {
      result = await askSystemAction(question);
    } catch {
      result = { ok: false, error: "Couldn't answer that right now." };
    }
    if (pendingAskId === requestId) pendingAskId = 0;
    // Only the latest request may land; a newer ask, a query change or closing the palette supersedes it.
    setAskState((cur) => (cur.requestId === requestId ? { requestId, asking: false, answer: result } : cur));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setClients([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const results = await searchClientsForPalette(query);
      setClients(results);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const items = useMemo<PaletteItem[]>(() => {
    const navItems: PaletteItem[] = NAV_ITEMS.filter((item) => item.roles.includes(role) && matchesPaletteQuery(item.label, query)).map((item) => ({
      kind: "nav",
      key: item.href,
      label: item.label,
      icon: item.icon,
      onSelect: () => go(item.href),
    }));

    const clientItems: PaletteItem[] = clients.map((c) => ({
      kind: "client",
      key: c.id,
      label: c.name,
      sublabel: c.matchedHolder
        ? `${c.matchedHolder.name}${c.matchedHolder.position ? ` (${c.matchedHolder.position.toLowerCase()} holder)` : ""} · ${c.clientCode}`
        : `${c.clientCode} · ${c.mobile ?? "no phone"}`,
      onSelect: () => go(`/clients/${c.id}`),
    }));

    const actionItems: PaletteItem[] = [
      { kind: "action", key: "new-client", label: "New Client", icon: UserPlus, onSelect: () => go("/clients") },
      {
        kind: "action",
        key: "toggle-theme",
        label: "Toggle theme",
        icon: SunMoon,
        onSelect: () => {
          setTheme(theme === "dark" ? "light" : "dark");
          setOpen(false);
        },
      },
      { kind: "action", key: "settings", label: "Go to Settings", icon: SettingsIcon, onSelect: () => go("/settings/account") },
      ...(process.env.NEXT_PUBLIC_INSIGHTS === "1" && (role === "ADMIN" || role === "MANAGER")
        ? [{ kind: "action" as const, key: "agent-insights", label: "Agent insights", icon: LineChart, onSelect: () => go("/agents/insights") }]
        : []),
    ];

    const askItems: PaletteItem[] = isAskIntent(query) && canAsk(role)
      ? [{ kind: "action", key: "ask-system", label: `Ask: ${query.trim()}`, icon: Sparkles, onSelect: () => void ask(query.trim()) }]
      : [];

    return orderPaletteItems({ clients: query.trim().length >= 2 ? clientItems : [], nav: navItems, ask: askItems, actions: actionItems });
  }, [clients, query, role, go, setTheme, theme, ask]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[selectedIndex]?.onSelect();
    }
  }

  const grouped = {
    ask: items.filter((i) => i.key === "ask-system"),
    client: items.filter((i) => i.kind === "client"),
    nav: items.filter((i) => i.kind === "nav"),
    action: items.filter((i) => i.kind === "action" && i.key !== "ask-system"),
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-64 items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search clients, pages...</span>
        <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay />
          <DialogContent
            showCloseButton={false}
            className="top-[15%] max-w-lg translate-y-0 gap-0 p-0"
          >
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  resetAsk(setAskState);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search clients, pages, actions..."
                className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {grouped.client.length > 0 && (
                <PaletteGroup label="Clients" items={grouped.client} items_all={items} selectedIndex={selectedIndex} />
              )}
              {grouped.nav.length > 0 && (
                <PaletteGroup label="Pages" items={grouped.nav} items_all={items} selectedIndex={selectedIndex} />
              )}
              {grouped.ask.length > 0 && (
                <PaletteGroup label="Ask" items={grouped.ask} items_all={items} selectedIndex={selectedIndex} />
              )}
              {grouped.action.length > 0 && (
                <PaletteGroup label="Actions" items={grouped.action} items_all={items} selectedIndex={selectedIndex} />
              )}
              {items.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No results.</p>}
            </div>
            <div role="status" aria-live="polite" className="border-t px-4 py-3 text-sm empty:hidden">
              {asking && <p className="text-muted-foreground">Thinking…</p>}
              {!asking && answer && !answer.ok && <p className="text-destructive">{answer.error}</p>}
              {!asking && answer?.ok && (
                <div className="space-y-2">
                  <p className="whitespace-pre-wrap">{answer.answer}</p>
                  {answer.customers.length > 0 && (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1">
                      {answer.customers.slice(0, 5).map((c) => (
                        <li key={c.id}>
                          <a href={`/clients/${c.id}`} onClick={(e) => { e.preventDefault(); go(`/clients/${c.id}`); }} className="text-primary underline-offset-2 hover:underline">
                            {c.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  );
}

function PaletteGroup({
  label,
  items,
  items_all,
  selectedIndex,
}: {
  label: string;
  items: PaletteItem[];
  items_all: PaletteItem[];
  selectedIndex: number;
}) {
  return (
    <div className="mb-1">
      <p className="px-2 py-1 text-xs text-muted-foreground">{label}</p>
      {items.map((item) => {
        const globalIndex = items_all.indexOf(item);
        const isSelected = globalIndex === selectedIndex;
        return (
          <button
            key={item.key}
            type="button"
            onClick={item.onSelect}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
              isSelected ? "bg-muted" : "hover:bg-muted"
            }`}
          >
            {item.kind === "client" ? (
              <Users className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <item.icon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.kind === "client" && <span className="text-xs text-muted-foreground">{item.sublabel}</span>}
          </button>
        );
      })}
    </div>
  );
}
