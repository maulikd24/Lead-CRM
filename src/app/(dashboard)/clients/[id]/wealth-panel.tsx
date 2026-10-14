"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PhoneSheet } from "@/components/workspace";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateWealthHealthCheckupAction, updateSmartAllvestProfileAction } from "./wealth-actions";

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

const STATUS_OPTIONS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"];

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

/**
 * The Wealth tab: the health checkup and the Smart Allvest profile. Holdings, PMS/AIF positions and trades are not shown on this page
 * for any role; the portfolio summary (name, total AUM, mix, last trading date) is on the Overview.
 */
export function WealthPanel({ clientId, checkup, profile }: { clientId: string; checkup: WealthHealthCheckupData; profile: SmartAllvestProfileData }) {
  return (
    <PhoneSheet name="checkup" title="Health checkup and profile" summary={`Checkup ${(checkup?.status ?? "NOT_STARTED").replace(/_/g, " ").toLowerCase()} · profile ${(profile?.status ?? "NOT_STARTED").replace(/_/g, " ").toLowerCase()}`}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WealthHealthCheckupCard clientId={clientId} checkup={checkup} />
        <SmartAllvestProfileCard clientId={clientId} profile={profile} />
      </div>
    </PhoneSheet>
  );
}
