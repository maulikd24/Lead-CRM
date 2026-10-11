import { PageHeader } from "@/components/shared/page-header";
import { requireAccess } from "@/lib/auth/require-role";
import { loadGoogleAllowedDomains } from "@/lib/auth/google/settings";
import { googleSignInConfigFromEnv } from "@/lib/auth/google";

import { DomainsForm } from "./domains-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign-in" };

export default async function SignInSettingsPage() {
  await requireAccess("settings-sign-in");
  const env = googleSignInConfigFromEnv(process.env);
  const domains = await loadGoogleAllowedDomains();
  const flagOn = process.env.GOOGLE_SIGNIN_ENABLED === "1";
  const credsSet = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
  const live = env.enabled && domains.length > 0;

  return (
    <div className="grid gap-6 p-4 md:p-6">
      <PageHeader title="Sign-in" description="Company Google sign-in. Only people who already have an active user here can sign in; nothing is created automatically and the role always comes from this system." />
      <section aria-labelledby="status" className="grid max-w-xl gap-2 rounded-lg border p-4 text-sm">
        <h2 id="status" className="m-0 text-base font-semibold">Status</h2>
        <p className="m-0">Switch (GOOGLE_SIGNIN_ENABLED): <strong>{flagOn ? "on" : "off"}</strong></p>
        <p className="m-0">Google credentials in the environment: <strong>{credsSet ? "present" : "missing"}</strong> (values are never shown here)</p>
        <p className="m-0">Allowed domains: <strong>{domains.length > 0 ? domains.join(", ") : "none"}</strong></p>
        <p className="m-0">Continue with Google is shown on the sign-in page: <strong>{live ? "yes" : "no"}</strong></p>
      </section>
      <DomainsForm current={domains.join("\n")} />
    </div>
  );
}
