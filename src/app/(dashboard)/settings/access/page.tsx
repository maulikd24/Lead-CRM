import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { buildMatrix, cellText, previewFor } from "@/lib/access/matrix";
import { ALL_ROLES, type AreaGroup } from "@/lib/access/policy";
import { requireAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import type { Role } from "@/generated/prisma/client";
import { enabledNavFlags } from "@/lib/nav-flags";

export const dynamic = "force-dynamic";
export const metadata = { title: "Who can see what" };

const GROUP_LABEL: Record<AreaGroup, string> = { customer: "Customer and sales work", marketing: "Marketing", distribution: "Partners and distribution", finance: "Finance", admin: "Administration", self: "About the person themselves" };
const SHORT: Record<string, string> = { view: "V", manage: "C", export: "E" };

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const session = await requireAccess("settings-access");
  const { as } = await searchParams;
  const matrix = buildMatrix();
  const asRole = ALL_ROLES.find((r) => r === as) as Role | undefined;
  const preview = asRole ? previewFor(asRole, enabledNavFlags()) : null;

  // Looking at a role is read-only, but it is recorded: who previewed which role.
  if (asRole) {
    await prisma.auditLog.create({ data: { userId: session.user.id, entity: "User", entityId: session.user.id, action: "view_as_role", newValue: { role: asRole } } });
  }

  const groups = Object.keys(GROUP_LABEL) as AreaGroup[];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Who can see what" description="Generated from the one permission registry. V = view, C = change, E = export. ADMIN can do everything. Anything not listed is denied." />

      <section aria-labelledby="view-as" className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 id="view-as" className="font-heading text-lg font-bold">View as role</h2>
        <p className="text-sm text-muted-foreground">Shows the sidebar and landing page a role gets. Nothing changes and no data is loaded as that person. Each preview is recorded in the activity log.</p>
        <nav aria-label="Roles" className="flex flex-wrap gap-2">
          {ALL_ROLES.map((r) => (
            <Link key={r} href={`/settings/access?as=${r}`} aria-current={asRole === r ? "true" : undefined} className={`rounded-full border px-3 py-1 text-sm ${asRole === r ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {r}
            </Link>
          ))}
        </nav>
        {preview && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm">Lands on <Badge variant="outline">{preview.landing}</Badge></p>
              <h3 className="mt-3 text-sm font-semibold">Sidebar ({preview.sidebar.length})</h3>
              <ul className="mt-1 grid gap-1 text-sm">
                {preview.sidebar.map((i) => (
                  <li key={i.href} className="flex justify-between gap-2 border-b py-1"><span>{i.label}</span><span className="text-muted-foreground">{i.category ?? "Top level"}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Areas this role holds ({preview.areas.length})</h3>
              <ul className="mt-1 grid gap-1 text-sm">
                {preview.areas.map((a) => (
                  <li key={a.area} className="flex justify-between gap-2 border-b py-1"><span>{a.label}</span><span className="text-muted-foreground">{cellText(a.actions)}</span></li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="matrix" className="flex flex-col gap-4">
        <h2 id="matrix" className="font-heading text-lg font-bold">Role by area</h2>
        {groups.map((g) => {
          const rows = matrix.rows.filter((r) => r.group === g);
          if (rows.length === 0) return null;
          return (
            <div key={g} className="overflow-x-auto rounded-xl border" role="region" aria-label={GROUP_LABEL[g]} tabIndex={0}>
              <table className="w-full min-w-[720px] text-sm">
                <caption className="px-3 py-2 text-left font-semibold">{GROUP_LABEL[g]}</caption>
                <thead>
                  <tr className="border-y text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-1.5">Area</th>
                    {matrix.roles.map((r) => <th key={r} scope="col" className="px-1.5 py-1.5 text-center">{r.replace("_", " ")}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.area} className="border-b last:border-0">
                      <th scope="row" className="px-3 py-1.5 text-left font-normal">{row.label}</th>
                      {matrix.roles.map((r) => (
                        <td key={r} className="px-1.5 py-1.5 text-center" title={cellText(row.cells[r])}>
                          <span className={row.cells[r].length ? "font-semibold text-foreground" : "text-muted-foreground"}>
                            {row.cells[r].length ? row.cells[r].map((a) => SHORT[a]).join("") : "-"}
                          </span>
                          <span className="sr-only">{cellText(row.cells[r])}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>
    </div>
  );
}
