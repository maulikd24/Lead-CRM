import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/require-role";
import { Logo } from "@/components/logo";
import { ChangePasswordForm } from "@/app/(dashboard)/settings/account/change-password-form";

/** Where requireUser()/requireRole() send a user whose password must be changed (Admin reset, a new account's
 * temporary password, or a security response). Outside the dashboard layout so it can't redirect to itself. */
export default async function ChangePasswordPage() {
  const session = await requireSession();
  if (!session.user.mustChangePassword) redirect("/settings/account");

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <Logo className="size-8" />
          <span className="font-heading text-lg font-semibold tracking-tight">Supportify</span>
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          For security, you need to choose a new password for {session.user.email} before continuing. It must be
          different from your current one. You&apos;ll then sign in again with it.
        </p>
        <div className="mt-8">
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  );
}
