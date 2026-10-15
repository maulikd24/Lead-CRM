// Pure logic of the lint ratchet (no I/O), so it can be unit tested.
//
// baseline: { total, files: { path: errorCount } }   current: the same shape, measured now.
// The ratchet fails when anything gets worse, and also when something gets better and the baseline was not lowered,
// so an improvement is locked in and cannot be spent again later.

/** Reduce eslint's JSON output (an array of file results) to { total, files }, relative to `root`. */
export function summarise(eslintJson, root = "") {
  const files = {};
  let total = 0;
  for (const r of eslintJson) {
    if (!r.errorCount) continue;
    const p = root && r.filePath.startsWith(root + "/") ? r.filePath.slice(root.length + 1) : r.filePath;
    files[p] = r.errorCount;
    total += r.errorCount;
  }
  return { total, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))) };
}

export function evaluate(baseline, current) {
  const problems = [];
  if (current.total > baseline.total) problems.push(`total errors ${current.total} is above the baseline ${baseline.total}`);
  for (const [file, n] of Object.entries(current.files)) {
    const was = baseline.files[file];
    if (was === undefined) problems.push(`NEW file with errors: ${file} (${n})`);
    else if (n > was) problems.push(`more errors in ${file}: ${was} -> ${n}`);
  }
  const lower = problems.length === 0 && current.total < baseline.total;
  if (lower) problems.push(`errors went down (${baseline.total} -> ${current.total}): lower ci/lint-baseline.json to ${current.total} (run: npm run ci:lint-ratchet -- --update) so the gain is locked in`);
  return { ok: problems.length === 0, lower, problems };
}
