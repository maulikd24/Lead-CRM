import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { toAccountState } from "@/lib/whatsapp/account-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountStatusBadge, QrDialogButton } from "../whatsapp/qr-panel";
import { ChangePasswordForm } from "./change-password-form";
import { ProfileForm } from "./profile-form";
import { DeviceSyncCard } from "./device-sync-card";
import { PushCard } from "./push-card";
import { DEVICE_SYNC_ROLES } from "@/lib/device/token";

export default async function AccountSettingsPage() {
  const session = await requireUser();
  const myWhatsApp = await prisma.whatsAppAccount.findUnique({ where: { ownerUserId: session.user.id } });
  const myWhatsAppState = myWhatsApp ? toAccountState(myWhatsApp) : null;
  const [pushDeviceCount, me] = await Promise.all([
    prisma.pushToken.count({ where: { userId: session.user.id } }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { pushMutedCategories: true } }),
  ]);
  const devices = DEVICE_SYNC_ROLES.includes(session.user.role)
    ? await prisma.deviceToken.findMany({ where: { userId: session.user.id, revokedAt: null }, orderBy: { createdAt: "desc" } })
    : null;

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
          <CardTitle className="text-base">Phone notifications</CardTitle>
          <CardDescription>Alerts from the Supportify Android app — SLA warnings, overdue tasks, new leads and more. Choose which kinds to receive.</CardDescription>
        </CardHeader>
        <CardContent>
          <PushCard deviceCount={pushDeviceCount} muted={me?.pushMutedCategories ?? []} />
        </CardContent>
      </Card>

      {devices && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-base">Phone call sync</CardTitle>
            <CardDescription>
              Calls from the Supportify Android app that match your clients show up in their Activity. Other calls are never stored.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeviceSyncCard
              devices={devices.map((d) => ({
                id: d.id,
                label: d.label,
                lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
                lastSyncMatched: d.lastSyncMatched,
                createdAt: d.createdAt.toISOString(),
              }))}
            />
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
