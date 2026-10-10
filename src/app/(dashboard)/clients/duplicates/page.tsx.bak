import { Merge } from "lucide-react";

import { requireRole } from "@/lib/auth/require-role";
import type { Actor } from "@/lib/identity/merge-review/decide";
import { mergeReviewEnabled } from "@/lib/identity/merge-review/flag";
import { loadQueue } from "@/lib/identity/merge-review/load";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ReviewQueue } from "./review-queue";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const enabled = mergeReviewEnabled();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Duplicate customers"
        description="Customers who look like the same person. Compare them, choose which to keep, then merge or dismiss. A merge cannot be undone."
      />
      {enabled ? <Queue actor={{ id: session.user.id, role: session.user.role }} /> : (
        <Card>
          <CardContent>
            <EmptyState icon={Merge} title="Duplicate review is not switched on" description="Ask an administrator to enable it." />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function Queue({ actor }: { actor: Actor }) {
  const { total, items } = await loadQueue(actor);
  return <ReviewQueue items={items} total={total} />;
}
