"use client";

import { useState } from "react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OverviewPanel } from "./overview-panel";
import { HoldingsPanel } from "./holdings-panel";
import { TransactionsPanel } from "./transactions-panel";
import type { Household, HouseholdMember, Client } from "@/generated/prisma/client";

type HouseholdWithMembers = Household & {
  members: (HouseholdMember & { client: Pick<Client, "id" | "name" | "clientCode" | "assignedToId"> })[];
};

type SerializedPosition = {
  position: {
    id: string;
    productId: string;
    quantity: number;
    avgCost: number | null;
    currentValue: number | null;
    asOfDate: Date;
    product: { name: string; productCode: string; category: string };
  };
  account: { id: string; accountNumber: string; accountType: string };
};

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
  account: { id: string; accountNumber: string; accountType: string };
};

export function HouseholdDetailTabs({
  household,
  accountCount,
  positions,
  transactions,
}: {
  household: HouseholdWithMembers;
  accountCount: number;
  positions: SerializedPosition[];
  transactions: SerializedTransaction[];
}) {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <Tabs value={activeTab} onValueChange={(v) => v && setActiveTab(v)}>
      <TabsList variant="line" className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="holdings">Holdings</TabsTrigger>
        <TabsTrigger value="transactions">Transactions</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="pt-4">
        <OverviewPanel household={household} accountCount={accountCount} />
      </TabsContent>

      <TabsContent value="holdings" className="pt-4">
        <HoldingsPanel positions={positions} />
      </TabsContent>

      <TabsContent value="transactions" className="pt-4">
        <TransactionsPanel transactions={transactions} />
      </TabsContent>
    </Tabs>
  );
}
