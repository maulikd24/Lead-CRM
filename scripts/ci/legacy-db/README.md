# Synthetic legacy database

Proves the train's migrations upgrade a populated database without touching existing rows, using no real data. See `docs/ci.md`.

- `baseline.txt`: the pinned upstream commit whose migrations and schema are the "original platform".
- `seed-legacy.sql`: deterministic synthetic rows (psql variables `clients`, `leads`, `activities`, `messages`, `anchor`).
- `run.mjs`: build, load, snapshot, upgrade, verify, compare schemas, time budget, hygiene. `--generate-only`, `--determinism`, `--scale`.
- `verify.mjs`: `snapshot` before the upgrade, `check` after it (counts, content hashes, columns, constraints, indexes, FK orphans,
  audit chain, identity keys, sample rows). Reads only, local scratch databases only.

The generator writes only to databases named `wt_ci_*` on a local Postgres and drops them when it finishes (`--generate-only` keeps one).
