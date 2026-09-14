import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// There's no tier-benefit schema to configure — PartnerTier is a fixed enum, not a DB-backed
// config table. This is a read-only directory grouped by tier/status, not a tier editor: honest
// about what actually exists today rather than faking a config surface with nothing behind it.
export default async function PartnerDirectoryPage() {
  await requireRole(["ADMIN"]);

  const partners = await prisma.partnerProfile.findMany({
    include: { user: { select: { name: true, email: true } } },
    orderBy: [{ tier: "desc" }, { partnerCode: "asc" }],
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Partner Directory" description={`${partners.length} partner${partners.length === 1 ? "" : "s"}, grouped by tier.`} />
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Empanelment Status</TableHead>
                <TableHead>Region</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {partners.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <p className="font-medium">{p.user.name}</p>
                    <p className="text-xs text-muted-foreground">{p.user.email}</p>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{p.partnerCode}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.partnerType}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.tier}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.empanelmentStatus === "ACTIVE" ? "success" : "outline"}>
                      {p.empanelmentStatus.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.region ?? "—"}</TableCell>
                </TableRow>
              ))}
              {partners.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No partners yet.
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
