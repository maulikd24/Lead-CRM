/**
 * The Attention Engine 'Needs attention' feed on Today (and the Marketing anomaly page). Off unless NEXT_PUBLIC_ATTENTION_ENGINE is exactly "1" (build-time).
 * With the flag off the existing Today tabs, including the outcomes "Needs attention" tab, are exactly as they were.
 */
export const ATTENTION_ENGINE_FLAG = "NEXT_PUBLIC_ATTENTION_ENGINE";
export const attentionEngineEnabled = (env?: Record<string, string | undefined>): boolean => (env ? env[ATTENTION_ENGINE_FLAG] : process.env.NEXT_PUBLIC_ATTENTION_ENGINE) === "1";
