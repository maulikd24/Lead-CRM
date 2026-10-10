/** Pure helpers for the commercial roll-up (PartnerProfile.parentPartnerProfileId). No Prisma, no React. */

export type PNode = { id: string; parentId: string | null };

function childrenOf(nodes: PNode[]): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = kids.get(n.parentId);
    if (list) list.push(n.id);
    else kids.set(n.parentId, [n.id]);
  }
  return kids;
}

/** The given partners and everyone below them. Unknown ids are ignored; a cycle in the data cannot loop. */
export function subtreeIds(rootIds: string[], nodes: PNode[]): string[] {
  const exists = new Set(nodes.map((n) => n.id));
  const kids = childrenOf(nodes);
  const seen = new Set<string>();
  const stack = rootIds.filter((id) => exists.has(id));
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const k of kids.get(id) ?? []) if (!seen.has(k)) stack.push(k);
  }
  return [...seen];
}

export type FlatRow<T extends PNode> = T & {
  depth: number;
  /** The parent in the tree as drawn: null for a root, including a partner whose real parent is outside the list. */
  treeParentId: string | null;
  childCount: number;
  /** True when this partner has people below it that are not listed because of the depth limit. */
  truncated: boolean;
};

export const MAX_TREE_DEPTH = 12;

/**
 * Depth-first rows, children sorted by id under their parent. A partner whose parent is not in the list is a root, so
 * a scoped view (a distributor's own sub-tree) is drawn from the top of what that person may see. A cycle is broken
 * at its smallest id; every partner appears exactly once.
 */
export function flattenForest<T extends PNode>(nodes: T[], opts: { maxDepth?: number } = {}): FlatRow<T>[] {
  const maxDepth = opts.maxDepth ?? MAX_TREE_DEPTH;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = childrenOf(nodes.filter((n) => n.parentId !== n.id));
  for (const list of kids.values()) list.sort();
  const out: FlatRow<T>[] = [];
  const seen = new Set<string>();

  const visit = (id: string, depth: number, parent: string | null) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id)!;
    const children = (kids.get(id) ?? []).filter((k) => !seen.has(k));
    const row: FlatRow<T> = { ...node, depth, treeParentId: parent, childCount: children.length, truncated: false };
    out.push(row);
    if (depth >= maxDepth) {
      row.truncated = children.length > 0;
      // Hidden by the depth limit, not orphaned: keep them out of the leftover pass below.
      const stack = [...children];
      while (stack.length) {
        const k = stack.pop()!;
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push(...(kids.get(k) ?? []));
      }
      return;
    }
    for (const k of children) visit(k, depth + 1, id);
  };

  const roots = nodes.filter((n) => !n.parentId || n.parentId === n.id || !byId.has(n.parentId)).map((n) => n.id).sort();
  for (const r of roots) visit(r, 0, null);
  // Whatever is left sits in a cycle with no root above it.
  for (const id of nodes.map((n) => n.id).sort()) visit(id, 0, null);
  return out;
}

/** Each partner's own amount plus everything below them in the drawn tree (paise or any integer unit). */
export function rollupTotals(nodes: PNode[], own: Map<string, bigint>): Map<string, bigint> {
  const flat = flattenForest(nodes, { maxDepth: Number.MAX_SAFE_INTEGER });
  const totals = new Map<string, bigint>(flat.map((r) => [r.id, own.get(r.id) ?? 0n]));
  for (let i = flat.length - 1; i >= 0; i--) {
    const r = flat[i];
    if (r.treeParentId) totals.set(r.treeParentId, (totals.get(r.treeParentId) ?? 0n) + (totals.get(r.id) ?? 0n));
  }
  return totals;
}
