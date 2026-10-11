import Link from "next/link";

import { requireAccess } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { enabledNavFlags } from "@/lib/nav-flags";
import { allModules, navEntriesFor } from "@/lib/nav/model";
import { navSetupNeeded } from "@/lib/nav/setup";
import { NAV_DESCRIPTIONS } from "@/lib/nav-descriptions";
import { SPACES } from "@/lib/nav-items";
import { cn } from "@/lib/utils";

export const metadata = { title: "All modules" };
export const dynamic = "force-dynamic";

const STATE_LABEL = { active: "Active", off: "Off", setup: "Needs setup" } as const;

export default async function AllModulesPage() {
  const session = await requireAccess("modules");
  const flags = enabledNavFlags();
  const spaces = allModules(navEntriesFor(session.user.role, flags, { setupNeeded: navSetupNeeded(flags) }));
  const total = spaces.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.entries.length, 0), 0);
  const counts = { active: 0, off: 0, setup: 0 };
  for (const s of spaces) for (const g of s.groups) for (const e of g.entries) counts[e.state] += 1;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="All modules" description={`${total} modules: ${counts.active} active, ${counts.setup} need setup, ${counts.off} off. Off modules are switched on with a feature flag.`} />
      {spaces.map((s) => {
        const sp = SPACES[s.space];
        return (
          <section key={s.space} aria-labelledby={`mod-${s.space}`} className="flex flex-col gap-3">
            <h2 id={`mod-${s.space}`} className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight">
              <sp.icon aria-hidden className="size-4.5" />
              {s.label}
              <span className="text-sm font-normal text-muted-foreground">{sp.blurb}</span>
            </h2>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
              {s.groups.flatMap((g) =>
                g.entries.map((e) => {
                  const row = (
                    <>
                      <e.icon aria-hidden className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{e.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{g.group}{NAV_DESCRIPTIONS[e.href] ? ` · ${NAV_DESCRIPTIONS[e.href]}` : ""}</span>
                      </span>
                      <span data-state={e.state} className={cn("shrink-0 rounded-full border px-2 text-xs leading-5", e.state === "active" ? "border-border text-muted-foreground" : "border-amber-600/50 text-amber-800 dark:text-amber-300")}>{STATE_LABEL[e.state]}</span>
                    </>
                  );
                  return e.state === "off" ? (
                    <div key={e.href} aria-disabled="true" className="flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5 opacity-60" title={e.stateNote}>
                      {row}
                    </div>
                  ) : (
                    <Link key={e.href} href={e.href} prefetch={e.prefetch === false ? false : undefined} className="flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5 outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                      {row}
                    </Link>
                  );
                }),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
