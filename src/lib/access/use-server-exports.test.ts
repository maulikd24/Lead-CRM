import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every export of a "use server" file is a public endpoint anyone can call from a browser with any arguments. So such a file
 * may export only async functions (its own checks run inside them), never a helper that trusts a caller-supplied actor
 * (createClientCore(input, actorUserId) was one). Shared logic lives in a regular module under src/lib and is imported by the
 * actions. Types are fine: they are erased.
 */
const SRC = join(process.cwd(), "src");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
};
const USE_SERVER = /^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*['"]use server['"]/;
const serverFiles = walk(SRC).filter((f) => USE_SERVER.test(readFileSync(f, "utf8")));

/** Parameter names that mean "the caller tells us who is acting". An action must read the actor from the session instead. */
const CALLER_SUPPLIED_ACTOR = /\b_?(actor\w*|actingUser\w*|asUser\w*)\s*[:?]/;

describe('files marked "use server" export only async server actions', () => {
  it("finds the server action files", () => expect(serverFiles.length).toBeGreaterThan(40));
  for (const file of serverFiles) {
    it(relative(SRC, file), () => {
      const src = readFileSync(file, "utf8");
      const problems: string[] = [];
      for (const m of src.matchAll(/^export\s+(.*)$/gm)) {
        const rest = m[1];
        if (/^(type|interface)\b/.test(rest)) continue;
        const fn = /^async\s+function\s+(\w+)\s*(?:<[^>]*>)?\(([^)]*)/.exec(rest);
        if (!fn) { problems.push(`not an async function: export ${rest.slice(0, 60)}`); continue; }
        // Read the whole parameter list (it can span lines).
        const start = m.index! + m[0].indexOf("(");
        const params = src.slice(start, src.indexOf(")", start));
        if (CALLER_SUPPLIED_ACTOR.test(params)) problems.push(`${fn[1]} takes the acting user from the caller`);
        if (/(Core|Row)$/.test(fn[1])) problems.push(`${fn[1]} looks like an internal helper, not an action`);
      }
      expect(problems).toEqual([]);
    });
  }
});
