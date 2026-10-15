import { prisma } from "@/lib/db/prisma";
import { ShowFirstBlock } from "@/components/workspace";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applyMasking, CLIENT_MASK_RULES } from "@/lib/policy/masking";
import type { Role } from "@/generated/prisma/client";

/**
 * The first real consumer of applyMasking() — a Partner sees only the clients they sourced
 * (via TradingAccount.sourcingPartnerId), with masked mobile and masked email only (CLIENT_MASK_RULES); a partner has no reveal.
 * PAN and CKYC are neither selected nor shown (owner decision, DPDP data minimisation).
 */
type Row = ReturnType<typeof applyMasking<{ id: string; name: string; clientCode: string; mobile: string | null; email: string | null }>>;

// The shared rule set also covers PAN, which this panel does not load; the cast drops that field from the rule type.
type MaskRules = Parameters<typeof applyMasking<{ id: string; name: string; clientCode: string; mobile: string | null; email: string | null }>>[2];

function ClientsTable({ rows }: { rows: Row[] }) {
  return (
    <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead className="max-lg:hidden">Mobile</TableHead>
              <TableHead className="max-lg:hidden">Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {rows.map((client) => (
              <TableRow key={client.id}>
                <TableCell>
                  {/* Not a link — Partner-family roles can't open /clients/[id] today (that page's
                      visibility check doesn't know about sourcingPartnerId yet); avoid shipping a
                      dead link rather than silently 404ing on click. */}
                  <p className="font-medium">{client.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{client.clientCode}</p>
                </TableCell>
                <TableCell className="text-sm max-lg:hidden">{client.mobile ?? "—"}</TableCell>
                <TableCell className="text-sm max-lg:hidden">{client.email ?? "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  No referred clients on file yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
  );
}

export async function ReferredClientsPanel({ partnerProfileId, actor }: { partnerProfileId: string; actor: { id: string; role: Role } }) {
  const accounts = await prisma.tradingAccount.findMany({
    where: { sourcingPartnerId: partnerProfileId },
    include: { client: { select: { id: true, name: true, clientCode: true, mobile: true, email: true } } },
    distinct: ["clientId"],
  });

  const clients = accounts.map((account) =>
    applyMasking(account.client, actor, CLIENT_MASK_RULES.filter((r) => !r.fields.includes("pan")) as unknown as MaskRules, { entity: "Client", entityId: account.client.id }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Referred Clients</CardTitle>
      </CardHeader>
      <CardContent>
        <ShowFirstBlock name="referred-clients" title="Referred clients" noun="clients" total={clients.length} preview={<ClientsTable rows={clients.slice(0, 5)} />} full={<ClientsTable rows={clients} />} />
      </CardContent>
    </Card>
  );
}
