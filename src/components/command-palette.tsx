"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { CornerDownLeft, History, ListPlus, PhoneCall, Search, SunMoon, UserPlus, Settings as SettingsIcon, Sparkles, LineChart } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogPortal, DialogOverlay, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MorphHeight } from "@/components/command-bar/morph-height";
import { QuickActionForm } from "@/components/command-bar/quick-forms";
import { SPACES, visibleNavItems } from "@/lib/nav-items";
import { initials } from "@/lib/utils";
import { parseRecent, pushRecent, recentStorageKey, type RecentEntry } from "@/lib/wow/recent";
import { searchClientsForPalette, type PaletteClientResult } from "@/app/(dashboard)/command-search-actions";
import { askSystemAction, type AskResponse } from "@/app/(dashboard)/intelligence/actions";
import { isAskIntent } from "@/lib/palette/ask-intent";
import { canAsk } from "@/lib/palette/ask-roles";
import { can } from "@/lib/access/policy";
import { matchesPaletteQuery, orderPaletteItems } from "@/lib/palette/order-items";
import type { Role } from "@/generated/prisma/client";

type PaletteItem =
  | { kind: "nav"; key: string; label: string; sublabel?: string; icon: typeof Search; onSelect: () => void }
  | { kind: "client"; key: string; label: string; sublabel: string; onSelect: () => void }
  | { kind: "recent"; key: string; label: string; sublabel?: string; icon: typeof Search | null; onSelect: () => void }
  | { kind: "action"; key: string; label: string; icon: typeof Search; onSelect: () => void };

// Recent items live in this browser only, per person. A tiny external store so React re-renders when they change.
const recentListeners = new Set<() => void>();
function subscribeRecent(cb: () => void) {
  recentListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { recentListeners.delete(cb); window.removeEventListener("storage", cb); };
}
const readRecentRaw = (key: string) => { try { return window.localStorage.getItem(key) ?? ""; } catch { return ""; } };
function writeRecent(key: string, list: RecentEntry[]) {
  try { window.localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage unavailable: recents are a convenience only */ }
  recentListeners.forEach((cb) => cb());
}

type AskState = { requestId: number; asking: boolean; answer: AskResponse | null };
const IDLE_ASK: AskState = { requestId: 0, asking: false, answer: null };
let nextAskId = 0;
let pendingAskId = 0; // id of the request in flight, 0 when none

function resetAsk(set: (s: AskState) => void) {
  pendingAskId = 0;
  set(IDLE_ASK);
}

const NO_FLAGS: string[] = [];

export function CommandPalette({ role, flags = NO_FLAGS, userId = "anon" }: { role: Role; flags?: string[]; userId?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<PaletteClientResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // The bar morphs from search into a short form for a quick action; "search" is the normal state.
  const [mode, setMode] = useState<"search" | "task" | "call">("search");
  const [askState, setAskState] = useState<AskState>(IDLE_ASK);
  const { answer, asking } = askState;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const storageKey = recentStorageKey(userId);
  const recentRaw = useSyncExternalStore(subscribeRecent, () => readRecentRaw(storageKey), () => "");
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);
  const remember = useCallback((entry: RecentEntry) => writeRecent(storageKey, pushRecent(parseRecent(readRecentRaw(storageKey)), entry)), [storageKey]);

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
      setMode("search");
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
    // Customer search is for roles that may open customers; others never call it (the server refuses them anyway).
    if (query.trim().length < 2 || !can(role, "clients")) {
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
  }, [query, role]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const items = useMemo<PaletteItem[]>(() => {
    const navItems: PaletteItem[] = visibleNavItems(role, flags).filter((item) => matchesPaletteQuery(item.label, query)).map((item) => ({
      kind: "nav",
      key: item.href,
      label: item.label,
      sublabel: SPACES[item.roleSpace?.[role] ?? item.space].label,
      icon: item.icon,
      onSelect: () => { remember({ kind: "nav", key: item.href, label: item.label, href: item.href }); go(item.href); },
    }));

    const clientItems: PaletteItem[] = clients.map((c) => ({
      kind: "client",
      key: c.id,
      label: c.name,
      sublabel: c.matchedHolder
        ? `${c.matchedHolder.name}${c.matchedHolder.position ? ` (${c.matchedHolder.position.toLowerCase()} holder)` : ""} · ${c.clientCode}`
        : `${c.clientCode} · ${c.mobile ?? "no phone"}`,
      onSelect: () => { remember({ kind: "client", key: c.id, label: c.name, sublabel: `${c.clientCode}`, href: `/clients/${c.id}` }); go(`/clients/${c.id}`); },
    }));

    const actionItems: PaletteItem[] = [
      ...(role === "ADMIN" || role === "MANAGER" || role === "RM"
        ? [
            { kind: "action" as const, key: "quick-task", label: "Add task", icon: ListPlus, onSelect: () => setMode("task") },
            { kind: "action" as const, key: "quick-call", label: "Log call", icon: PhoneCall, onSelect: () => setMode("call") },
          ]
        : []),
      { kind: "action", key: "new-client", label: "New client", icon: UserPlus, onSelect: () => go("/clients?new=1") },
      {
        kind: "action",
        key: "toggle-theme",
        label: "Toggle theme",
        icon: SunMoon,
        onSelect: () => {
          const next = theme === "dark" ? "light" : "dark";
          setTheme(next);
          setOpen(false);
          toast.success(`Switched to the ${next} theme`);
        },
      },
      { kind: "action", key: "settings", label: "Go to Settings", icon: SettingsIcon, onSelect: () => go("/settings/account") },
      ...(process.env.NEXT_PUBLIC_INSIGHTS === "1" && can(role, "agent-insights")
        ? [{ kind: "action" as const, key: "agent-insights", label: "Agent insights", icon: LineChart, onSelect: () => go("/agents/insights") }]
        : []),
    ];

    const askItems: PaletteItem[] = isAskIntent(query) && canAsk(role)
      ? [{ kind: "action", key: "ask-system", label: `Ask: ${query.trim()}`, icon: Sparkles, onSelect: () => void ask(query.trim()) }]
      : [];

    const allowedHrefs = new Set(navItems.map((n) => n.key));
    const recentItems: PaletteItem[] = query.trim() === ""
      ? recent.filter((r) => r.kind === "client" || allowedHrefs.has(r.key)).map((r) => ({
          kind: "recent" as const,
          key: `recent:${r.kind}:${r.key}`,
          label: r.label,
          sublabel: r.sublabel,
          icon: r.kind === "nav" ? (navItems.find((n) => n.key === r.key) as Extract<PaletteItem, { kind: "nav" }> | undefined)?.icon ?? History : null,
          onSelect: () => { remember(r); go(r.href); },
        }))
      : [];
    return orderPaletteItems({ recent: recentItems, clients: query.trim().length >= 2 ? clientItems : [], nav: navItems, ask: askItems, actions: actionItems });
  }, [clients, query, role, flags, go, setTheme, theme, ask, recent, remember]);

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
    recent: items.filter((i) => i.kind === "recent"),
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
        aria-label="Search clients, pages and actions (Command K)"
        className="group/search flex h-10 w-full min-w-0 max-w-md items-center gap-2.5 rounded-xl border border-input bg-muted/40 px-3 text-sm text-muted-foreground transition-[background-color,border-color,box-shadow] duration-200 ease-out hover:border-primary/50 hover:bg-muted/70 hover:text-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none"
      >
        <Search className="size-4 shrink-0 transition-colors group-hover/search:text-[var(--primary-ink)]" aria-hidden />
        <span className="flex-1 truncate text-left">Search clients, pages, actions…</span>
        <kbd className="hidden shrink-0 items-center gap-0.5 rounded-md border border-border bg-background px-1.5 py-0.5 font-sans text-xs font-medium text-foreground/80 sm:inline-flex">⌘K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay />
          <DialogContent
            showCloseButton={false}
            aria-label="Command palette"
            className="top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-2xl p-0"
          >
            <MorphHeight contentKey={mode}>
              {mode !== "search" ? (
                <QuickActionForm kind={mode} userId={userId} onBack={() => setMode("search")} onDone={() => setOpen(false)} />
              ) : (
                <>
            <div className="flex items-center gap-2.5 border-b px-4">
              <Search className="size-4 text-muted-foreground" aria-hidden />
              <Input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  resetAsk(setAskState);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search clients, pages, actions…" aria-label="Search"
                className="h-12 border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="max-h-[22rem] overflow-y-auto p-2">
              {grouped.recent.length > 0 && (
                <PaletteGroup label="Recent" items={grouped.recent} items_all={items} selectedIndex={selectedIndex} onHover={setSelectedIndex} />
              )}
              {grouped.client.length > 0 && (
                <PaletteGroup label="Clients" items={grouped.client} items_all={items} selectedIndex={selectedIndex} onHover={setSelectedIndex} />
              )}
              {grouped.nav.length > 0 && (
                <PaletteGroup label="Pages" items={grouped.nav} items_all={items} selectedIndex={selectedIndex} onHover={setSelectedIndex} />
              )}
              {grouped.ask.length > 0 && (
                <PaletteGroup label="Ask" items={grouped.ask} items_all={items} selectedIndex={selectedIndex} onHover={setSelectedIndex} />
              )}
              {grouped.action.length > 0 && (
                <PaletteGroup label="Actions" items={grouped.action} items_all={items} selectedIndex={selectedIndex} onHover={setSelectedIndex} />
              )}
              {items.length === 0 && <p className="px-2 py-8 text-center text-sm text-muted-foreground">Nothing matches &ldquo;{query.trim()}&rdquo;. Try a client name, a page or an action.</p>}
            </div>
            <div aria-hidden className="flex items-center gap-4 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><kbd className="rounded border border-border bg-background px-1 font-sans">↑</kbd><kbd className="rounded border border-border bg-background px-1 font-sans">↓</kbd> move</span>
              <span className="inline-flex items-center gap-1.5"><kbd className="rounded border border-border bg-background px-1 font-sans"><CornerDownLeft className="inline size-3" /></kbd> open</span>
              <span className="inline-flex items-center gap-1.5"><kbd className="rounded border border-border bg-background px-1 font-sans">esc</kbd> close</span>
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
                </>
              )}
            </MorphHeight>
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
  onHover,
}: {
  label: string;
  items: PaletteItem[];
  items_all: PaletteItem[];
  selectedIndex: number;
  onHover: (index: number) => void;
}) {
  return (
    <div className="mb-1.5" role="group" aria-label={label}>
      <p className="px-2.5 pt-1.5 pb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      {items.map((item) => {
        const globalIndex = items_all.indexOf(item);
        const isSelected = globalIndex === selectedIndex;
        const Icon = item.kind === "client" || (item.kind === "recent" && !item.icon) ? null : (item as { icon: typeof Search }).icon;
        return (
          <button
            key={item.key}
            type="button"
            onClick={item.onSelect}
            onMouseMove={() => !isSelected && onHover(globalIndex)}
            ref={(el) => { if (el && isSelected) el.scrollIntoView({ block: "nearest" }); }}
            aria-current={isSelected ? "true" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors duration-150 motion-reduce:transition-none ${isSelected ? "bg-muted" : ""}`}
          >
            <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${isSelected ? "bg-primary/20" : "bg-muted"}`} style={isSelected ? { color: "var(--primary-ink)" } : undefined} aria-hidden>
              {Icon ? <Icon className="size-3.5" /> : initials(item.label)}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {"sublabel" in item && item.sublabel && <span className="shrink-0 text-xs text-muted-foreground">{item.sublabel}</span>}
            {isSelected && <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
          </button>
        );
      })}
    </div>
  );
}
