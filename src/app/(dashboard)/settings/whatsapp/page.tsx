import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { toAccountState } from "@/lib/whatsapp/account-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils/format";
import { AccountDialog } from "./account-dialog";
import { AccountActiveToggle } from "./account-active-toggle";
import { AccountStatusBadge, QrDialogButton } from "./qr-panel";

export default async function WhatsAppAccountsPage() {
  await requireRole(["ADMIN"]);

  const [accounts, rms] = await Promise.all([
    prisma.whatsAppAccount.findMany({ orderBy: { label: "asc" }, include: { owner: { select: { name: true } } } }),
    prisma.user.findMany({ where: { role: "RM", isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="WhatsApp Accounts"
        description="One row per RM WhatsApp number. Each number runs as its own session on the WhatsApp worker."
        actions={<AccountDialog owners={rms} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Numbers</CardTitle>
          <CardDescription>
            Status comes from the worker&apos;s heartbeat — if the worker stops reporting for 5 minutes, its numbers are marked offline
            and Admins are notified.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Session ID</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => {
                const state = toAccountState(account);
                return (
                  <TableRow key={account.id} className={account.isActive ? undefined : "opacity-60"}>
                    <TableCell className="font-medium">
                      {account.label} {!account.isActive && <Badge variant="outline">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{account.sessionId}</TableCell>
                    <TableCell className="text-sm">{account.owner?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{account.phoneNumber ? `+${account.phoneNumber}` : "—"}</TableCell>
                    <TableCell>
                      <AccountStatusBadge state={state} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {account.lastSeenAt ? formatDateTime(account.lastSeenAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <QrDialogButton initial={state} />
                        <AccountDialog
                          owners={rms}
                          account={{ id: account.id, label: account.label, sessionId: account.sessionId, ownerUserId: account.ownerUserId }}
                        />
                        <AccountActiveToggle accountId={account.id} isActive={account.isActive} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {accounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No WhatsApp accounts yet. Add one per RM number, then start the worker.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
