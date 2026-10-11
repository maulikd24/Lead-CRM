/**
 * npm run decision:report -- [--days 14] [--run-gates] [--json file]
 * The shadow exit criteria, computed from the stored decisions: pass, fail or insufficient data per criterion.
 * --run-gates runs `npm test` and `npm run evals` and records the result for the "existing evals and tests pass" criterion.
 * Exit code 0 when every criterion passes, 1 otherwise (so it can gate a decision to leave shadow).
 */
import "./_env";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { computeShadowReport, writeGateRecord } from "../../src/lib/intelligence/decision/shadow-stats-db";

const i = process.argv.indexOf("--days");
const days = i >= 0 ? Number(process.argv[i + 1]) : 14;

async function main() {
  if (process.argv.includes("--run-gates")) {
    const run = (cmd: string[]) => (spawnSync("npm", cmd, { stdio: "ignore" }).status === 0 ? "pass" : "fail");
    const tests = run(["test", "--silent"]);
    const evals = run(["run", "evals"]);
    writeGateRecord({ recordedAt: new Date().toISOString(), tests, evals });
    console.log(`Gates recorded: tests ${tests}, evals ${evals}`);
  }
  const r = await computeShadowReport(new Date(), days);
  const j = process.argv.indexOf("--json");
  if (j >= 0) writeFileSync(process.argv[j + 1], JSON.stringify(r, null, 2) + "\n");
  console.log(`Decision Engine v2 shadow report, last ${r.windowDays} days (${r.stats.decisions} decisions)`);
  console.log(`Results: ${Object.entries(r.byResult).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  for (const c of r.exit.criteria) console.log(`  [${c.status === "pass" ? "PASS" : c.status === "fail" ? "FAIL" : "WAIT"}] ${c.title}: ${c.measured} (needs ${c.threshold})`);
  console.log(r.exit.summary);
  process.exit(r.exit.ready ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
