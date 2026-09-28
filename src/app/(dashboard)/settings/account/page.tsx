import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { toAccountState } from "@/lib/whatsapp/account-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountStatusBadge, QrDialogButton } from "../whatsapp/qr-panel";
import { ChangePasswordForm } from "./change-password-form";
import { ProfileForm } from "./profile-form";

export default async function AccountSettingsPage() {
  const session = await requireUser();
  const myWhatsApp = await prisma.whatsAppAccount.findUnique({ where: { ownerUserId: session.user.id } });
  const myWhatsAppState = myWhatsApp ? toAccountState(myWhatsApp) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description={`Signed in as ${session.user.name} (${session.user.email})`} />

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Update your account details.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm name={session.user.name} email={session.user.email} />
        </CardContent>
      </Card>

      {myWhatsAppState && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-base">My WhatsApp</CardTitle>
            <CardDescription>
              {myWhatsAppState.label}
              {myWhatsAppState.phoneNumber ? ` · +${myWhatsAppState.phoneNumber}` : ""} — the number your leads message.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <AccountStatusBadge state={myWhatsAppState} />
            <QrDialogButton initial={myWhatsAppState} label={myWhatsAppState.status === "CONNECTED" ? "View status" : "Connect / QR"} />
          </CardContent>
        </Card>
      )}

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Change Password</CardTitle>
          <CardDescription>Update the password used to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Choose how Supportify looks on this device.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Theme</p>
          <ThemeToggle />
        </CardContent>
      </Card>
    </div>
  );
}
