"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { X } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddMemberDialog } from "./add-member-dialog";
import { removeHouseholdMemberAction } from "../actions";
import type { Household, HouseholdMember, Client } from "@/generated/prisma/client";

type HouseholdWithMembers = Household & {
  members: (HouseholdMember & { client: Pick<Client, "id" | "name" | "clientCode" | "assignedToId"> })[];
};

export function OverviewPanel({ household, accountCount }: { household: HouseholdWithMembers; accountCount: number }) {
  const [pending, startTransition] = useTransition();

  function handleRemove(memberId: string) {
    startTransition(async () => {
      try {
        await removeHouseholdMemberAction(household.id, memberId);
        toast.success("Member removed");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to remove member");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Members</CardTitle>
        <AddMemberDialog householdId={household.id} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {household.members.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No members yet — add clients to this household to see their combined holdings and transactions.
          </p>
        )}
        {household.members.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Link href={`/clients/${m.client.id}`} className="text-sm font-medium text-primary hover:underline">
                {m.client.name}
              </Link>
              <span className="ml-2 font-mono text-xs text-muted-foreground">{m.client.clientCode}</span>
              <div className="mt-1 flex gap-1">
                {m.isPrimary && <Badge variant="success">Primary</Badge>}
                {m.relationship && <Badge variant="outline">{m.relationship}</Badge>}
              </div>
            </div>
            <Button size="icon-sm" variant="ghost" disabled={pending} onClick={() => handleRemove(m.id)}>
              <X className="size-4" />
            </Button>
          </div>
        ))}
        {accountCount === 0 && household.members.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            No trading accounts on file yet for this household&apos;s members — import holdings/transactions from the
            Households list to populate them.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
