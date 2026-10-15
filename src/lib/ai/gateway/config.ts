import type { Env } from "./types";

/** Is there a key for this provider? Presence only; never reads or returns the value. The SDK clients live behind the provider switch. */
export function isProviderConfigured(provider: string, env: Env = process.env): boolean {
  if (provider === "anthropic") return Boolean(env.ANTHROPIC_API_KEY);
  if (provider === "openai") return Boolean(env.OPENAI_API_KEY);
  return provider === "fake";
}

export const isAnthropicConfigured = (env: Env = process.env) => isProviderConfigured("anthropic", env);
export const isOpenAiConfigured = (env: Env = process.env) => isProviderConfigured("openai", env);

/** Production means a deployed environment. The budget rule and the demo provider's refusal both read this. */
export const isProduction = (env: Env = process.env) => env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
