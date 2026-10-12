import { Logo } from "@/components/logo";
import { ssoConfigFromEnv, safeCallbackUrl } from "@/lib/auth/sso";

import { LoginForm } from "./login-form";

const NO_ACCESS = "No access. Contact your administrator.";
const GENERIC_FAILURE = "Sign-in did not complete. Try again, or contact your administrator.";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const sso = ssoConfigFromEnv(process.env);

  // SSO_ONLY hides the password form; a break-glass admin reaches it with /login?breakglass=1.
  const showCredentials = !sso.enabled || !sso.ssoOnly || one(params.breakglass) === "1";
  const error = one(params.error);
  // Every refusal (unknown email, inactive, locked, unverified) looks identical on purpose.
  const notice = error ? (error === "AccessDenied" ? NO_ACCESS : GENERIC_FAILURE) : undefined;
  const callbackUrl = one(params.callbackUrl) ? safeCallbackUrl(one(params.callbackUrl), "/") : undefined;

  return (
    <div className="flex min-h-screen">
      <LoginForm
        ssoAvailable={sso.enabled}
        showCredentials={showCredentials}
        notice={sso.enabled ? notice : undefined}
        callbackUrl={callbackUrl}
      />
      <div className="relative hidden flex-1 flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="font-heading text-lg font-semibold tracking-tight">Supportify</span>
        </div>
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
