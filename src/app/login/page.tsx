import { BrandLockup } from "@/components/brand-lockup";
import { LoginPanel, type LoginNotice } from "@/components/front-door/login-panel";
import { googleSignInAvailable } from "@/lib/auth/google/available";
import { ssoConfigFromEnv, safeCallbackUrl } from "@/lib/auth/sso";
import { landingEnabled } from "@/lib/front-door/flag";

import { LoginForm } from "./login-form";

const NO_ACCESS = "No access. Contact your administrator.";
const GENERIC_FAILURE = "Sign-in did not complete. Try again, or contact your administrator.";

/** Every refusal (no such user, inactive, wrong domain, unverified) shows this one state, so the page cannot be used to find out who has an account. */
const FRONT_DOOR_NOTICES: Record<"denied" | "failed", LoginNotice> = {
  denied: { tone: "calm", title: "Ask an administrator for access", body: "That account cannot sign in to Customer OS yet. An administrator can add you, or you can use your email and password." },
  failed: { tone: "plain", title: "Sign-in did not complete", body: "Please try again. If it keeps happening, ask an administrator." },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const sso = ssoConfigFromEnv(process.env);
  const google = await googleSignInAvailable();

  // SSO_ONLY hides the password form; a break-glass admin reaches it with /login?breakglass=1.
  const showCredentials = !sso.enabled || !sso.ssoOnly || one(params.breakglass) === "1";
  const error = one(params.error);
  // Every refusal (unknown email, inactive, locked, unverified) looks identical on purpose.
  const federated = sso.enabled || google;
  const notice = error ? (error === "AccessDenied" ? NO_ACCESS : GENERIC_FAILURE) : undefined;
  const callbackUrl = one(params.callbackUrl) ? safeCallbackUrl(one(params.callbackUrl), "/") : undefined;

  if (landingEnabled()) {
    return (
      <LoginPanel
        googleAvailable={google}
        ssoAvailable={sso.enabled}
        showCredentials={showCredentials}
        notice={error && federated ? FRONT_DOOR_NOTICES[error === "AccessDenied" ? "denied" : "failed"] : undefined}
        callbackUrl={callbackUrl}
      />
    );
  }

  return (
    <div className="flex min-h-screen">
      <LoginForm
        ssoAvailable={sso.enabled}
        googleAvailable={google}
        showCredentials={showCredentials}
        notice={federated ? notice : undefined}
        callbackUrl={callbackUrl}
      />
      <div className="dark relative hidden flex-1 flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <BrandLockup size="lg" />
        <div className="max-w-md">
          <p className="font-heading text-2xl font-semibold tracking-tight">Client onboarding, streamlined end to end.</p>
          <p className="mt-3 text-sm text-sidebar-foreground/70">
            Track every lead from first contact through KYC, funding, and dealer handoff — with SLA automation and manager visibility built
            in.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Allvest Securities Private Limited</p>
      </div>
    </div>
  );
}
