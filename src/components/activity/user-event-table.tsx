import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { describeUserAgent } from "@/lib/activity/log-user-event";
import { formatIstDateTime } from "@/lib/utils/ist-date";
import type { Role, UserEventType } from "@/generated/prisma/client";

export type UserEventRow = {
  id: string;
  type: UserEventType;
  createdAt: Date;
  userEmail: string | null;
  userRole: Role | null;
  user: { name: string } | null;
  summary: string | null;
  path: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

const TYPE_BADGE: Record<UserEventType, { label: string; variant: "default" | "success" | "destructive" | "outline" | "secondary" | "warning" | "accent" }> = {
  LOGIN_SUCCESS: { label: "Sign-in", variant: "success" },
  LOGIN_FAILED: { label: "Failed sign-in", variant: "destructive" },
  LOGOUT: { label: "Sign-out", variant: "secondary" },
  PAGE_VIEW: { label: "Page view", variant: "outline" },
  DATA_CREATE: { label: "Created", variant: "default" },
  DATA_UPDATE: { label: "Updated", variant: "warning" },
  DATA_DELETE: { label: "Deleted", variant: "destructive" },
  EXPORT: { label: "Download", variant: "secondary" },
};

export function UserEventTable({ rows, showUser = true }: { rows: UserEventRow[]; showUser?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time (IST)</TableHead>
            {showUser && <TableHead>User</TableHead>}
            <TableHead>Event</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>IP</TableHead>
            <TableHead>Device</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody striped>
          {rows.map((row) => {
            const badge = TYPE_BADGE[row.type];
            return (
              <TableRow key={row.id}>
                <TableCell className="text-sm text-muted-foreground">{formatIstDateTime(row.createdAt)}</TableCell>
                {showUser && (
                  <TableCell className="text-sm">
                    {row.user?.name ?? row.userEmail ?? "Unknown"}
                    {row.userRole && <span className="ml-1 text-xs text-muted-foreground">{row.userRole.replace(/_/g, " ")}</span>}
                  </TableCell>
                )}
                <TableCell>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </TableCell>
                <TableCell className="max-w-96 whitespace-normal text-sm">{row.summary ?? row.path ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{row.ipAddress ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{describeUserAgent(row.userAgent)}</TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={showUser ? 6 : 5} className="py-6 text-center text-sm text-muted-foreground">
                No activity recorded for this selection.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
