export type FamilyRow = {
  id: string;
  title: string | null;
  project: { folder: string; path: string };
  startedAt: string;
  costUsd: number;
  unpriced: boolean;
  continuedFromId: string | null;
};

export type FamilyMember = {
  id: string;
  title: string | null;
  project: { folder: string; path: string };
  startedAt: string;
  costUsd: number;
  unpriced: boolean;
  depth: number;
  isCurrent: boolean;
};

export type ConversationFamily = {
  sessionId: string;
  members: FamilyMember[];
  size: number;
  totalCostUsd: number;
  hasUnpriced: boolean;
  parent: FamilyMember | null;
  children: FamilyMember[];
};

export function buildFamily(rows: readonly FamilyRow[], sessionId: string): ConversationFamily | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!byId.has(sessionId)) return null;

  const childrenById = childIndex(rows, byId);
  const component = collectComponent(sessionId, byId, childrenById);
  const members = orderMembers(component, byId, childrenById, sessionId);

  const parentId = parentOf(byId.get(sessionId) as FamilyRow, byId);
  const memberById = new Map(members.map((m) => [m.id, m]));

  return {
    sessionId,
    members,
    size: members.length,
    totalCostUsd: members.reduce((sum, m) => sum + m.costUsd, 0),
    hasUnpriced: members.some((m) => m.unpriced),
    parent: parentId === null ? null : (memberById.get(parentId) ?? null),
    children: (childrenById.get(sessionId) ?? [])
      .map((id) => memberById.get(id))
      .filter((m): m is FamilyMember => m !== undefined),
  };
}

export function familySizes(rows: readonly FamilyRow[]): Map<string, number> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenById = childIndex(rows, byId);
  const sizes = new Map<string, number>();
  for (const row of rows) {
    if (sizes.has(row.id)) continue;
    const component = collectComponent(row.id, byId, childrenById);
    for (const id of component) sizes.set(id, component.size);
  }
  return sizes;
}

function parentOf(row: FamilyRow, byId: Map<string, FamilyRow>): string | null {
  const parentId = row.continuedFromId;
  if (parentId === null || parentId === row.id || !byId.has(parentId)) {
    return null;
  }
  return parentId;
}

function childIndex(rows: readonly FamilyRow[], byId: Map<string, FamilyRow>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const row of [...rows].sort(byStartedAt)) {
    const parentId = parentOf(row, byId);
    if (parentId === null) continue;
    const siblings = index.get(parentId);
    if (siblings === undefined) index.set(parentId, [row.id]);
    else siblings.push(row.id);
  }
  return index;
}

function collectComponent(
  sessionId: string,
  byId: Map<string, FamilyRow>,
  childrenById: Map<string, string[]>,
): Set<string> {
  const visited = new Set<string>();
  const queue = [sessionId];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    const row = byId.get(id);
    if (row === undefined) continue;
    const parentId = parentOf(row, byId);
    if (parentId !== null) queue.push(parentId);
    queue.push(...(childrenById.get(id) ?? []));
  }
  return visited;
}

function orderMembers(
  component: Set<string>,
  byId: Map<string, FamilyRow>,
  childrenById: Map<string, string[]>,
  currentId: string,
): FamilyMember[] {
  const rows = [...component]
    .map((id) => byId.get(id))
    .filter((r): r is FamilyRow => r !== undefined)
    .sort(byStartedAt);

  const roots = rows.filter((r) => parentOf(r, byId) === null);
  const members: FamilyMember[] = [];
  const visited = new Set<string>();

  const descend = (row: FamilyRow, depth: number): void => {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    members.push(toMember(row, depth, row.id === currentId));
    for (const childId of childrenById.get(row.id) ?? []) {
      const child = byId.get(childId);
      if (child !== undefined) descend(child, depth + 1);
    }
  };

  for (const root of roots) descend(root, 0);
  for (const row of rows) descend(row, 0);
  return members;
}

function toMember(row: FamilyRow, depth: number, isCurrent: boolean): FamilyMember {
  return {
    id: row.id,
    title: row.title,
    project: row.project,
    startedAt: row.startedAt,
    costUsd: row.costUsd,
    unpriced: row.unpriced,
    depth,
    isCurrent,
  };
}

function byStartedAt(a: FamilyRow, b: FamilyRow): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}
