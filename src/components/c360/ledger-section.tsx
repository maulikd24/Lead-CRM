import { History } from "lucide-react";

import { RailError } from "@/components/c360/rail-views";
import { LedgerList } from "@/components/ledger/ledger-list";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { auth } from "@/lib/auth/config";
import { getActionLedger, type LedgerResult } from "@/lib/ledger";

/** The Why tab (Action history): why the platform did each thing for this customer. getActionLedger authorises (registry area and the customer's record scope); not allowed and failed both show the quiet error. */
export async function LedgerSection({ clientId }: { clientId: string }) {
  let out: LedgerResult | null = null;
  try {
    const session = await auth();
    if (session?.user) out = await getActionLedger({ type: "client", id: clientId }, { viewer: { id: session.user.id, role: session.user.role }, limit: 25 });
  } catch (error) {
    console.error("Customer 360: action ledger failed", error instanceof Error ? error.name : "unknown");
  }
  if (!out || !out.ok) return <RailError what="the action history" />;
  const initial = { entries: out.entries, nextCursor: out.nextCursor };
  return (
    <Card className="c360-rise">
      <CardHeader>
        <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium"><History className="size-4 text-muted-foreground" aria-hidden /> Why: action history</h2>
        <CardDescription>
          What the platform did for this customer and why: the trigger, the decision, who approved it, what happened next. Built from existing records; a link guessed from customer and time is marked inferred.
          {out.hidden.decisions && " Decision engine records are not shown to your role."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LedgerList params={{ clientId }} initial={initial} counts={out.counts} />
      </CardContent>
    </Card>
  );
}
