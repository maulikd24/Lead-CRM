"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import type { IntegrationConfig } from "@/generated/prisma/client";
import {
  setIntegrationModeAction,
  saveIntegrationCredentialsAction,
  testIntegrationConnectionAction,
  markPartnerContractVerifiedAction,
} from "./actions";
import { CONTRACT_VERSION, isContractVerified } from "@/lib/partners/contract";

type Meta = {
  label: string;
  description: string;
  fields: { key: string; label: string; placeholder?: string }[];
  supportsTest?: boolean;
};

export function IntegrationCard({
  provider,
  meta,
  config,
}: {
  provider: string;
  meta: Meta;
  config: IntegrationConfig | null;
}) {
  const [mode, setMode] = useState(config?.mode ?? "mock");
  const [values, setValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function handleModeToggle(checked: boolean) {
    const next = checked ? "live" : "mock";
    setMode(next);
    try {
      await setIntegrationModeAction(provider, next);
      toast.success(`${meta.label} set to ${next} mode`);
    } catch (error) {
      setMode(mode);
      toast.error(error instanceof Error ? error.message : "Failed to update mode");
    }
  }

  async function handleSaveCredentials() {
    setPending(true);
    try {
      await saveIntegrationCredentialsAction(provider, values);
      toast.success("Credentials saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save credentials");
    } finally {
      setPending(false);
    }
  }

  async function handleTestConnection() {
    setPending(true);
    setTestResult(null);
    try {
      const result = await testIntegrationConnectionAction(provider);
      setTestResult(result);
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : "Test failed" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base">{meta.label}</CardTitle>
          <CardDescription>{meta.description}</CardDescription>
        </div>
        <Badge variant={mode === "live" ? "default" : "outline"}>{mode === "live" ? "Live" : "Mock"}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Switch checked={mode === "live"} onCheckedChange={handleModeToggle} />
          <span className="text-sm">Use live credentials</span>
        </div>

        {mode === "live" && (
          <FieldGroup>
            {meta.fields.map((field) => (
              <Field key={field.key}>
                <FieldLabel htmlFor={`${provider}-${field.key}`}>{field.label}</FieldLabel>
                <Input
                  id={`${provider}-${field.key}`}
                  type="password"
                  placeholder={field.placeholder}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                />
              </Field>
            ))}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveCredentials} disabled={pending}>
                Save Credentials
              </Button>
              {meta.supportsTest && (
                <Button size="sm" variant="outline" onClick={handleTestConnection} disabled={pending}>
                  Test Connection
                </Button>
              )}
            </div>
            {!meta.supportsTest && (
              <p className="text-xs text-muted-foreground">
                Save credentials, then send a test message from any lead to verify.
              </p>
            )}
            {testResult && (
              <p className={`text-xs ${testResult.ok ? "text-green-600" : "text-destructive"}`}>
                {testResult.ok ? "Connection OK" : testResult.message}
              </p>
            )}
          </FieldGroup>
        )}

        {provider === "referral_api" && (
          <ContractStatus settings={(config?.settings as Record<string, unknown> | null) ?? null} />
        )}

        {mode === "mock" && meta.supportsTest && (
          <Button size="sm" variant="outline" onClick={handleTestConnection} disabled={pending}>
            Test Mock Connection
          </Button>
        )}
        {mode === "mock" && !meta.supportsTest && (
          <p className="text-xs text-muted-foreground">
            Mock mode active — sends and receives are simulated, no test needed.
          </p>
        )}
        {mode === "mock" && meta.supportsTest && testResult && (
          <p className={`text-xs ${testResult.ok ? "text-green-600" : "text-destructive"}`}>
            {testResult.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ContractStatus({ settings }: { settings: Record<string, unknown> | null }) {
  const [pending, setPending] = useState(false);
  const verified = isContractVerified(settings);
  const at = typeof settings?.contractVerifiedAt === "string" ? settings.contractVerifiedAt : null;

  async function mark() {
    setPending(true);
    try {
      await markPartnerContractVerifiedAction({ confirm: true });
      toast.success("Contract marked as verified");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record verification");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-xs">
      <p>
        Contract: {verified ? "verified" : "not verified"}
        {at && verified ? ` on ${new Date(at).toLocaleDateString("en-IN")}` : ""} (version {CONTRACT_VERSION})
      </p>
      {!verified && (
        <p className="text-muted-foreground">
          Run scripts/partner-contract-check.ts against the service, read its result, then record it here. Changing the saved details or the contract version clears this.
        </p>
      )}
      <Button size="sm" variant="outline" className="w-fit" onClick={mark} disabled={pending}>
        Mark contract verified
      </Button>
    </div>
  );
}
