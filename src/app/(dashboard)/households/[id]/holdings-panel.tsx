import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/utils/format";

type SerializedPosition = {
  position: {
    id: string;
    quantity: number;
    avgCost: number | null;
    currentValue: number | null;
    asOfDate: Date;
    product: { name: string; productCode: string; category: string };
  };
  account: { accountNumber: string; accountType: string };
};

export function HoldingsPanel({ positions }: { positions: SerializedPosition[] }) {
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Avg Cost</TableHead>
              <TableHead>Current Value</TableHead>
              <TableHead>As Of</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {positions.map(({ position, account }) => (
              <TableRow key={position.id}>
                <TableCell className="font-mono text-sm">
                  {account.accountNumber}
                  <Badge variant="outline" className="ml-2">
                    {account.accountType}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {position.product.name}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{position.product.productCode}</span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{position.product.category}</TableCell>
                <TableCell className="text-sm">{formatNumber(position.quantity)}</TableCell>
                <TableCell className="text-sm">{position.avgCost != null ? `₹${formatNumber(position.avgCost)}` : "—"}</TableCell>
                <TableCell className="text-sm font-medium">
                  {position.currentValue != null ? `₹${formatNumber(position.currentValue)}` : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(position.asOfDate)}</TableCell>
              </TableRow>
            ))}
            {positions.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No holdings on file.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
