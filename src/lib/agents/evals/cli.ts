import { ALL_CASES, LIVE_JUDGE_CASES } from "./cases";
import { evaluateAll, evaluateLive } from "./evaluate";
import { formatReport, gate, summarise } from "./report";
import { getProvider } from "@/lib/ai/provider";

/**
 * `npm run evals`. Deterministic layers run in-process with scripted fake providers: no network, no credentials.
 * A real provider is used ONLY when EVALS_REAL_PROVIDER=1 is set explicitly (and the provider is configured). That
 * section is informational and never affects the exit code; it must never run in CI.
 */
async function main() {
  const results = await evaluateAll(ALL_CASES);
  const summary = summarise(results);
  const g = gate(summary);
  console.log(formatReport(summary, g));

  if (process.env.EVALS_REAL_PROVIDER === "1") {
    console.log("\nLive judge (EVALS_REAL_PROVIDER=1, informational, not gated)");
    const provider = getProvider();
    let agree = 0;
    for (const c of LIVE_JUDGE_CASES) {
      const r = await evaluateLive(c, provider);
      const ok = r.actual === c.expect;
      if (ok) agree++;
      console.log(`  ${ok ? "agree   " : "DISAGREE"} ${c.id} expected ${c.expect}, judge said ${r.actual}: ${r.detail}`);
    }
    console.log(`  ${agree}/${LIVE_JUDGE_CASES.length} agree`);
  }
  process.exitCode = g.ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
});
