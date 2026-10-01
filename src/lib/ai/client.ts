import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Lazily-initialized singleton — ANTHROPIC_API_KEY is read once, on first use, so a missing key
 * only breaks the one feature that needs it rather than crashing the whole app at import time. */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
