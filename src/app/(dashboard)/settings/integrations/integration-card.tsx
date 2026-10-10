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
} from "./actions";
import { clearDraft, readDraft, writeDraft } from "./credential-drafts";
import { IdentityCoverage } from "./identity-coverage";
import { StateBadge } from "./status-badge";
import type { IntegrationState } from "@/lib/integrations/overview";
import { motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import type { IdentityCoverage as Coverage } from "@/lib/integrations/clevertap/select-batch";

type Meta = {
  label: string;
  description: string;
  fields: { key: string; label: string; placeholder?: string; plain?: boolean }[];
  supportsTest?: boolean;
};

export function IntegrationCard({
  provider,
  meta,
  config,
  identityCoverage = null,
  status,
  index = 0,
}: {
  provider: string;
  meta: Meta;
  config: IntegrationConfig | null;
  identityCoverage?: Coverage | null;
  /** Connected, needs setup or flag off, with the server switch it is waiting on when that is the reason. */
  status?: { state: IntegrationState; flagName?: string };
  index?: number;
}) {
  const [mode, setMode] = useState(config?.mode ?? "mock");
  // Typed but unsaved credentials survive a tab switch (this card remounts when the tab changes), see credential-drafts.ts.
  const [values, setValues] = useState<Record<string, string>>(() => readDraft(provider));
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
      clearDraft(provider);
      setValues({});
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
    <Card className={cn(motion.enter)} style={{ "--i": index } as React.CSSProperties}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">{meta.label}</CardTitle>
          <CardDescription>{meta.description}</CardDescription>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {status ? <StateBadge state={status.state} /> : <Badge variant={mode === "live" ? "default" : "outline"}>{mode === "live" ? "Live" : "Mock"}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status?.state === "flag_off" && status.flagName && (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            Switched off on the server (<span className="font-mono">{status.flagName}</span>). Nothing runs for this until it is turned on.
          </p>
        )}
        <div className="flex items-center gap-2">
          <Switch checked={mode === "live"} onCheckedChange={handleModeToggle} aria-label={`Use live credentials for ${meta.label}`} />
          <span className="text-sm">Use live credentials</span>
        </div>

        {mode === "live" && (
          <FieldGroup>
            {meta.fields.map((field) => (
              <Field key={field.key}>
                <FieldLabel htmlFor={`${provider}-${field.key}`}>{field.label}</FieldLabel>
                <Input
                  id={`${provider}-${field.key}`}
                  type={field.plain ? "text" : "password"}
                  placeholder={field.placeholder}
                  value={values[field.key] ?? ""}
                  onChange={(e) => {
                    writeDraft(provider, field.key, e.target.value);
                    setValues((v) => ({ ...v, [field.key]: e.target.value }));
                  }}
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
              <p className={`text-xs ${testResult.ok ? "text-success" : "text-destructive"}`}>
                {testResult.ok ? "Connection OK" : testResult.message}
              </p>
            )}
          </FieldGroup>
        )}

        {identityCoverage && <IdentityCoverage coverage={identityCoverage} />}

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
          <p className={`text-xs ${testResult.ok ? "text-success" : "text-destructive"}`}>
            {testResult.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

