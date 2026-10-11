import { createHash } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";

import { getAnthropicClient } from "@/lib/ai/client";
import { getOpenAiClient, getSummaryModel } from "@/lib/ai/openai";

/**
 * The provider switch (AI_PROVIDER / AGENT_MODEL) and the vendor adapters. Part of the AI gateway: application code must
 * not import this to make a model call; it goes through `callModel` (src/lib/ai/gateway), which a CI check enforces.
 */

export type ToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };
export type ToolUse = { id: string; name: string; input: unknown };
export type ChatBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };
export type ChatMessage = { role: "user" | "assistant"; content: string | ChatBlock[] };

export type LlmRequest = {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs?: number;
  /** Conversation turns. When present they replace `user`. */
  messages?: ChatMessage[];
  tools?: ToolDef[];
  /** Force one tool (structured output). */
  toolChoice?: { name: string };
  /** Vendor-level retries. Default 1 (unchanged); the gateway sets 0 and retries itself, with backoff. */
  maxRetries?: number;
  /** Overrides the provider's default model for this call. */
  model?: string;
  /**
   * Tells the gateway adapter what this call is for. Ignored by the raw providers. A call that arrives at the gateway
   * adapter without a purpose is refused.
   */
  gateway?: { purpose: string; subject?: { type: string; id: string; knownNames?: string[] }; correlationId?: string; causationId?: string };
};
export type LlmResponse = { text: string; model: string; inputTokens: number; outputTokens: number; toolUses?: ToolUse[]; stopReason?: string; blocks?: ChatBlock[] };

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

function toAnthropicBlocks(blocks: ChatBlock[]): Anthropic.ContentBlockParam[] {
  return blocks.map((b): Anthropic.ContentBlockParam => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, ...(b.isError ? { is_error: true } : {}) };
  });
}

class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  /** With no key given the shared client (environment key) is used; with one, a client of its own. */
  constructor(private readonly model: string, private readonly apiKey?: string) {}
  private client: Anthropic | null = null;
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const client = this.apiKey ? (this.client ??= new Anthropic({ apiKey: this.apiKey })) : getAnthropicClient();
    const model = req.model ?? this.model;
    const messages: Anthropic.MessageParam[] = req.messages
      ? req.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : toAnthropicBlocks(m.content) }))
      : [{ role: "user", content: req.user }];
    const res = await client.messages.create({
      model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages,
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })) } : {}),
      ...(req.toolChoice ? { tool_choice: { type: "tool" as const, name: req.toolChoice.name } } : {}),
    }, { timeout: req.timeoutMs ?? 60_000, maxRetries: req.maxRetries ?? 1 });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const toolUses = res.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input as unknown }] : []));
    const blocks = res.content.flatMap((b): ChatBlock[] => (b.type === "text" ? [{ type: "text", text: b.text }] : b.type === "tool_use" ? [{ type: "tool_use", id: b.id, name: b.name, input: b.input as unknown }] : []));
    return { text, model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, toolUses, stopReason: res.stop_reason ?? undefined, blocks };
  }
}

class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  constructor(private readonly model: string) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (req.tools?.length || req.toolChoice || req.messages) throw new Error("The openai provider does not support tools or multi-turn requests here.");
    const model = req.model ?? this.model;
    const completion = await getOpenAiClient().chat.completions.create(
      { model, messages: [...(req.system ? [{ role: "system" as const, content: req.system }] : []), { role: "user" as const, content: req.user }], max_completion_tokens: req.maxTokens },
      { timeout: req.timeoutMs ?? 60_000, maxRetries: req.maxRetries ?? 1 },
    );
    return { text: completion.choices[0]?.message?.content ?? "", model, inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 };
  }
}

type FakeStructured = { text?: string; toolUses?: ToolUse[]; stopReason?: string; inputTokens?: number; outputTokens?: number; model?: string };
type FakeReply = string | Error | FakeStructured;

/** Test double. Pass one reply, or a function to answer differently per call. Offline and deterministic. */
export class FakeProvider implements LlmProvider {
  readonly name = "fake";
  readonly calls: LlmRequest[] = [];
  constructor(private readonly reply: FakeReply | ((req: LlmRequest) => FakeReply)) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const out = typeof this.reply === "function" ? this.reply(req) : this.reply;
    if (out instanceof Error) throw out;
    if (typeof out === "string") return { text: out, model: "fake", inputTokens: 0, outputTokens: 0 };
    const blocks: ChatBlock[] = [...(out.text ? [{ type: "text" as const, text: out.text }] : []), ...(out.toolUses ?? []).map((t) => ({ type: "tool_use" as const, ...t }))];
    return { text: out.text ?? "", model: out.model ?? "fake", inputTokens: out.inputTokens ?? 0, outputTokens: out.outputTokens ?? 0, toolUses: out.toolUses, stopReason: out.stopReason, blocks };
  }
}

/**
 * AI_PROVIDER=fake: a deterministic local stand-in for demos and offline runs. The same request always gives the same reply, and
 * token counts come from text length. Never selectable in production (the gateway refuses it there).
 */
class DemoProvider implements LlmProvider {
  readonly name = "fake";
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const input = `${req.system}\n${req.messages ? JSON.stringify(req.messages) : req.user}`;
    const tag = createHash("sha256").update(input).digest("hex").slice(0, 8);
    const text = `[demo ${tag}] This is a deterministic stand-in reply; no model was called.`;
    return { text, model: "fake", inputTokens: Math.ceil(input.length / 4), outputTokens: Math.ceil(text.length / 4) };
  }
}

/** Builds one provider by name. The gateway uses this so a purpose can pin a provider and a model. */
export function createProvider(name: string, model: string, apiKey?: string): LlmProvider {
  if (name === "anthropic") return new AnthropicProvider(model, apiKey);
  if (name === "openai") return new OpenAiProvider(model);
  if (name === "fake") return new DemoProvider();
  throw new Error(`Unknown AI_PROVIDER "${name}"`);
}

const defaultModel = (name: string, env: NodeJS.ProcessEnv) =>
  env.AGENT_MODEL ?? (name === "openai" ? (env.OPENAI_SUMMARY_MODEL || getSummaryModel()) : "claude-sonnet-5-5");

export function getProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const name = env.AI_PROVIDER ?? "anthropic";
  return createProvider(name, defaultModel(name, env));
}

/** Same provider as `getProvider`, but with a key handed in (the one an Admin saved in Settings) instead of the environment's. */
export function getProviderWithKey(apiKey: string, env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const name = env.AI_PROVIDER ?? "anthropic";
  if (name !== "anthropic") throw new Error(`Unknown AI_PROVIDER "${name}"`);
  return createProvider(name, defaultModel(name, env), apiKey);
}
