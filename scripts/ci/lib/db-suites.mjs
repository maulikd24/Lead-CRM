// Pure helpers for scripts/ci/db-suites.mjs.

/** Compare the files on disk with the registry; both directions fail. */
export function checkCoverage(files, registry) {
  const listed = new Set(registry.map((s) => s.file));
  const onDisk = new Set(files);
  const problems = [];
  for (const f of [...onDisk].sort()) if (!listed.has(f)) problems.push(`${f} exists but is not in ci/db-suites.json (it would be skipped silently)`);
  for (const f of [...listed].sort()) if (!onDisk.has(f)) problems.push(`${f} is in ci/db-suites.json but the file does not exist`);
  const dup = registry.map((s) => s.file).filter((f, i, a) => a.indexOf(f) !== i);
  for (const f of new Set(dup)) problems.push(`${f} is listed twice`);
  return problems;
}

/** The env switches a suite file names (read directly or passed to a shared harness), so the registry cannot name a switch the file ignores. */
export function switchesIn(source) {
  return [...new Set([...source.matchAll(/\b([A-Z0-9]+(?:_[A-Z0-9]+)*_DB_TEST)\b/g)].map((m) => m[1]))];
}
