import Link from "next/link";
import { MessagesSquare } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { listAccountsForFilter } from "@/lib/whatsapp/inbox-queries";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InboxShell } from "./inbox-shell";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  const { client } = await searchParams;
  const showTeamFilters = session.user.role !== "RM";

  const [accounts, rms, accountCount] = await Promise.all([
    showTeamFilters ? listAccountsForFilter() : Promise.resolve([]),
    showTeamFilters
      ? prisma.user.findMany({ where: { role: "RM", isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    prisma.whatsAppAccount.count({ where: { isActive: true } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Inbox"
        description={
          showTeamFilters
            ? "Every WhatsApp conversation across all RM numbers."
            : "WhatsApp conversations with the leads assigned to you."
        }
      />
      {accountCount === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={MessagesSquare}
              title="No WhatsApp numbers connected yet"
              description={
                session.user.role === "ADMIN"
                  ? "Add an account for each RM number and scan its QR code to start receiving conversations here."
                  : "Ask an Admin to connect your WhatsApp number."
              }
            />
            {session.user.role === "ADMIN" && (
              <div className="flex justify-center pb-4">
                <Button size="sm" render={<Link href="/settings/whatsapp" />}>
                  Set up WhatsApp accounts
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <InboxShell accounts={accounts} rms={rms} showTeamFilters={showTeamFilters} initialSelectedId={client ?? null} />
      )}
    </div>
  );
}
