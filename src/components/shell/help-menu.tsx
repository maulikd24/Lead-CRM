"use client";

import { useRouter } from "next/navigation";
import { BookOpen, CircleHelp, FileText, History, Keyboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Role } from "@/generated/prisma/client";
import { can } from "@/lib/access/policy";
import { dispatchShell } from "@/lib/shortcuts/events";

import { Kbd } from "./kbd";

/** Help and reference, out of the sidebar and one click away in the header. */
export function HelpMenu({ role }: { role: Role }) {
  const router = useRouter();
  const links = [
    { href: "/help", label: "Help", icon: CircleHelp },
    { href: "/handbook", label: "Handbook", icon: BookOpen },
    { href: "/release-notes", label: "What's new", icon: History },
    ...(can(role, "feature-specs") ? [{ href: "/feature-specs", label: "Feature specs", icon: FileText }] : []),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" title="Help">
            <CircleHelp className="size-4" />
            <span className="sr-only">Help and keyboard shortcuts</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          {links.map((l) => (
            <DropdownMenuItem key={l.href} onClick={() => router.push(l.href)} className="gap-2 py-1.5">
              <l.icon aria-hidden /> {l.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => dispatchShell({ type: "shortcuts" })} className="gap-2 py-1.5">
          <Keyboard aria-hidden /> Keyboard shortcuts <Kbd className="ml-auto">?</Kbd>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
