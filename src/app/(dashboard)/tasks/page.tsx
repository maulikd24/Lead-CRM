import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TaskRowActions } from "./task-row-actions";
import { formatDateTime } from "@/lib/utils/format";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  DONE: "secondary",
  OVERDUE: "destructive",
  CANCELLED: "secondary",
};

export default async function TasksPage() {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const tasks = await prisma.task.findMany({
    where: visibleUserIds ? { assignedToId: { in: visibleUserIds } } : undefined,
    include: { lead: true, assignedTo: true },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className={task.status === "DONE" ? "line-through text-muted-foreground" : ""}>
                  {task.title}
                </TableCell>
                <TableCell className="text-sm">
                  <a href={`/leads/${task.leadId}`} className="hover:underline">
                    {task.lead.name}
                  </a>
                </TableCell>
                <TableCell className="text-sm">{task.assignedTo.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(task.dueAt)}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[task.status]}>{task.status}</Badge>
                </TableCell>
                <TableCell>
                  {task.status !== "DONE" && <TaskRowActions taskId={task.id} />}
                </TableCell>
              </TableRow>
            ))}
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No tasks yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
