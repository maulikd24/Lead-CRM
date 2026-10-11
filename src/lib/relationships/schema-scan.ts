/**
 * A tiny reader for prisma/schema.prisma that answers one question: which tables reach the customer (Client), directly, by a plain id column, or
 * through other tables. The relationship registry is verified against this by a test, so a new table with a customer link fails the build until
 * somebody says how it is merged, erased and shown. Pure: no Prisma client, no file system (the caller passes the schema text).
 */

export type ScannedFk = { model: string; field: string; target: string; columns: string[]; onDelete: string | null };
export type SchemaScan = { models: string[]; fks: ScannedFk[]; plainIds: { model: string; column: string }[] };

export function scanSchema(text: string): SchemaScan {
  const models: string[] = [];
  const fks: ScannedFk[] = [];
  const idCandidates: { model: string; column: string; type: string }[] = [];
  const relationColumns = new Map<string, Set<string>>();
  let current: string | null = null;
  for (const raw of text.split("\n")) {
    const header = raw.match(/^model (\w+) \{/);
    if (header) { current = header[1]; models.push(current); relationColumns.set(current, new Set()); continue; }
    if (raw.startsWith("}")) { current = null; continue; }
    if (!current) continue;
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line || line.startsWith("@@")) continue;
    const [field, type] = line.split(/\s+/);
    const rel = line.match(/@relation\(([^)]*)\)/);
    if (rel && /fields:\s*\[/.test(rel[1])) {
      const columns = (rel[1].match(/fields:\s*\[([^\]]*)\]/)?.[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean);
      fks.push({ model: current, field, target: type.replace(/[?[\]]/g, ""), columns, onDelete: rel[1].match(/onDelete:\s*(\w+)/)?.[1] ?? null });
      columns.forEach((c) => relationColumns.get(current!)!.add(c));
    } else if (/^(client|customer)Id$/i.test(field)) {
      idCandidates.push({ model: current, column: field, type });
    }
  }
  const plainIds = idCandidates.filter((c) => !relationColumns.get(c.model)!.has(c.column)).map(({ model, column }) => ({ model, column }));
  return { models, fks, plainIds };
}

export type CustomerPath = { via: string[]; column: string };
export type CustomerLink = { model: string; kind: "direct_fk" | "plain_id" | "indirect"; paths: CustomerPath[] };

const MAX_DEPTH = 5;

/**
 * Every table that reaches `root` (the customer) and how: its direct foreign key columns, a plain id column, or (for a table that has neither) the
 * shortest chain of relation fields to a table that has one. A table with a direct link lists only its direct columns: a second route to the customer
 * through another table (a document of a joint holder, a referral through its referrer) is a modelling fact the registry states by hand.
 */
export function customerLinks(scan: SchemaScan, root: string): CustomerLink[] {
  const paths = new Map<string, CustomerPath[]>();
  const kinds = new Map<string, CustomerLink["kind"]>();
  const add = (model: string, p: CustomerPath) => {
    const list = paths.get(model) ?? [];
    if (!list.some((x) => x.column === p.column && x.via.join(".") === p.via.join("."))) list.push(p);
    paths.set(model, list);
  };
  for (const fk of scan.fks) if (fk.target === root && fk.model !== root) { for (const c of fk.columns) add(fk.model, { via: [], column: c }); kinds.set(fk.model, "direct_fk"); }
  for (const p of scan.plainIds) if (p.model !== root && !kinds.has(p.model)) { add(p.model, { via: [], column: p.column }); kinds.set(p.model, "plain_id"); }

  // Indirect: breadth first, so the first path found for a table is a shortest one; later rounds add only paths of the same length.
  const resolved = new Set(kinds.keys());
  let frontier = new Set(resolved);
  for (let depth = 1; depth <= MAX_DEPTH && frontier.size > 0; depth++) {
    const next = new Set<string>();
    for (const fk of scan.fks) {
      if (fk.model === root || fk.target === root || fk.model === fk.target || resolved.has(fk.model)) continue;
      if (!frontier.has(fk.target)) continue;
      for (const p of paths.get(fk.target) ?? []) add(fk.model, { via: [fk.field, ...p.via], column: p.column });
      kinds.set(fk.model, "indirect");
      next.add(fk.model);
    }
    next.forEach((m) => resolved.add(m));
    frontier = next;
  }
  return [...paths.entries()].map(([model, ps]) => ({ model, kind: kinds.get(model) ?? "indirect", paths: ps }));
}
