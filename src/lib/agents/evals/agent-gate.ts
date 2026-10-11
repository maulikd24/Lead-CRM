import { getAgent } from "../registry";
import { ALL_CASES } from "./cases";
import { evaluateAll } from "./evaluate";
import { gate, summarise } from "./report";

/** Is this agent's eval suite green right now? Runs the agent's categories in-process with scripted providers (no network). */
export async function agentEvalGate(agentKey: string): Promise<{ green: boolean; detail: string }> {
  const agent = getAgent(agentKey);
  if (!agent?.evalSuite) return { green: false, detail: "the agent has no eval suite yet" };
  const cats = new Set(agent.evalSuite.categories);
  const cases = ALL_CASES.filter((c) => cats.has(c.category));
  if (cases.length === 0) return { green: false, detail: "the agent's eval suite has no cases" };
  const s = summarise(await evaluateAll(cases));
  const g = gate(s);
  return g.ok ? { green: true, detail: `${s.total} cases green` } : { green: false, detail: g.failures.join("; ") };
}
