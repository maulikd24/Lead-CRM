import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils/format";
import { RetentionPolicyPanel } from "./retention-policy-panel";
import { ErasureQueuePanel } from "./erasure-queue-panel";

// Hand-maintained summary of src/lib/policy/masking.ts's CLIENT_MASK_RULES — the rules themselves
// are `allow` functions, not declarative data, so this is a readable restatement rather than a
// live introspection; keep it in sync if masking.ts's rules change.
const MASK_RULE_SUMMARY = [
  { field: "PAN", visibleTo: "ADMIN, MANAGER, RM", maskedFor: "DEALER, PARTNER, AFFILIATE, DISTRIBUTOR, TEAM_MANAGER, FINANCE" },
  { field: "Mobile / Email", visibleTo: "Everyone except AFFILIATE", maskedFor: "AFFILIATE only" },
];

export default async function DataPrivacyPage() {
  await requireRole(["ADMIN"]);

  const [policies, erasureRequests, accessLogs] = await Promise.all([
    prisma.dataRetentionPolicy.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.erasureRequest.findMany({ include: { requestedBy: { select: { name: true } } }, orderBy: { requestedAt: "desc" } }),
    prisma.dataAccessLog.findMany({ include: { user: { select: { name: true } } }, orderBy: { accessedAt: "desc" }, take: 50 }),
  ]);

  // subjectId is a polymorphic string reference (no real FK, same convention as AuditLog.entityId)
  // — look up display names for "Client" subjects separately so the queue shows a name, not a bare id.
  const clientSubjectIds = erasureRequests.filter((r) => r.subjectType === "Client").map((r) => r.subjectId);
  const subjectClients = clientSubjectIds.length
    ? await prisma.client.findMany({ where: { id: { in: clientSubjectIds } }, select: { id: true, name: true, clientCode: true } })
    : [];
  const subjectClientById = new Map(subjectClients.map((c) => [c.id, c]));
  const erasureRequestsWithSubject = erasureRequests.map((r) => ({ ...r, subjectClient: subjectClientById.get(r.subjectId) ?? null }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Data Privacy" description="Field masking, access audit trail, and retention/erasure controls." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Field Masking Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Visible To</TableHead>
                <TableHead>Masked For</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {MASK_RULE_SUMMARY.map((r) => (
                <TableRow key={r.field}>
                  <TableCell className="text-sm font-medium">{r.field}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.visibleTo}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.maskedFor}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RetentionPolicyPanel policies={policies} />
      <ErasureQueuePanel requests={erasureRequestsWithSubject} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Sensitive-Field Access</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Accessed At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {accessLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm">{log.user.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {log.entity} <span className="font-mono text-xs">{log.entityId}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{log.fieldName}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(log.accessedAt)}</TableCell>
                </TableRow>
              ))}
              {accessLogs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No sensitive-field access logged yet.
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
