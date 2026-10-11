// Engine switches. NBA_ENGINE_V2 computes and stores decisions in SHADOW (nothing is shown by it). The AgentSetting row "nba_engine" is the
// kill switch (same convention as the agents: the env flag AND an enabled row). The visibility flags are separate and only matter to screens.
export const ENGINE_FLAG = "NBA_ENGINE_V2";
export const KILL_SWITCH_KEY = "nba_engine";
export const DRAWER_FLAG = "NEXT_PUBLIC_DECISION_DRAWER";
export const RM_FLAG = "NBA_RM_VISIBLE";

type Env = Record<string, string | undefined>;

/** Pure: the flag. The kill switch row is checked by `engineEnabled`. */
export const engineFlagOn = (env: Env = process.env) => env[ENGINE_FLAG] === "1";
export const rmVisible = (env: Env = process.env) => env[RM_FLAG] === "1";
/** Build-time (inlined) in the browser bundle; read by its literal name. */
export const drawerFlagOn = (env?: Env) => (env ? env[DRAWER_FLAG] : process.env.NEXT_PUBLIC_DECISION_DRAWER) === "1";

export async function engineEnabled(env: Env, lookup: (agentKey: string) => Promise<{ enabled: boolean } | null>): Promise<boolean> {
  if (!engineFlagOn(env)) return false;
  return (await lookup(KILL_SWITCH_KEY))?.enabled === true;
}
