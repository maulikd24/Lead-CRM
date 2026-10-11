import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { MasterDetail } from "@/components/workspace";
import { requireAccess } from "@/lib/auth/require-role";
import { productRegistryEnabled } from "@/lib/registry/flag";
import { EXAMPLE_LABEL } from "@/lib/registry/model";
import { listCitable } from "@/lib/registry/service";

export const dynamic = "force-dynamic";

const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
const rupees = (minor: number | null, currency: string) => (minor === null ? "No minimum" : `${currency} ${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

/**
 * Read only, for RMs and managers: the approved, in-date products and what is true of each (who it is open to, the minimum, documents and
 * restrictions). Drafts, history and marketing claims are not shown here; a suspended or retired product simply is not listed.
 */
export default async function ProductRegistryReadPage() {
  await requireAccess("product-registry");
  if (!productRegistryEnabled()) notFound();
  const products = await listCitable();
  const items = products.map((p) => ({ id: p.productId, title: p.name, meta: `${label(p.facts.category)} · ${label(p.facts.riskCategory)} risk`, trailing: p.isExample ? <Badge variant="outline">Example</Badge> : undefined }));
  const details = Object.fromEntries(
    products.map((p) => [
      p.productId,
      <div key={p.productId} className="flex min-w-0 flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-semibold leading-tight">{p.name}</h2>
          <p className="text-xs text-muted-foreground">Version {p.versionNo} · as of {p.asOf.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</p>
          {p.isExample && <p className="mt-1 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">{EXAMPLE_LABEL}</p>}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {([["Availability", label(p.facts.availability)], ["Minimum investment", rupees(p.facts.minInvestmentMinor, p.facts.currency)], ["Risk category", label(p.facts.riskCategory)], ["Jurisdictions", p.facts.jurisdictions.join(", ")]] as const).map(([k, v]) => (
            <div key={k} className="flex flex-col"><dt className="text-xs text-muted-foreground">{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <section className="flex flex-col gap-1"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open to</h3>{p.facts.eligibility.length === 0 ? <p className="text-sm text-muted-foreground">No rules listed.</p> : <ul className="list-disc pl-5 text-sm">{p.facts.eligibility.map((e) => <li key={e.code}>{e.value}</li>)}</ul>}</section>
        <section className="flex flex-col gap-1"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documents needed</h3>{p.facts.requiredDocuments.length === 0 ? <p className="text-sm text-muted-foreground">None listed.</p> : <ul className="list-disc pl-5 text-sm">{p.facts.requiredDocuments.map((d) => <li key={d}>{d}</li>)}</ul>}</section>
        <section className="flex flex-col gap-1"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sales restrictions</h3>{p.facts.salesRestrictions.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="list-disc pl-5 text-sm">{p.facts.salesRestrictions.map((r) => <li key={r.code}>{r.text}</li>)}</ul>}</section>
      </div>,
    ]),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader title="Products" description="The products you may talk about, and what is true of each. Read only: ask an Admin to change the registry." />
      {items.length === 0 ? <p className="rounded-xl border border-border px-3 py-4 text-sm text-muted-foreground">No approved products yet.</p> : <MasterDetail idPrefix="products" label="Products" noun="products" items={items} details={details} />}
    </div>
  );
}
