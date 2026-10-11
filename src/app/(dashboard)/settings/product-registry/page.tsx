import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { MasterDetail, Skeleton, TabbedWorkspace, lazyPanels } from "@/components/workspace";
import { requireAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { formatLines, minorToRupees } from "@/lib/registry/form-parse";
import { productRegistryEnabled } from "@/lib/registry/flag";
import { getProduct, listProducts } from "@/lib/registry/service";
import { ProductDetail, listItem } from "./registry-view";
import { EditDraftSheet, NewProductSheet, type DraftEdit } from "./sheets";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "products", label: "Products" },
  { key: "activity", label: "Activity" },
] as const;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

async function ProductsPanel({ viewerId }: { viewerId: string }) {
  const rows = await listProducts();
  const details = (await Promise.all(rows.map((r) => getProduct(r.head.id)))).filter((d): d is NonNullable<typeof d> => d !== null);
  const userIds = [...new Set(details.flatMap((d) => d.versions.flatMap((v) => [v.createdById, v.reviewedBy])).filter((x): x is string => !!x && x !== "seed"))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const drafts: DraftEdit[] = details.flatMap((d) => {
    const draft = d.versions.find((v) => v.state === "DRAFT");
    if (!draft) return [];
    return [{
      productId: d.head.id, versionId: draft.id, name: draft.name,
      fields: { name: draft.name, category: draft.category, summary: draft.summary ?? "", availability: draft.availability, minInvestment: minorToRupees(draft.minInvestmentMinor), currency: draft.currency, riskCategory: draft.riskCategory, jurisdictions: draft.jurisdictions.join(", "), requiredDocuments: draft.requiredDocuments.join("\n"), eligibility: formatLines.eligibility(draft.eligibility), restrictions: formatLines.restrictions(draft.salesRestrictions), claims: formatLines.claims(draft.claims), validFrom: day(draft.validFrom), validTo: day(draft.validTo) },
    }];
  });
  if (rows.length === 0) {
    return <p className="rounded-xl border border-border px-3 py-4 text-sm text-muted-foreground">No products yet. Use New product to add the first one. Until a product is approved by a second Admin, no agent, campaign or copy tool can cite it.</p>;
  }
  return (
    <>
      <MasterDetail
        idPrefix="registry"
        label="Products"
        noun="products"
        items={rows.map(listItem)}
        details={Object.fromEntries(details.map((d) => [d.head.id, <ProductDetail key={d.head.id} p={d} viewerId={viewerId} names={names} />]))}
      />
      <EditDraftSheet drafts={drafts} />
    </>
  );
}

async function ActivityPanel() {
  const rows = await prisma.auditLog.findMany({ where: { entity: "RegistryProduct" }, orderBy: { timestamp: "desc" }, take: 40, select: { id: true, action: true, entityId: true, reason: true, timestamp: true, user: { select: { name: true } } } });
  const heads = await prisma.registryProduct.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.entityId))] } }, select: { id: true, key: true } });
  const keys = Object.fromEntries(heads.map((h) => [h.id, h.key]));
  if (rows.length === 0) return <p className="rounded-xl border border-border px-3 py-4 text-sm text-muted-foreground">No registry changes yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="sr-only">Recent registry changes</caption>
        <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="py-1 pr-3 font-medium">When</th><th scope="col" className="py-1 pr-3 font-medium">Who</th><th scope="col" className="py-1 pr-3 font-medium">What</th><th scope="col" className="py-1 font-medium">Product</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="py-1 pr-3 whitespace-nowrap tabular-nums">{r.timestamp.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}</td>
              <td className="py-1 pr-3">{r.user.name}</td>
              <td className="py-1 pr-3">{r.action.replace("registry.", "").replace(/_/g, " ")}{r.reason ? <span className="block text-xs text-muted-foreground">{r.reason}</span> : null}</td>
              <td className="py-1"><code className="text-xs">{keys[r.entityId] ?? r.entityId}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const wrap = (node: React.ReactNode) => <Suspense fallback={<Skeleton className="h-64" />}>{node}</Suspense>;

export default async function ProductRegistryPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const session = await requireAccess("settings-product-registry");
  if (!productRegistryEnabled()) notFound();
  const sp = await searchParams;
  const panels = lazyPanels(TABS.map((t) => t.key), sp.tab, "products", {
    products: () => wrap(<ProductsPanel viewerId={session.user.id} />),
    activity: () => wrap(<ActivityPanel />),
  });
  return (
    <TabbedWorkspace
      lazy
      idPrefix="registry"
      label="Product registry sections"
      tabs={TABS.map((t) => ({ ...t }))}
      panels={panels}
      header={<PageHeader title="Product registry" description="The one governed list of products. Agents, campaigns and copy may only cite what is approved here. A change needs a second Admin." actions={<NewProductSheet />} />}
    />
  );
}
