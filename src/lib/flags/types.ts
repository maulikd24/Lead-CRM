/**
 * Types for the canonical flag registry. One FlagDef per environment name the platform reads. Names only: no secret
 * value, no host and no credential ever belongs in the registry, the docs or the profile templates generated from it.
 */

/** "public" = a NEXT_PUBLIC_* name, inlined into the browser bundle at BUILD time. "server" = read at run time. */
export type Exposure = "public" | "server";

export type Kind =
  | "feature" // turns a screen or job on
  | "safety" // restricts or protects something; off is the permissive state unless the label says otherwise
  | "outbound" // can contact a customer or send data to a vendor
  | "outbound-ai" // outbound or AI-adjacent: can draft or send to a customer using an AI provider
  | "blocked" // standing NOT-YET: rejected in every profile
  | "config" // a value (enum, list, hours, url, path)
  | "secret" // a credential: presence only, never a value
  | "platform" // provided by the host or the framework
  | "test" // tests and tooling only
  | "db-setting"; // lives in the database, listed for visibility, not owned here

export type ValueType = "bool" | "enum" | "int" | "list" | "string" | "url" | "path" | "secret";

/** What kind of data the flag's behaviour touches. */
export type DataClass = "none" | "config" | "credential" | "internal" | "pseudonymous" | "customer-pii";

export type RuleId = "FR-01" | "FR-02" | "FR-03" | "FR-04" | "FR-05" | "FR-10" | "FR-11" | "FR-12" | "FR-13" | "FR-14" | "FR-15" | "FR-16" | "FR-20" | "FR-30" | "FR-31";

export type Context = "production" | "development" | "ci";

/** A condition over the environment. Evaluated by cond.ts; `cred` and `aiKey` are satisfied by `assumeCredentials`. */
export type Cond =
  | { on: string } // value is exactly "1"
  | { set: string } // non-empty
  | { eq: string; value: string } // effective value equals (unset counts as its default)
  | { listHas: string; value: string } // comma-separated list contains the item
  | { cred: string } // a credential is present (never its value)
  | { aiKey: true } // the key for AI_PROVIDER is present, or DEMO_MODE=1 supplies the local stand-in
  | { prod: true } // VERCEL_ENV is "production"
  | { dbNonLocal: true } // DATABASE_URL points at a host that is not this machine
  | { matches: string; twin: string } // the two names carry the same on/off value
  | { anyOf: Cond[] }
  | { allOf: Cond[] }
  | { not: Cond };

export interface Requirement {
  rule: RuleId;
  /** For `requires`: must hold when the flag is active. For `conflictsWith`: must NOT hold when the flag is active. */
  cond: Cond;
  severity: "error" | "warn";
  /** Escalate a warning to an error in strict contexts (profiles, CI). */
  strictError?: boolean;
  /** Evaluated only in these contexts (default: all). */
  contexts?: Context[];
  message: string;
  fix: string;
}

export interface Effects {
  /** Can contact a customer (message, push, email). */
  outbound: boolean;
  /** Sends customer or event data to an outside vendor. */
  vendorSharing: boolean;
  /** Uses an AI provider. */
  ai: boolean;
  /** Changes how personal data is processed or shown. */
  pii: boolean;
}

export interface FlagDef {
  name: string;
  exposure: Exposure;
  kind: Kind;
  type: ValueType;
  /** "1" only if intentionally on. null = unset. No flag defaults to on. */
  default: string | null;
  /** Module id, matching the area or feature it belongs to. */
  owner: string;
  label: string;
  /** One sentence: what turning it on (or setting it) does. */
  enables: string;
  dataClass: DataClass;
  effects: Effects;
  /** The access-policy area (src/lib/access/policy.ts) the flag exposes, if it opens a screen or action. */
  accessArea?: string;
  requires: Requirement[];
  conflictsWith: Requirement[];
  /** Evaluated whether or not the flag is on (always-required secrets). */
  requiresAlways: Requirement[];
  /** For non-bool names: when is this setting "active" for requires/conflicts purposes. Bool names are active when on. */
  activeWhen?: Cond;
  /** AgentSetting keys (database) that must also be on for the effect to occur. Informational. */
  requiresAgentSetting?: string[];
  /** The recorded AI pilot sign-off is needed before any customer-facing use. Not verifiable from env. */
  requiresAiSignoff?: boolean;
  /** Set when a profile may list it only as "needs approval" (live messaging, ad spend, consent decision). */
  approval?: string;
  /** A flag that makes this one harmless in the demo profile (a fake destination). */
  demoStandIn?: string;
  blockedReason?: string;
  /** Enum options, int bounds. */
  options?: string[];
  min?: number;
  max?: number;
  /** A non-secret config value that the status page may show as is. */
  safeToShow?: boolean;
  /** Where it first appears. */
  since: string;
  /** True for names that arrive with a branch not yet merged into this tree. */
  inFlight?: string;
  /** Read by a different process (the WhatsApp worker), not the Next.js app. */
  process?: "app" | "worker" | "tooling";
}

export type Violation = {
  rule: RuleId;
  /** The env name concerned (never a value). */
  flag: string;
  severity: "error" | "warn";
  message: string;
  fix: string;
};

export type ProfileName = "demo" | "pilot" | "go-live" | "marketing-only" | "all-on";

export interface ProfileDef {
  name: ProfileName;
  purpose: string;
  /** Names and safe values that exist in code today. */
  values: Record<string, string>;
  /** Names that arrive with an in-flight branch; written commented-out in templates, validated together with `values`. */
  planned: Record<string, string>;
  /** Flags that are on in the profile only after an owner approval; rendered commented-out. */
  needsApproval: string[];
  /** One line about what the profile leaves off, on purpose. */
  notes: string;
}
