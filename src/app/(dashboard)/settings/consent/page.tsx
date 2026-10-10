import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";
import { consentEnforced } from "@/lib/consent/enforce";
import { resolvePolicy } from "@/lib/consent/policy";
import { loadConsentCounts, loadRecentWithdrawals } from "@/lib/consent/stats";
import { ConsentAdminView } from "./consent-admin-view";

export default async function ConsentSettingsPage() {
  await requireRole(["ADMIN"]);
  if (process.env.NEXT_PUBLIC_CONSENT !== "1") notFound();

  const [counts, recent] = await Promise.all([loadConsentCounts(), loadRecentWithdrawals()]);

  return <ConsentAdminView policy={resolvePolicy(process.env)} counts={counts} recent={recent} enforced={consentEnforced()} now={new Date()} />;
}
