import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils/format";

export default async function ContactsPage() {
  await requireUser();

  const contacts = await prisma.contact.findMany({
    include: { _count: { select: { deals: true, leads: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contacts</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Deals</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell className="font-medium">{contact.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{contact.email ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{contact.phone ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{contact.company ?? "—"}</TableCell>
                <TableCell className="text-sm">{contact._count.deals}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(contact.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {contacts.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No contacts yet. Convert a lead to create one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
