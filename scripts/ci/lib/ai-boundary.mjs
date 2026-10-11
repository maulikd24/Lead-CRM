// The AI gateway boundary: application code never talks to a model vendor directly. Every call goes through callModel()
// (src/lib/ai/gateway), which carries the purpose, consent, redaction, budget, kill switch and trace. This is the scanner.

/** Files that ARE the gateway (or are tests): they may touch the SDKs and the provider factories. */
const ALLOW = [
  /^src\/lib\/ai\/gateway\//,
  /^src\/lib\/ai\/provider\.ts$/,
  /^src\/lib\/ai\/client\.ts$/,
  /^src\/lib\/ai\/openai\.ts$/,
  /^src\/lib\/agents\/evals\/cli\.ts$/, // the offline harness's optional live judge run (EVALS_REAL_PROVIDER=1), never in CI
];
const TEST = /\.(test|spec)\.(ts|tsx|mjs|js)$/;

export const allowed = (path) => TEST.test(path) || ALLOW.some((re) => re.test(path));

const RULES = [
  { rule: "sdk-import", why: "imports a model SDK; call callModel() from @/lib/ai/gateway instead", re: /(?:from|require\(|import\()\s*["'](?:@anthropic-ai\/sdk|openai)["']/ },
  { rule: "client-import", why: "imports the SDK client helper; it is gateway-internal", re: /["']@\/lib\/ai\/(?:client|openai)["']/ },
  { rule: "provider-factory", why: "imports a raw provider factory; use gatewayProvider() or callModel() from @/lib/ai/gateway", re: /import\s*(?:type\s*)?\{[^}]*\b(?:getProvider|getProviderWithKey|createProvider)\b[^}]*\}\s*from\s*["'][^"']*\/provider["']/ },
  { rule: "vendor-url", why: "calls a model vendor URL directly", re: /api\.(?:anthropic|openai)\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.cohere\.(?:ai|com)/ },
  { rule: "sdk-call", why: "calls a vendor SDK method directly", re: /\.(?:messages|chat\.completions|responses)\.create\s*\(/ },
];

/** All violations in one file's text, with 1-based line numbers. Allowed files return none. */
export function scanFile(path, text) {
  if (allowed(path)) return [];
  const out = [];
  const lines = text.split("\n");
  const inAiDir = path.startsWith("src/lib/ai/");
  lines.forEach((line, i) => {
    // inside src/lib/ai a relative import of the SDK client helper is the same thing as the alias
    if (inAiDir && /from\s+["']\.{1,2}\/(?:client|openai)["']/.test(line)) out.push({ path, line: i + 1, rule: "client-import", why: RULES[1].why, text: line.trim().slice(0, 140) });
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments may mention vendors
    for (const r of RULES) {
      // "import type" lines are erased at compile time: only value imports count
      if (r.rule === "sdk-import" && /^\s*import\s+type\b/.test(line)) continue;
      const re = r.rule === "sdk-import" ? /(?:from|require\(|import\()\s*["'](?:@anthropic-ai\/sdk|openai)["']/ : r.re;
      if (re.test(line)) out.push({ path, line: i + 1, rule: r.rule, why: r.why, text: line.trim().slice(0, 140) });
    }
  });
  return out;
}
