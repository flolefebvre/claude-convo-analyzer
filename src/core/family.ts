// Continuation families (issue #46). A Conversation's `continued_from` link
// (set by `refresh()` when a session's first record resumes/forks another) makes
// the sessions of one piece of work a TREE; the family is the whole connected
// component — walked in BOTH directions, parents and continuations alike.
//
// Pure + deterministic: these functions take the conversation summaries the
// existing read seam (`listConversations`) already produces and derive the
// family from their `continuedFromId` pointers, so a family costs no extra
// query and every member's cost is the SAME per-conversation rollup the list
// shows (ADR-0001 — sessions stay distinct rows; nothing is merged or
// re-priced). React-free + I/O-free, so the whole walk unit-tests in the node
// environment (ADR-0002).

/**
 * The minimal conversation shape a family walk needs — a structural subset of
 * `ConversationSummary`, so callers hand over the summaries they already hold.
 */
export type FamilyRow = {
  /** The session id (the stable, user-facing conversation id). */
  id: string;
  title: string | null;
  project: { folder: string; path: string };
  startedAt: string;
  costUsd: number;
  unpriced: boolean;
  /** Session id of the conversation this one was resumed/forked from. */
  continuedFromId: string | null;
};

/** One conversation of a family, placed in the family's tree. */
export type FamilyMember = {
  id: string;
  title: string | null;
  project: { folder: string; path: string };
  startedAt: string;
  costUsd: number;
  unpriced: boolean;
  /** Indentation depth in the fork tree (0 = a root of the family). */
  depth: number;
  /** True for the conversation the family was built for ("you are here"). */
  isCurrent: boolean;
};

/** The connected component one conversation belongs to. */
export type ConversationFamily = {
  /** The conversation the family was built for. */
  sessionId: string;
  /**
   * Every member, in render order: depth-first from the family's earliest root,
   * each node's continuations visited oldest-first, so the list reads
   * chronologically while `depth` carries the fork structure.
   */
  members: FamilyMember[];
  /** Number of members — 1 means a standalone conversation. */
  size: number;
  /** Sum of every member's cost; a lower bound when {@link hasUnpriced}. */
  totalCostUsd: number;
  /** True when ANY member has unpriced model usage. */
  hasUnpriced: boolean;
  /** The DIRECT parent of {@link sessionId}, if it is in the family. */
  parent: FamilyMember | null;
  /** The DIRECT continuations of {@link sessionId}, oldest first. */
  children: FamilyMember[];
};

/**
 * The family of one conversation, or `null` when `sessionId` is unknown to
 * `rows`. A conversation with neither a parent nor continuations yields a family
 * of one (`size === 1`) — the standalone case the UI renders without a badge.
 */
export function buildFamily(
  rows: readonly FamilyRow[],
  sessionId: string,
): ConversationFamily | null {
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

/**
 * Family size for EVERY conversation, in one pass over the link graph: the size
 * of the connected component each one belongs to (1 = standalone). What the list
 * badge reads — so a chain of three shows "3" on all three rows — computed once
 * for the whole table instead of per row.
 */
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

/**
 * The parent link of a row, kept only when it RESOLVES inside `byId`. A link to
 * a conversation whose log file is gone (or that a scoped row set excludes) is
 * treated as absent, so the row is simply a root of its own family instead of
 * dangling.
 */
function parentOf(
  row: FamilyRow,
  byId: Map<string, FamilyRow>,
): string | null {
  const parentId = row.continuedFromId;
  if (parentId === null || parentId === row.id || !byId.has(parentId)) {
    return null;
  }
  return parentId;
}

/** Parent id → its continuations' ids, each list oldest-first. */
function childIndex(
  rows: readonly FamilyRow[],
  byId: Map<string, FamilyRow>,
): Map<string, string[]> {
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

/**
 * Every conversation reachable from `sessionId` through continuation links in
 * EITHER direction. A `visited` set makes the walk defensive against a
 * pathological cycle (`SetNull` deletes plus re-parses make odd shapes
 * conceivable): each conversation is entered at most once.
 */
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

/**
 * Lay the component out as a tree: depth-first from its roots (earliest first),
 * each node's continuations oldest-first. A component with NO root — only
 * possible if the links form a cycle — falls back to its earliest member, and
 * the `visited` guard stops the descent from looping.
 */
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
  // Cycle fallback: whatever the roots could not reach still gets rendered,
  // anchored at its earliest member.
  for (const row of rows) descend(row, 0);
  return members;
}

function toMember(
  row: FamilyRow,
  depth: number,
  isCurrent: boolean,
): FamilyMember {
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

/** Chronological order, ties broken by session id so the layout is stable. */
function byStartedAt(a: FamilyRow, b: FamilyRow): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}
