/**
 * npm run decision:replay -- [--clients 200] [--snapshots 4] [--step 7] [--window 7] [--out file.json] [--save]
 * Runs Decision Engine v2 over historical snapshots in the database and prints agreement, suppression and outcome statistics.
 * Read-only unless --save (writes one DecisionReplayRun summary row; no customer data beyond ids and counts).
 */
import "./_env";
import { writeFileSync } from "node:fs";
import { runReplay, saveReplayRun } from "../../src/lib/intelligence/decision/replay-db";

const arg = (name: string, d: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const str = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};

async function main() {
  const params = { clients: arg("clients", 200), snapshots: arg("snapshots", 4), stepDays: arg("step", 7), outcomeWindowDays: arg("window", 7) };
  const report = await runReplay(params);
  const out = str("out");
  if (out) writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(`Decision replay: ${report.clientsUsed} customers, ${report.params.points} snapshots, ${report.evaluated} evaluated, ${report.skipped} skipped`);
  console.log(`Results      : ${Object.entries(report.results).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (Object.keys(report.abstainReasons).length) console.log(`Abstain      : ${Object.entries(report.abstainReasons).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`Agreement    : ${report.agreement.ratePct}% (${report.agreement.agree} agree, ${report.agreement.disagree} differ)  ${Object.entries(report.disagreementKinds).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`Material     : ${report.materialRegressions.length} suppression regression(s)${report.materialRegressions.length ? "  <- investigate" : ""}`);
  for (const m of report.materialRegressions.slice(0, 5)) console.log(`   ${m.clientId} @ ${m.asOf.slice(0, 10)}: ${m.summary}`);
  console.log(`Suppression  : ${report.suppression.blockedCandidates} of ${report.suppression.candidates} candidates blocked; ${Object.entries(report.suppression.byRule).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`Outcomes     : ${report.outcomes.windowDays}-day follow-up. Recommend: ${JSON.stringify(report.outcomes.byResult.RECOMMEND)}; v2 held back where legacy acted: ${JSON.stringify(report.outcomes.v2HoldsBackWhereLegacyActed)}`);
  console.log(`Note         : ${report.outcomes.note}`);
  for (const l of report.limits) console.log(`Limit        : ${l}`);
  if (process.argv.includes("--save")) console.log(`Saved run ${await saveReplayRun(params, report, null)}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
