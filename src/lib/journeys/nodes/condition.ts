import type { Client } from "@/generated/prisma/client";
import type { ConditionNodeData } from "@/lib/journeys/types";

function getField(client: Client, context: Record<string, unknown>, field: string): unknown {
  if (field.startsWith("context.")) {
    return context[field.slice("context.".length)];
  }
  const clientRecord = client as unknown as Record<string, unknown>;
  return clientRecord[field];
}

export function evaluateCondition(
  data: ConditionNodeData,
  client: Client,
  context: Record<string, unknown>,
): boolean {
  const fieldValue = getField(client, context, data.field);

  switch (data.operator) {
    case "exists":
      return fieldValue !== undefined && fieldValue !== null && fieldValue !== "";
    case "not_exists":
      return fieldValue === undefined || fieldValue === null || fieldValue === "";
    case "equals":
      return fieldValue === data.value;
    case "not_equals":
      return fieldValue !== data.value;
    default:
      return false;
  }
}
