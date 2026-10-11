import { PageHeader } from "@/components/shared/page-header";
import { requireAccess } from "@/lib/auth/require-role";
import { loadGoogleAllowedDomains } from "@/lib/auth/google/settings";
import { googleSignInConfigFromEnv } from "@/lib/auth/google";

import { TRUST_HEADING, TRUST_ITEMS, TRUST_REVIEW_STATUS, trustStatementHash } from "@/lib/front-door/trust-config";
import { isTrustSignedOff } from "@/lib/front-door/trust-signoff";
import { trustSignoffDb } from "@/lib/front-door/trust-wiring";

import { DomainsForm } from "./domains-form";
import { TrustForm } from "./trust-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign-in" };

export default async function SignInSettingsPage() {
  await requireAccess("settings-sign-in");
  const env = googleSignInConfigFromEnv(process.env);
  const domains = await loadGoogleAllowedDomains();
  const flagOn = process.env.GOOGLE_SIGNIN_ENABLED === "1";
  const credsSet = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
  const live = env.enabled && domains.length > 0;
  const record = await trustSignoffDb.read();
  const signedOff = isTrustSignedOff(record, trustStatementHash());

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

      <section aria-labelledby="trust" className="grid max-w-xl gap-3 rounded-lg border p-4 text-sm">
        <h2 id="trust" className="m-0 text-base font-semibold">Front door trust strip: compliance sign-off</h2>
        <p className="m-0">Status: <strong>{signedOff ? `signed off by ${record?.reviewerName} on ${record?.reviewedOn}` : TRUST_REVIEW_STATUS}</strong>. Until it is signed off, the front door shows nothing in its place. Editing the wording in code switches it off again until it is re-reviewed.</p>
        <p className="m-0 font-medium">{TRUST_HEADING.eyebrow}: {TRUST_HEADING.title}</p>
        <ul className="m-0 grid gap-2 pl-4">
          {TRUST_ITEMS.map((t) => (
            <li key={t.id}><strong>{t.title}.</strong> {t.body}</li>
          ))}
        </ul>
        <TrustForm signedOff={signedOff} today={new Date().toISOString().slice(0, 10)} />
      </section>
    </div>
  );
}
