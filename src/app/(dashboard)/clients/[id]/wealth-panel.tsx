"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  computeAssetAllocation,
  computeConcentrationRisk,
  computeHoldingDuplication,
  computeRiskAlignment,
  type PositionForAnalytics,
} from "@/lib/wealth/portfolio-analytics";
import { updateWealthHealthCheckupAction, updateSmartAllvestProfileAction, updatePmsAifHoldingAction } from "./wealth-actions";
import { formatDate, formatNumber } from "@/lib/utils/format";

export type HoldingRow = {
  id: string;
  productId: string;
  tradingAccountId: string;
  quantity: number;
  currentValue: number | null;
  asOfDate: Date;
  product: { name: string; productCode: string; category: PositionForAnalytics["product"]["category"] };
  account: { accountNumber: string; accountType: string };
};

export type WealthHealthCheckupData = {
  status: string;
  reportUrl: string | null;
  keyFindings: string | null;
  completedAt: Date | null;
} | null;

export type SmartAllvestProfileData = {
  status: string;
  investorRiskProfile: string | null;
  investmentHorizonYears: number | null;
  liquidityRequirement: string | null;
  goals: { goal: string }[] | null;
} | null;

export type PmsAifHoldingData = {
  productName: string;
  status: string;
  amount: number | null;
  investedDate: Date | null;
  remarks: string | null;
};

function formatInr(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

const STATUS_OPTIONS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"];
const PMS_AIF_PRODUCTS = ["PMS (Allvest)", "PMS (Walfort)", "AIF II", "AIF III"];
const PMS_AIF_STATUS_OPTIONS = ["NOT_INVESTED", "INVESTED", "REDEEMED"];

function HoldingsTable({ holdings }: { holdings: HoldingRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Product</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead>Current Value</TableHead>
          <TableHead>As Of</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody striped>
        {holdings.map((h) => (
          <TableRow key={h.id}>
            <TableCell className="font-mono text-sm">
              {h.account.accountNumber}
              <Badge variant="outline" className="ml-2">
                {h.account.accountType}
              </Badge>
            </TableCell>
            <TableCell className="text-sm">
              {h.product.name}
              <span className="ml-2 font-mono text-xs text-muted-foreground">{h.product.productCode}</span>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{h.product.category}</TableCell>
            <TableCell className="text-sm">{formatNumber(h.quantity)}</TableCell>
            <TableCell className="text-sm font-medium">{h.currentValue != null ? formatInr(h.currentValue) : "—"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(h.asOfDate)}</TableCell>
          </TableRow>
        ))}
        {holdings.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
              No holdings on file for this client yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function PortfolioAnalyticsCard({ holdings, riskProfile }: { holdings: PositionForAnalytics[]; riskProfile: string | null }) {
  const allocation = computeAssetAllocation(holdings);
  const concentration = computeConcentrationRisk(allocation);
  const duplication = computeHoldingDuplication(holdings);
  const alignment = computeRiskAlignment(riskProfile, allocation);
  const totalValue = allocation.reduce((sum, row) => sum + row.value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Portfolio Analytics</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {totalValue === 0 ? (
          <p className="text-sm text-muted-foreground">No holdings yet to analyze.</p>
        ) : (
          <>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Asset Allocation</p>
              <div className="flex flex-col gap-1">
                {allocation
                  .filter((row) => row.value > 0)
                  .map((row) => (
                    <div key={row.bucket} className="flex items-center justify-between text-sm">
                      <span>{row.bucket}</span>
                      <span className="text-muted-foreground">
                        {formatInr(row.value)} · {row.pct}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground">Concentration risk:</span>
              <Badge variant={concentration.label === "Concentrated" ? "destructive" : concentration.label === "Moderate" ? "warning" : "success"}>
                {concentration.label} (HHI {concentration.hhi})
              </Badge>
            </div>

            <div className="flex flex-col gap-1 border-t pt-3">
              <span className="text-xs text-muted-foreground">Risk-profile alignment</span>
              <p className={`text-sm ${alignment.aligned === false ? "text-destructive" : ""}`}>{alignment.message}</p>
            </div>

            {duplication.length > 0 && (
              <div className="flex flex-col gap-1 border-t pt-3">
                <span className="text-xs text-muted-foreground">Same product held across multiple accounts</span>
                {duplication.map((d) => (
                  <p key={d.productId} className="text-sm">
                    {d.productName} — {d.accountCount} accounts
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function WealthHealthCheckupCard({ clientId, checkup }: { clientId: string; checkup: WealthHealthCheckupData }) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(checkup?.status ?? "NOT_STARTED");

  async function handleSubmit(formData: FormData) {
    formData.set("clientId", clientId);
    setPending(true);
    try {
      await updateWealthHealthCheckupAction(formData);
      toast.success("Wealth Health Checkup updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Wealth Health Checkup</CardTitle>
        <Badge variant={status === "COMPLETED" ? "success" : status === "IN_PROGRESS" ? "warning" : "outline"}>
          {status.replace(/_/g, " ")}
        </Badge>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="whc-status">Status</FieldLabel>
              <Select name="status" value={status} onValueChange={(v) => v && setStatus(v)}>
                <SelectTrigger id="whc-status" className="w-full">
                  <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="whc-report">Report URL</FieldLabel>
              <Input id="whc-report" name="reportUrl" defaultValue={checkup?.reportUrl ?? ""} />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="whc-findings">Key Findings</FieldLabel>
              <Textarea id="whc-findings" name="keyFindings" defaultValue={checkup?.keyFindings ?? ""} rows={3} />
            </Field>
          </FieldGroup>
          <Button type="submit" size="sm" disabled={pending} className="self-start">
            {pending ? "Saving..." : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SmartAllvestProfileCard({ clientId, profile }: { clientId: string; profile: SmartAllvestProfileData }) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(profile?.status ?? "NOT_STARTED");
  const [riskProfile, setRiskProfile] = useState(profile?.investorRiskProfile ?? "");

  async function handleSubmit(formData: FormData) {
    formData.set("clientId", clientId);
    setPending(true);
    try {
      await updateSmartAllvestProfileAction(formData);
      toast.success("Smart Allvest profile updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Smart Allvest Profile</CardTitle>
        <Badge variant={status === "COMPLETED" ? "success" : status === "IN_PROGRESS" ? "warning" : "outline"}>
          {status.replace(/_/g, " ")}
        </Badge>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="sap-status">Status</FieldLabel>
              <Select name="status" value={status} onValueChange={(v) => v && setStatus(v)}>
                <SelectTrigger id="sap-status" className="w-full">
                  <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="sap-risk">Investor Risk Profile</FieldLabel>
              <Select name="investorRiskProfile" value={riskProfile} onValueChange={(v) => setRiskProfile(v ?? "")}>
                <SelectTrigger id="sap-risk" className="w-full">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  {["Conservative", "Moderate", "Aggressive"].map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="sap-horizon">Investment Horizon (years)</FieldLabel>
              <Input id="sap-horizon" name="investmentHorizonYears" type="number" min="1" defaultValue={profile?.investmentHorizonYears ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="sap-liquidity">Liquidity Requirement</FieldLabel>
              <Input id="sap-liquidity" name="liquidityRequirement" defaultValue={profile?.liquidityRequirement ?? ""} />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="sap-goals">Goals (one per line)</FieldLabel>
              <Textarea
                id="sap-goals"
                name="goals"
                rows={3}
                defaultValue={profile?.goals?.map((g) => g.goal).join("\n") ?? ""}
                placeholder="Retirement corpus&#10;Child's education"
              />
            </Field>
          </FieldGroup>
          <Button type="submit" size="sm" disabled={pending} className="self-start">
            {pending ? "Saving..." : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PmsAifRow({ clientId, productName, holding }: { clientId: string; productName: string; holding: PmsAifHoldingData | null }) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(holding?.status ?? "NOT_INVESTED");

  async function handleSubmit(formData: FormData) {
    formData.set("clientId", clientId);
    formData.set("productName", productName);
    setPending(true);
    try {
      await updatePmsAifHoldingAction(formData);
      toast.success(`${productName} updated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit} className="grid grid-cols-1 items-end gap-3 border-t pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto]">
      <Field>
        <FieldLabel>Product</FieldLabel>
        <p className="text-sm font-medium">{productName}</p>
      </Field>
      <Field>
        <FieldLabel htmlFor={`pms-status-${productName}`}>Status</FieldLabel>
        <Select name="status" value={status} onValueChange={(v) => v && setStatus(v)}>
          <SelectTrigger id={`pms-status-${productName}`} className="w-full">
            <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PMS_AIF_STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`pms-amount-${productName}`}>Amount (₹)</FieldLabel>
        <Input id={`pms-amount-${productName}`} name="amount" type="number" min="0" defaultValue={holding?.amount ?? ""} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`pms-date-${productName}`}>Invested Date</FieldLabel>
        <Input
          id={`pms-date-${productName}`}
          name="investedDate"
          type="date"
          defaultValue={holding?.investedDate ? holding.investedDate.toISOString().slice(0, 10) : ""}
        />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}

function PmsAifSection({ clientId, holdings }: { clientId: string; holdings: PmsAifHoldingData[] }) {
  const holdingByProduct = new Map(holdings.map((h) => [h.productName, h]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">PMS &amp; AIF Holdings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {PMS_AIF_PRODUCTS.map((productName) => (
          <PmsAifRow key={productName} clientId={clientId} productName={productName} holding={holdingByProduct.get(productName) ?? null} />
        ))}
      </CardContent>
    </Card>
  );
}

export function WealthPanel({
  clientId,
  holdings,
  checkup,
  profile,
  pmsAifHoldings,
}: {
  clientId: string;
  holdings: HoldingRow[];
  checkup: WealthHealthCheckupData;
  profile: SmartAllvestProfileData;
  pmsAifHoldings: PmsAifHoldingData[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Portfolio Holdings</CardTitle>
        </CardHeader>
        <CardContent>
          <HoldingsTable holdings={holdings} />
        </CardContent>
      </Card>

      <PortfolioAnalyticsCard holdings={holdings} riskProfile={profile?.investorRiskProfile ?? null} />

      <PmsAifSection clientId={clientId} holdings={pmsAifHoldings} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WealthHealthCheckupCard clientId={clientId} checkup={checkup} />
        <SmartAllvestProfileCard clientId={clientId} profile={profile} />
      </div>
    </div>
  );
}
