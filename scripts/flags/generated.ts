import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { applyGenerated, renderGeneratedRegion } from "../../src/lib/flags/docs-gen";
import { PROFILE_NAMES, renderProfileEnv } from "../../src/lib/flags/profiles";

/** Every generated file, as relative path -> content. Shared by `flags:docs` (writes) and `flags:check` (compares). */
export function expectedFiles(root: string): Record<string, string> {
  const docsPath = path.join(root, "docs/feature-flags.md");
  const existing = existsSync(docsPath) ? readFileSync(docsPath, "utf8") : "# Feature flags and environment variables\n";
  const files: Record<string, string> = { "docs/feature-flags.md": applyGenerated(existing, renderGeneratedRegion()) };
  for (const name of PROFILE_NAMES) files[`docs/profiles/${name}.env`] = renderProfileEnv(name);
  return files;
}

export function readIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}
