/**
 * The source scan behind `npm run flags:check`: which environment names does the code read? Pure functions over file
 * contents, so the scan itself is unit-tested; the script only walks the tree and calls them.
 */

export interface ScanFile {
  path: string;
  text: string;
}

export interface FoundName {
  name: string;
  /** Files that read it (test files are kept apart: they never make a flag "referenced"). */
  files: string[];
  inTestsOnly: boolean;
}

const NAME = "[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*";
const PATTERNS: RegExp[] = [
  new RegExp(`\\bprocess\\.env\\.(${NAME})\\b`, "g"),
  new RegExp(`(?<![.\\w])env\\.(${NAME})\\b`, "g"),
  new RegExp(`(?:process\\.env|(?<![.\\w])env)\\[\\s*["'\`](${NAME})["'\`]\\s*\\]`, "g"),
  /\b(NEXT_PUBLIC_[A-Z0-9_]+)\b/g,
  // A quoted literal that is clearly a switch or key name, for names read through a map or a helper.
  /["'`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:ENABLED|ENFORCEMENT|LINKING|EVERY_HOURS|DB_TEST|API_KEY|DRY_RUN|KILL_SWITCH))["'`]/g,
  // Zod-style schema keys in the worker: `NAME: z.`
  /^\s*([A-Z][A-Z0-9_]{2,}):\s*z\./gm,
];

/** Strings that look like an env name but are not one. Kept short and explicit; every entry says why in the allow-list file. */
const NOT_ENV = new Set(["ENV"]);

export function extractNames(text: string): string[] {
  const found = new Set<string>();
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) if (!NOT_ENV.has(m[1])) found.add(m[1]);
  }
  return [...found];
}

const isTestFile = (p: string) => /\.(test|spec)\.[cm]?[tj]sx?$/.test(p) || /(^|\/)e2e\//.test(p);

export function scanSource(files: ScanFile[]): FoundName[] {
  const map = new Map<string, { files: Set<string>; nonTest: boolean }>();
  for (const f of files) {
    for (const name of extractNames(f.text)) {
      const e = map.get(name) ?? { files: new Set<string>(), nonTest: false };
      e.files.add(f.path);
      if (!isTestFile(f.path)) e.nonTest = true;
      map.set(name, e);
    }
  }
  return [...map.entries()].map(([name, e]) => ({ name, files: [...e.files].sort(), inTestsOnly: !e.nonTest })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse ci/flags-allowlist.txt: one NAME per line, `#` starts a comment. */
export function parseAllowList(text: string): Set<string> {
  return new Set(text.split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean));
}

export interface ScanFinding {
  rule: "FR-01" | "FR-31";
  severity: "error" | "warn";
  name: string;
  message: string;
  files: string[];
}

/**
 * FR-01: a name read in code that is neither registered nor allow-listed (error).
 * FR-31: a registered name that nothing in the non-test source references (warning; in-flight names are expected to be absent).
 */
export function checkNames(found: FoundName[], opts: { isRegistered: (n: string) => boolean; allowList: Set<string> }): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (const f of found) {
    if (opts.isRegistered(f.name) || opts.allowList.has(f.name)) continue;
    out.push({ rule: "FR-01", severity: "error", name: f.name, files: f.files.slice(0, 5), message: `${f.name} is read in code but is not in the flag registry (src/lib/flags/registry.ts) or the allow-list (ci/flags-allowlist.txt).` });
  }
  return out;
}

export function unreferenced(registered: readonly { name: string; inFlight?: string; kind?: string; process?: string }[], files: ScanFile[]): ScanFinding[] {
  const nonTest = files.filter((f) => !isTestFile(f.path) && !/(^|\/)src\/lib\/flags\/(?!startup\.ts)/.test(f.path) && !/\.generated\./.test(f.path)).map((f) => f.text).join("\n");
  // Test and tooling switches (opt-in database tests, e2e credentials) are read by test files; for them that counts.
  const withTests = files.filter((f) => !/(^|\/)src\/lib\/flags\/(?!startup\.ts)/.test(f.path) && !/\.generated\./.test(f.path)).map((f) => f.text).join("\n");
  const out: ScanFinding[] = [];
  for (const r of registered) {
    if (r.inFlight) continue;
    const body = r.kind === "test" || r.process === "tooling" ? withTests : nonTest;
    if (!new RegExp(`(?<![A-Z0-9_])${r.name}(?![A-Z0-9_])`).test(body)) out.push({ rule: "FR-31", severity: "warn", name: r.name, files: [], message: `${r.name} is registered but nothing in the source references it (deprecated, or only read by an external tool).` });
  }
  return out;
}
