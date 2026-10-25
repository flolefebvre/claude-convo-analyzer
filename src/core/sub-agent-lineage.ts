// Who spawned each Sub-agent of a Conversation, decided from its stored rows
// alone (ADR-0011, log-format §4). The Refresh's links pass reads the facts —
// each Agent's row, each `Agent` Tool call with its spawn ledger — and writes
// what `resolveSubAgentLineage` returns; nothing here reads a log or meta file.

/** What a Sub-agent's lineage is decided from, of one stored `agent` row. */
export type LineageAgent = {
  agentRowId: number;
  /** NULL for the Main thread. */
  externalAgentId: string | null;
  /** NULL only on rows predating the column, which the parser bump rewrites. */
  sourcePath: string | null;
  /** The `toolUseId` its meta file states; NULL when it states none. */
  spawnToolUseId: string | null;
  /** The `agentType` its meta file states; NULL when it states none. */
  agentType: string | null;
  /** The model of most of its own Turns' output. */
  dominantModel: string | null;
};

/** What an `Agent` call's result says of the Sub-agent it spawned (log-format §4). */
export type SpawnLedger = {
  agentId: string;
  agentType: string | null;
  resolvedModel: string | null;
};

/** One stored `Agent` Tool call: the Agent holding it, the Message holding it, and its result's ledger. */
export type StoredAgentCall = {
  toolUseId: string;
  agentRowId: number;
  messageRowId: number;
  /** NULL when its result is not a ledger, or there is no result yet. */
  ledger: SpawnLedger | null;
};

/** A Sub-agent's resolved lineage columns. */
export type SubAgentLineage = {
  agentRowId: number;
  parentAgentId: number;
  /** The spawner's Message holding the spawning call; null without one. */
  spawnedByMessageId: number | null;
  /** The spawning call's `tool_use_id`; null exactly when `spawnedByMessageId` is. */
  spawnedByToolUseId: string | null;
  agentType: string | null;
  resolvedModel: string | null;
};

/**
 * The lineage of every Sub-agent of one Conversation, from its `agents` (the
 * Main thread among them) and its `agentCalls`, in file order within each
 * Agent.
 *
 * A Sub-agent's spawning call is the one its meta file names, else the one
 * whose ledger names it (of several, the smallest `tool_use_id`). Its spawner
 * owns that call, by ADR-0011's rule among the Agents holding it: never the
 * Sub-agent itself nor one of its descendants; of the rest, one none of the
 * others is an ancestor of, the smallest `source_path` of several. Without a
 * call or a holder, the Main thread spawned it, with no spawning Message. Its
 * type is the meta file's, else the spawner's ledger's; its resolved model the
 * ledger's, else its own dominant model.
 *
 * Who descends from whom is what is being decided, so the decision is a
 * fixpoint: in `source_path` order, a Sub-agent is decided once its holders'
 * lineage is settled down to the Main thread, the Main thread is among them,
 * or at most one holder is left. A sweep that decides none decides the first
 * pending one with a settled holder, among its settled holders only — exact,
 * not a tiebreak: a settled holder cannot descend from it, and in consistent
 * logs a settled holder that is no descendant means its spawner is settled
 * too, so the owner among them is it. With no settled holder anywhere, the
 * first pending one goes under the Main thread. A holder whose decided chain
 * reaches the Sub-agent is never picked, so no link closes a cycle, and no
 * step depends on row ids or discovery order.
 *
 * @example
 * resolveSubAgentLineage(statements.selectLineageAgents(id), statements.selectAgentCallsOfConversation(id))
 */
export function resolveSubAgentLineage(agents: LineageAgent[], agentCalls: StoredAgentCall[]): SubAgentLineage[] {
  const mainThread = agents.find((agent) => agent.externalAgentId === null);
  if (mainThread === undefined) return [];
  const sourcePathOf = (agentRowId: number) =>
    agents.find((agent) => agent.agentRowId === agentRowId)?.sourcePath ?? "";
  const callsByToolUseId = new Map<string, StoredAgentCall[]>();
  for (const call of agentCalls) {
    const calls = callsByToolUseId.get(call.toolUseId) ?? [];
    calls.push(call);
    callsByToolUseId.set(call.toolUseId, calls);
  }
  /** The call that spawned `subAgent`: its meta file's, else the smallest one whose ledger names it. */
  const spawnToolUseIdOf = (subAgent: LineageAgent): string | null =>
    subAgent.spawnToolUseId ??
    agentCalls
      .filter((call) => call.ledger?.agentId === subAgent.externalAgentId)
      .map((call) => call.toolUseId)
      .sort()[0] ??
    null;

  const parentRowIdByRowId = new Map<number, number>();
  /** Whether the decided chain of spawners from `agentRowId` reaches `targetRowId` (itself included). */
  const isChainReaching = (agentRowId: number, targetRowId: number) => {
    for (let id: number | undefined = agentRowId; id !== undefined; id = parentRowIdByRowId.get(id)) {
      if (id === targetRowId) return true;
    }
    return false;
  };
  /** Whether the chain of spawners from `agentRowId` is decided down to the Main thread. */
  const isSettled = (agentRowId: number) => isChainReaching(agentRowId, mainThread.agentRowId);
  /** Of `holderRowIds`, the owner: one no other is an ancestor of, the smallest `source_path` of several. */
  const ownerOf = (holderRowIds: number[]) => {
    const rootHolderRowIds = holderRowIds.filter(
      (holderRowId) => !holderRowIds.some((other) => other !== holderRowId && isChainReaching(holderRowId, other)),
    );
    const candidates = rootHolderRowIds.length > 0 ? rootHolderRowIds : holderRowIds;
    return candidates.reduce((smallest, candidate) =>
      sourcePathOf(candidate) < sourcePathOf(smallest) ? candidate : smallest,
    );
  };

  const subAgents = agents
    .filter((agent) => agent.externalAgentId !== null)
    .sort((a, b) => (sourcePathOf(a.agentRowId) < sourcePathOf(b.agentRowId) ? -1 : 1));
  const lineageByRowId = new Map<number, SubAgentLineage>();
  /** Decide `subAgent` as spawned by `spawnerRowId` through call `toolUseId`, or by the Main thread with no Message. */
  const decide = (subAgent: LineageAgent, spawnerRowId: number | null, toolUseId: string | null) => {
    const spawningCall =
      spawnerRowId === null || toolUseId === null
        ? undefined
        : callsByToolUseId.get(toolUseId)!.find((call) => call.agentRowId === spawnerRowId);
    const ledger = spawningCall?.ledger?.agentId === subAgent.externalAgentId ? spawningCall!.ledger : null;
    const parentAgentId = spawnerRowId ?? mainThread.agentRowId;
    parentRowIdByRowId.set(subAgent.agentRowId, parentAgentId);
    lineageByRowId.set(subAgent.agentRowId, {
      agentRowId: subAgent.agentRowId,
      parentAgentId,
      spawnedByMessageId: spawningCall?.messageRowId ?? null,
      spawnedByToolUseId: spawningCall?.toolUseId ?? null,
      agentType: subAgent.agentType ?? ledger?.agentType ?? null,
      resolvedModel: ledger?.resolvedModel ?? subAgent.dominantModel,
    });
  };
  /** The holders of `toolUseId` that may have spawned `subAgent`: not itself, nor one its decided chain reaches. */
  const candidateRowIdsOf = (subAgent: LineageAgent, toolUseId: string) => [
    ...new Set(
      (callsByToolUseId.get(toolUseId) ?? [])
        .map((call) => call.agentRowId)
        .filter((holderRowId) => !isChainReaching(holderRowId, subAgent.agentRowId)),
    ),
  ];

  let pending = subAgents;
  while (pending.length > 0) {
    const stillPending: LineageAgent[] = [];
    for (const subAgent of pending) {
      const toolUseId = spawnToolUseIdOf(subAgent);
      const candidateRowIds = toolUseId === null ? [] : candidateRowIdsOf(subAgent, toolUseId);
      if (candidateRowIds.length === 0) decide(subAgent, null, null);
      else if (candidateRowIds.includes(mainThread.agentRowId)) decide(subAgent, mainThread.agentRowId, toolUseId);
      else if (candidateRowIds.length === 1 || candidateRowIds.every(isSettled)) {
        decide(subAgent, ownerOf(candidateRowIds), toolUseId);
      } else stillPending.push(subAgent);
    }
    if (stillPending.length === pending.length) {
      // No progress: holders waiting on each other. Decide the first with a settled holder, among those only;
      // with none anywhere, the first goes under the Main thread.
      const settledRowIdsOf = (subAgent: LineageAgent) =>
        candidateRowIdsOf(subAgent, spawnToolUseIdOf(subAgent)!).filter(isSettled);
      const unblocked = stillPending.find((subAgent) => settledRowIdsOf(subAgent).length > 0);
      if (unblocked === undefined) decide(stillPending[0]!, null, null);
      else decide(unblocked, ownerOf(settledRowIdsOf(unblocked)), spawnToolUseIdOf(unblocked));
      pending = stillPending.filter((subAgent) => !lineageByRowId.has(subAgent.agentRowId));
    } else {
      pending = stillPending;
    }
  }
  return subAgents.map((subAgent) => lineageByRowId.get(subAgent.agentRowId)!);
}
