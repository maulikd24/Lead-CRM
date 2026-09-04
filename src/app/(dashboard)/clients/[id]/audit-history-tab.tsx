import { formatDateTime } from "@/lib/utils/format";
import type { AuditLog, User } from "@/generated/prisma/client";

type AuditLogWithUser = AuditLog & { user: User };

export function AuditHistoryTab({ logs }: { logs: AuditLogWithUser[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No audit history.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {logs.map((log) => (
        <div key={log.id} className="flex flex-col gap-1 border-b pb-3 last:border-0 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{log.action.replace(/_/g, " ")}</span>
            <span className="text-xs text-muted-foreground shrink-0">{formatDateTime(log.timestamp)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {log.user?.name ?? "System"}
            {log.reason ? ` · ${log.reason}` : ""}
          </p>
          {(log.oldValue || log.newValue) && (
            <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">
              {JSON.stringify({ old: log.oldValue, new: log.newValue }, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
