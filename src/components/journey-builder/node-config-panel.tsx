"use client";

import type { Node } from "@xyflow/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ActionNodeData,
  ConditionNodeData,
  TriggerNodeData,
  WaitNodeData,
} from "@/lib/journeys/types";

type UserOption = { id: string; name: string };

const TRIGGER_OPTIONS: { value: TriggerNodeData["triggerType"]; label: string }[] = [
  { value: "client_created", label: "Client Created" },
  { value: "stage_changed", label: "Stage Changed" },
  { value: "field_updated", label: "Field Updated" },
  { value: "webhook_received", label: "Webhook Received" },
  { value: "manual_enrollment", label: "Manual Enrollment" },
];

const ACTION_OPTIONS: { value: ActionNodeData["actionType"]; label: string }[] = [
  { value: "create_task", label: "Create Task" },
  { value: "update_client_status", label: "Update Client Status" },
  { value: "reassign_client", label: "Reassign Client" },
  { value: "add_note", label: "Add Note" },
  { value: "notify_manager", label: "Notify Manager" },
  { value: "send_message", label: "Send Message (WhatsApp/SMS)" },
  { value: "call_integration_action", label: "Call Integration" },
];

const CLIENT_STATUSES = ["ON_HOLD", "NOT_PROCEEDING"];

function labelFor<T extends string>(options: { value: T; label: string }[], value: T) {
  return options.find((o) => o.value === value)?.label ?? value;
}

type TemplateOption = { id: string; name: string; channel: string };

export function NodeConfigPanel({
  node,
  users,
  templates,
  onChange,
  onDelete,
  onClose,
}: {
  node: Node;
  users: UserOption[];
  templates: TemplateOption[];
  onChange: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const data = node.data as Record<string, unknown>;

  function update(patch: Record<string, unknown>) {
    onChange({ ...data, ...patch });
  }

  return (
    <div className="w-80 shrink-0 border-l bg-card p-4 flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Configure Node</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {node.type === "trigger" && (
        <FieldGroup>
          <Field>
            <FieldLabel>Trigger</FieldLabel>
            <Select
              value={(data as unknown as TriggerNodeData).triggerType}
              onValueChange={(v) => v && update({ triggerType: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => labelFor(TRIGGER_OPTIONS, v as TriggerNodeData["triggerType"])}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      )}

      {node.type === "action" && (
        <ActionConfigFields
          data={data as unknown as ActionNodeData}
          users={users}
          templates={templates}
          onUpdate={update}
        />
      )}

      {node.type === "condition" && (
        <FieldGroup>
          <Field>
            <FieldLabel>Field</FieldLabel>
            <Input
              value={(data as unknown as ConditionNodeData).field ?? ""}
              onChange={(e) => update({ field: e.target.value })}
              placeholder="status, source, email..."
            />
          </Field>
          <Field>
            <FieldLabel>Operator</FieldLabel>
            <Select
              value={(data as unknown as ConditionNodeData).operator}
              onValueChange={(v) => v && update({ operator: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="equals">equals</SelectItem>
                <SelectItem value="not_equals">not equals</SelectItem>
                <SelectItem value="exists">exists</SelectItem>
                <SelectItem value="not_exists">not exists</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Value</FieldLabel>
            <Input
              value={String((data as unknown as ConditionNodeData).value ?? "")}
              onChange={(e) => update({ value: e.target.value })}
            />
          </Field>
        </FieldGroup>
      )}

      {node.type === "wait" && (
        <FieldGroup>
          <Field>
            <FieldLabel>Wait Type</FieldLabel>
            <Select
              value={(data as unknown as WaitNodeData).waitType}
              onValueChange={(v) => v && update({ waitType: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wait_duration">Wait Duration</SelectItem>
                <SelectItem value="wait_until_condition">Wait Until Condition</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>
              {(data as unknown as WaitNodeData).waitType === "wait_until_condition"
                ? "Poll interval (minutes)"
                : "Duration (minutes)"}
            </FieldLabel>
            <Input
              type="number"
              min={1}
              value={(data as unknown as WaitNodeData).durationMinutes ?? 60}
              onChange={(e) => update({ durationMinutes: Number(e.target.value) })}
            />
          </Field>
          {(data as unknown as WaitNodeData).waitType === "wait_until_condition" && (
            <>
              <Field>
                <FieldLabel>Condition field</FieldLabel>
                <Input
                  value={(data as unknown as WaitNodeData).condition?.field ?? ""}
                  onChange={(e) =>
                    update({
                      condition: {
                        conditionType: "branch_on_field",
                        field: e.target.value,
                        operator: (data as unknown as WaitNodeData).condition?.operator ?? "equals",
                        value: (data as unknown as WaitNodeData).condition?.value,
                      },
                    })
                  }
                  placeholder="status"
                />
              </Field>
              <Field>
                <FieldLabel>Condition value</FieldLabel>
                <Input
                  value={String((data as unknown as WaitNodeData).condition?.value ?? "")}
                  onChange={(e) =>
                    update({
                      condition: {
                        conditionType: "branch_on_field",
                        field: (data as unknown as WaitNodeData).condition?.field ?? "",
                        operator: (data as unknown as WaitNodeData).condition?.operator ?? "equals",
                        value: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Timeout (minutes)</FieldLabel>
                <Input
                  type="number"
                  min={1}
                  value={(data as unknown as WaitNodeData).timeoutMinutes ?? 1440}
                  onChange={(e) => update({ timeoutMinutes: Number(e.target.value) })}
                />
              </Field>
            </>
          )}
        </FieldGroup>
      )}

      {node.type !== "trigger" && (
        <Button variant="destructive" size="sm" onClick={onDelete} className="mt-auto">
          Delete Node
        </Button>
      )}
    </div>
  );
}

function ActionConfigFields({
  data,
  users,
  templates,
  onUpdate,
}: {
  data: ActionNodeData;
  users: UserOption[];
  templates: TemplateOption[];
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const config = data.config ?? {};

  function updateConfig(patch: Record<string, unknown>) {
    onUpdate({ config: { ...config, ...patch } });
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Action</FieldLabel>
        <Select value={data.actionType} onValueChange={(v) => v && onUpdate({ actionType: v, config: {} })}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v: string) => labelFor(ACTION_OPTIONS, v as ActionNodeData["actionType"])}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {data.actionType === "create_task" && (
        <>
          <Field>
            <FieldLabel>Task title</FieldLabel>
            <Input
              value={String(config.title ?? "")}
              onChange={(e) => updateConfig({ title: e.target.value })}
              placeholder="Follow up call"
            />
          </Field>
          <Field>
            <FieldLabel>Due in (minutes)</FieldLabel>
            <Input
              type="number"
              min={1}
              value={Number(config.dueInMinutes ?? 1440)}
              onChange={(e) => updateConfig({ dueInMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field>
            <FieldLabel>Assign to (optional — defaults to client owner)</FieldLabel>
            <Select
              value={String(config.assignedToId ?? "")}
              onValueChange={(v) => updateConfig({ assignedToId: v ?? undefined })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Client owner">
                  {(v: string) => users.find((u) => u.id === v)?.name ?? "Client owner"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}

      {data.actionType === "update_client_status" && (
        <>
          <Field>
            <FieldLabel>New status</FieldLabel>
            <Select value={String(config.status ?? "")} onValueChange={(v) => v && updateConfig({ status: v })}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CLIENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Reason</FieldLabel>
            <Input
              value={String(config.reason ?? "")}
              onChange={(e) => updateConfig({ reason: e.target.value })}
              placeholder="Automated by journey"
            />
          </Field>
        </>
      )}

      {data.actionType === "reassign_client" && (
        <Field>
          <FieldLabel>Reassign to</FieldLabel>
          <Select
            value={String(config.assignedToId ?? "")}
            onValueChange={(v) => v && updateConfig({ assignedToId: v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select user">
                {(v: string) => users.find((u) => u.id === v)?.name ?? "Select user"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {data.actionType === "add_note" && (
        <Field>
          <FieldLabel>Note</FieldLabel>
          <Textarea
            value={String(config.note ?? "")}
            onChange={(e) => updateConfig({ note: e.target.value })}
            rows={3}
          />
        </Field>
      )}

      {data.actionType === "notify_manager" && (
        <Field>
          <FieldLabel>Message (optional)</FieldLabel>
          <Textarea
            value={String(config.message ?? "")}
            onChange={(e) => updateConfig({ message: e.target.value })}
            rows={2}
          />
        </Field>
      )}

      {data.actionType === "send_message" && (
        <>
          <Field>
            <FieldLabel>Channel</FieldLabel>
            <Select
              value={String(config.channel ?? "whatsapp")}
              onValueChange={(v) => v && updateConfig({ channel: v, templateId: undefined })}
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
            {(() => {
              const channel = String(config.channel ?? "whatsapp");
              const channelTemplates = templates.filter((t) => t.channel === channel);
              return (
                <>
                  <Select
                    value={String(config.templateId ?? "")}
                    onValueChange={(v) => v && updateConfig({ templateId: v })}
                  >
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
                      No approved {channel} templates — add one in Settings &gt; Templates.
                    </p>
                  )}
                </>
              );
            })()}
          </Field>
        </>
      )}

      {data.actionType === "call_integration_action" && (
        <>
          <Field>
            <FieldLabel>Provider</FieldLabel>
            <Input
              value={String(config.provider ?? "")}
              onChange={(e) => updateConfig({ provider: e.target.value })}
              placeholder="freshdesk, exotel, clevertap"
            />
          </Field>
          <Field>
            <FieldLabel>Action</FieldLabel>
            <Input
              value={String(config.action ?? "")}
              onChange={(e) => updateConfig({ action: e.target.value })}
              placeholder="createTicket, initiateCall..."
            />
          </Field>
        </>
      )}
    </FieldGroup>
  );
}
