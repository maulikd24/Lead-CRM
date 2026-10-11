import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { requireMarketing } from "@/lib/auth/require-role";
import { productRegistryEnabled } from "@/lib/registry/flag";
import { listApprovedClaims } from "@/lib/registry/service";

export const dynamic = "force-dynamic";

/**
 * What Marketing may say about a product: approved, in-date claims, and nothing else from the registry. No eligibility, minimum, risk
 * detail or sales restriction is read here (the loader never selects them). Copy tools cite a claim by its ids.
 */
export default async function ApprovedClaimsPage() {
  await requireMarketing("product-registry-claims");
  if (!productRegistryEnabled()) notFound();
  const claims = await listApprovedClaims();
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Approved claims" description="The only product statements that may go into copy. Each is approved and in date. Cite the product and claim ids; anything not listed here is not approved." />
      {claims.length === 0 ? (
        <p className="rounded-xl border border-border px-3 py-4 text-sm text-muted-foreground">No claims are approved right now. Ask an Admin to approve a product and its claims in the registry.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">Approved marketing claims</caption>
            <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="py-1 pr-3 font-medium">Product</th><th scope="col" className="py-1 pr-3 font-medium">Claim</th><th scope="col" className="py-1 pr-3 font-medium">Valid until</th><th scope="col" className="py-1 font-medium">Cite as</th></tr></thead>
            <tbody>
              {claims.map((c) => (
                <tr key={`${c.productId}:${c.claimId}`} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3">{c.productName}{c.isExample && <Badge variant="outline" className="ml-2">Example</Badge>}</td>
                  <td className="py-1.5 pr-3">{c.text}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{c.validUntil ? new Date(c.validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "No end date"}</td>
                  <td className="py-1.5"><code className="block break-all text-xs">product {c.productId}</code><code className="block break-all text-xs">claim {c.claimId}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
