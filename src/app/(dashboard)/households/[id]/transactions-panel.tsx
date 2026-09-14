import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/utils/format";

type SerializedTransaction = {
  transaction: {
    id: string;
    transactionType: string;
    transactionDate: Date;
    quantity: number | null;
    price: number | null;
    grossAmount: number;
    netAmount: number | null;
    product: { name: string; productCode: string } | null;
  };
  account: { accountNumber: string };
};

export function TransactionsPanel({ transactions }: { transactions: SerializedTransaction[] }) {
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Gross Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {transactions.map(({ transaction, account }) => (
              <TableRow key={transaction.id}>
                <TableCell className="text-xs text-muted-foreground">{formatDate(transaction.transactionDate)}</TableCell>
                <TableCell className="font-mono text-sm">{account.accountNumber}</TableCell>
                <TableCell>
                  <Badge variant="outline">{transaction.transactionType.replace(/_/g, " ")}</Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {transaction.product ? (
                    <>
                      {transaction.product.name}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{transaction.product.productCode}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-sm">{transaction.quantity != null ? formatNumber(transaction.quantity) : "—"}</TableCell>
                <TableCell className="text-sm">{transaction.price != null ? `₹${formatNumber(transaction.price)}` : "—"}</TableCell>
                <TableCell className="text-sm font-medium">₹{formatNumber(transaction.grossAmount)}</TableCell>
              </TableRow>
            ))}
            {transactions.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No transactions on file.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
