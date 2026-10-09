import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { consentEnforced } from "@/lib/consent/enforce";
import { resolvePolicy } from "@/lib/consent/policy";
import { loadConsentCounts, loadRecentWithdrawals } from "@/lib/consent/stats";
import { ConsentAdminView } from "./consent-admin-view";

export default async function ConsentSettingsPage() {
  await requireRole(["ADMIN"]);
  if (process.env.NEXT_PUBLIC_CONSENT !== "1") notFound();

  const [counts, recent] = await Promise.all([loadConsentCounts(), loadRecentWithdrawals()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Consent"
        description="Who has agreed to what, and who has asked not to be contacted."
        actions={<Button size="sm" variant="outline" render={<a href="/api/consent/export" download />}>Export CSV</Button>}
      />
      <ConsentAdminView policy={resolvePolicy(process.env)} counts={counts} recent={recent} enforced={consentEnforced()} now={new Date()} />
    </div>
  );
}
