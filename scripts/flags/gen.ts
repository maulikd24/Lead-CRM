/**
 * npm run flags:docs   - regenerate docs/feature-flags.md (between the markers) and docs/profiles/*.env from the registry.
 * Writes files only inside docs/. Never reads an environment value.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expectedFiles } from "./generated";

const root = process.cwd();
const files = expectedFiles(root);
mkdirSync(path.join(root, "docs/profiles"), { recursive: true });
for (const [rel, content] of Object.entries(files)) {
  writeFileSync(path.join(root, rel), content);
  console.log(`wrote ${rel}`);
}
