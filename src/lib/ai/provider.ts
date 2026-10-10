import Anthropic from "@anthropic-ai/sdk";

import { getAnthropicClient } from "@/lib/ai/client";

export type LlmRequest = { system: string; user: string; maxTokens: number; timeoutMs?: number };
export type LlmResponse = { text: string; model: string; inputTokens: number; outputTokens: number };

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  /** With no key given the shared client (environment key) is used; with one, a client of its own. */
  constructor(private readonly model: string, private readonly apiKey?: string) {}
  private client: Anthropic | null = null;
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const client = this.apiKey ? (this.client ??= new Anthropic({ apiKey: this.apiKey })) : getAnthropicClient();
    const res = await client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    }, { timeout: req.timeoutMs ?? 60_000, maxRetries: 1 });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { text, model: this.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }
}

type FakeReply = string | Error;

/** Test double. Pass one reply, or a function to answer differently per call. */
export class FakeProvider implements LlmProvider {
  readonly name = "fake";
  readonly calls: LlmRequest[] = [];
  constructor(private readonly reply: FakeReply | ((req: LlmRequest) => FakeReply)) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const out = typeof this.reply === "function" ? this.reply(req) : this.reply;
    if (out instanceof Error) throw out;
    return { text: out, model: "fake", inputTokens: 0, outputTokens: 0 };
  }
}

export function getProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const name = env.AI_PROVIDER ?? "anthropic";
  if (name === "anthropic") return new AnthropicProvider(env.AGENT_MODEL ?? "claude-sonnet-5-5");
  throw new Error(`Unknown AI_PROVIDER "${name}"`);
}

/** Same provider as `getProvider`, but with a key handed in (the one an Admin saved in Settings) instead of the environment's. */
export function getProviderWithKey(apiKey: string, env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const name = env.AI_PROVIDER ?? "anthropic";
  if (name === "anthropic") return new AnthropicProvider(env.AGENT_MODEL ?? "claude-sonnet-5-5", apiKey);
  throw new Error(`Unknown AI_PROVIDER "${name}"`);
}
