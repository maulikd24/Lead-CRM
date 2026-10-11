/** The AI gateway's public surface. Application code imports from here, never from a model SDK or the provider factories. */
import { callModel as callModelWith } from "./gateway";
import type { CallInput, GatewayDeps, GatewayResult } from "./types";
import { defaultGatewayDeps } from "./wiring";

export { GatewayProvider, GatewayRefusal, gatewayProvider } from "./adapter";
export { isAnthropicConfigured, isOpenAiConfigured, isProviderConfigured } from "./config";
export { describeRefusal } from "./refusal";
export { PURPOSES, getPurpose, type PurposeDef } from "./purposes";
export { redact, scrub, scrubForVendor } from "./redact";
export * from "./types";

/** Calls a model through the gateway with the production wiring. Pass `deps` only in tests. */
export function callModel(input: CallInput, deps: GatewayDeps = defaultGatewayDeps()): Promise<GatewayResult> {
  return callModelWith(input, deps);
}
