"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MessageTemplate } from "@/generated/prisma/client";
import { sendLeadMessageAction } from "../actions";

export function SendMessagePanel({ leadId, templates }: { leadId: string; templates: MessageTemplate[] }) {
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [templateId, setTemplateId] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const channelTemplates = useMemo(
    () => templates.filter((t) => t.channel === channel && t.approved),
    [templates, channel],
  );
  const selectedTemplate = channelTemplates.find((t) => t.id === templateId) ?? null;
  const templateVariables = (selectedTemplate?.variables as string[] | null) ?? [];

  async function handleSend() {
    if (!templateId) {
      toast.error("Select a template first");
      return;
    }
    setPending(true);
    try {
      await sendLeadMessageAction(leadId, channel, templateId, variables);
      toast.success("Message sent");
      setVariables({});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Send Message</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel>Channel</FieldLabel>
          <Select
            value={channel}
            onValueChange={(v) => {
              if (!v) return;
              setChannel(v as "whatsapp" | "sms");
              setTemplateId("");
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => (v === "whatsapp" ? "WhatsApp" : "SMS")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel>Template</FieldLabel>
          <Select value={templateId} onValueChange={(v) => v && setTemplateId(v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select an approved template">
                {(v: string) => channelTemplates.find((t) => t.id === v)?.name ?? "Select an approved template"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {channelTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {channelTemplates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No approved {channel} templates yet — add one in Settings &gt; Templates.
            </p>
          )}
        </Field>

        {templateVariables.length > 0 && (
          <FieldGroup>
            {templateVariables.map((varName) => (
              <Field key={varName}>
                <FieldLabel htmlFor={`var-${varName}`}>{varName}</FieldLabel>
                <Input
                  id={`var-${varName}`}
                  value={variables[varName] ?? ""}
                  onChange={(e) => setVariables((v) => ({ ...v, [varName]: e.target.value }))}
                />
              </Field>
            ))}
          </FieldGroup>
        )}

        <Button size="sm" onClick={handleSend} disabled={pending || !templateId}>
          {pending ? "Sending..." : "Send"}
        </Button>
      </CardContent>
    </Card>
  );
}
