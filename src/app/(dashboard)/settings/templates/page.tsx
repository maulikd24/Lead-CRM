import { MessageSquareText } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { NewTemplateDialog } from "./new-template-dialog";
import { TemplateRowActions } from "./template-row-actions";

export default async function TemplatesSettingsPage() {
  await requireRole(["ADMIN"]);

  const templates = await prisma.messageTemplate.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Message Templates"
        description="Pre-approved WhatsApp/SMS/email templates used across the app."
        actions={<NewTemplateDialog />}
      />
      <Card>
        <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Body</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell className="font-medium">{template.name}</TableCell>
                <TableCell className="text-sm capitalize">{template.channel}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{template.body}</TableCell>
                <TableCell>
                  <Badge variant={template.approved ? "success" : "outline"}>
                    {template.approved ? "Approved" : "Draft"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <TemplateRowActions templateId={template.id} approved={template.approved} />
                </TableCell>
              </TableRow>
            ))}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    icon={MessageSquareText}
                    title="No templates yet"
                    description="WhatsApp requires pre-approved templates registered with your provider — mark them approved here once registered."
                  />
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
