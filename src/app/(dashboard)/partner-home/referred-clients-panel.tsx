import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applyMasking, CLIENT_MASK_RULES } from "@/lib/policy/masking";
import type { Role } from "@/generated/prisma/client";

/**
 * The first real consumer of applyMasking() — a Partner sees only the clients they sourced
 * (via TradingAccount.sourcingPartnerId), with PAN masked (and mobile/email additionally masked
 * for the lighter-weight AFFILIATE tier) per CLIENT_MASK_RULES.
 */
export async function ReferredClientsPanel({ partnerProfileId, actor }: { partnerProfileId: string; actor: { id: string; role: Role } }) {
  const accounts = await prisma.tradingAccount.findMany({
    where: { sourcingPartnerId: partnerProfileId },
    include: { client: { select: { id: true, name: true, clientCode: true, pan: true, mobile: true, email: true } } },
    distinct: ["clientId"],
  });

  const clients = accounts.map((account) =>
    applyMasking(account.client, actor, CLIENT_MASK_RULES, { entity: "Client", entityId: account.client.id }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Referred Clients</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>PAN</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {clients.map((client) => (
              <TableRow key={client.id}>
                <TableCell>
                  {/* Not a link — Partner-family roles can't open /clients/[id] today (that page's
                      visibility check doesn't know about sourcingPartnerId yet); avoid shipping a
                      dead link rather than silently 404ing on click. */}
                  <p className="font-medium">{client.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{client.clientCode}</p>
                </TableCell>
                <TableCell className="font-mono text-sm">{client.pan ?? "—"}</TableCell>
                <TableCell className="text-sm">{client.mobile ?? "—"}</TableCell>
                <TableCell className="text-sm">{client.email ?? "—"}</TableCell>
              </TableRow>
            ))}
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No referred clients on file yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
