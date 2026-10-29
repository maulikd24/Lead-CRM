"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bookmark, BookmarkPlus, Check, Columns3, List, Rows3, Rows4, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DENSITY_COOKIE, SAVED_VIEW_NAME_MAX, canonicalViewQuery, clientsHref, type ClientView, type Density } from "@/lib/clients/views";
import { cn } from "@/lib/utils";

import { deleteClientViewAction, saveClientViewAction, type SavedViewRow } from "./view-actions";

/** A personal preference for a year; the server reads it so the list renders at the right density the first time. */
function writeDensityCookie(d: Density) {
  document.cookie = `${DENSITY_COOKIE}=${d}; path=/; max-age=31536000; samesite=lax`;
}

const BOARD_IGNORES = ["stage", "status", "sla", "archived"];

const SEG = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none";
const SEG_ON = "bg-background text-foreground shadow-sm";

/**
 * One toolbar for both views: List or Board (the same filters either way), the list's density, and the person's saved views. The
 * view is in the URL so it can be shared; density is a personal cookie; saved views are stored per person on the server.
 */
export function ViewsToolbar({ view, density, views }: { view: ClientView; density: Density; views: SavedViewRow[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [list, setList] = useState(views);
  const [pending, start] = useTransition();

  const current = canonicalViewQuery(search);
  const active = list.find((v) => v.query === current);
  const hrefFor = (v: ClientView) => {
    const usp = new URLSearchParams(search.toString());
    usp.delete("page");
    if (v === "list") usp.delete("view");
    else {
      usp.set("view", v);
      // The board's columns are its stages and statuses, and "At risk" is its quick filter: list-only filters would be dead chips.
      for (const k of BOARD_IGNORES) usp.delete(k);
    }
    return clientsHref(canonicalViewQuery(usp));
  };

  const setDensity = (d: Density) => {
    writeDensityCookie(d);
    router.refresh();
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await saveClientViewAction(name, current);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setList((l) => [...l.filter((v) => v.id !== r.view.id && v.name !== r.view.name), r.view].sort((a, b) => a.name.localeCompare(b.name)));
      setSaving(false);
      toast.success(`Saved view "${r.view.name}"`);
    });
  };

  const remove = (v: SavedViewRow) => {
    const before = list;
    setList((l) => l.filter((x) => x.id !== v.id));
    start(async () => {
      const r = await deleteClientViewAction(v.id);
      if (!r.ok) {
        setList(before);
        toast.error(r.error);
      } else toast.success(`Deleted view "${v.name}"`);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="View" className="inline-flex items-center rounded-lg bg-muted p-0.5">
        <Link href={hrefFor("list")} aria-current={view === "list" ? "page" : undefined} className={cn(SEG, view === "list" && SEG_ON)}>
          <List className="size-3.5" aria-hidden /> List
        </Link>
        <Link href={hrefFor("board")} aria-current={view === "board" ? "page" : undefined} className={cn(SEG, view === "board" && SEG_ON)}>
          <Columns3 className="size-3.5" aria-hidden /> Board
        </Link>
      </nav>

      {view === "list" && (
        <div role="radiogroup" aria-label="Row density" className="inline-flex items-center rounded-lg bg-muted p-0.5">
          {([["comfortable", Rows3, "Comfortable"], ["compact", Rows4, "Compact"]] as const).map(([d, Icon, label]) => (
            <button key={d} type="button" role="radio" aria-checked={density === d} title={label} onClick={() => density !== d && setDensity(d)} className={cn(SEG, "px-2", density === d && SEG_ON)}>
              <Icon className="size-3.5" aria-hidden />
              <span className="sr-only">{label}</span>
            </button>
          ))}
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="gap-1.5" />}>
          <Bookmark className="size-3.5" aria-hidden />
          <span className="max-w-40 truncate">{active ? active.name : "Views"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Saved views</DropdownMenuLabel>
            {list.length === 0 && <p className="px-1.5 py-1 text-xs text-muted-foreground">None yet. Set filters, then save them here.</p>}
            {list.map((v) => (
              <DropdownMenuItem key={v.id} onClick={() => router.push(clientsHref(v.query))} className="group/view justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  {v.id === active?.id ? <Check aria-hidden /> : <span className="size-4" aria-hidden />}
                  <span className="truncate">{v.name}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Delete view ${v.name}`}
                  onClick={(e) => { e.stopPropagation(); remove(v); }}
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/view:opacity-100 group-focus/view:opacity-100 hover:text-destructive focus-visible:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { setName(active?.name ?? ""); setSaving(true); }} className="gap-2">
            <BookmarkPlus aria-hidden /> {active ? "Update this view…" : "Save current view…"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className="max-w-sm">
          <form onSubmit={save} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Save this view</DialogTitle>
              <DialogDescription>Keeps the current filters and {view === "board" ? "the board" : "the list"} under a name, for you only.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="view-name">Name</Label>
              <Input id="view-name" autoFocus value={name} maxLength={SAVED_VIEW_NAME_MAX} placeholder="e.g. My hot leads" onChange={(e) => setName(e.target.value)} />
              <p className="text-xs text-muted-foreground">Saving under an existing name replaces it.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSaving(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || name.trim().length < 2}>Save view</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
