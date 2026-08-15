import { type CostByType, priceSplitByType, resolveModel, type TokenSplit, type Tokens } from "@/core/cost";
import { readClient } from "@/core/db";
import { addLocalDays, localDayKey, startOfLocalDay } from "@/core/local-day";
import type { PrismaClient } from "@/core/prisma/generated/client";

export type ConversationSummary = {
  id: string;
  title: string | null;
  project: { folder: string; path: string };
  startedAt: string;
  endedAt: string;
  models: { dominant: string; distinctCount: number };
  tokens: Tokens;
  costUsd: number;
  costByType: CostByType;
  unpriced: boolean;
  subAgentCount: number;
  continuedFromId: string | null;
  errorCount: number;
};

export type ConversationDetail = ConversationSummary & {
  perModel: { model: string; tokens: Tokens; costUsd: number; unpriced: boolean }[];
  subAgents: {
    agentId: string;
    agentType: string;
    model: string;
    tokens: Tokens;
    costUsd: number;
  }[];
  perSkill: { skill: string; tokens: Tokens; costUsd: number }[];
};

export type TranscriptToolCall = {
  toolUseId: string | null;
  name: string;
  inputJson: string;
  resultText: string | null;
  resultTruncated: boolean;
  resultCharSize: number | null;
  isError: boolean;
};

export type TranscriptMessage = {
  id: number;
  uuid: string | null;
  role: string;
  kind: string | null;
  text: string | null;
  model: string | null;
  effort: string | null;
  tokens: Tokens | null;
  costUsd: number;
  unpriced: boolean;
  isApiError: boolean;
  apiErrorMessage: string | null;
  timestamp: string | null;
  toolCalls: TranscriptToolCall[];
};

export type TranscriptAgentNode = {
  id: string;
  agentType: string | null;
  resolvedModel: string | null;
  costUsd: number;
  tokens: Tokens;
  unpriced: boolean;
  hasError: boolean;
  metaCount: number;
  spawnedByMessageId: number | null;
  spawnedByToolUseId: string | null;
  children: TranscriptAgentNode[];
};

export type TranscriptView = {
  sessionId: string;
  title: string | null;
  tree: TranscriptAgentNode;
  totalCostUsd: number;
  totalTokens: Tokens;
  selectedAgentId: string;
  messages: TranscriptMessage[];
  metaHiddenCount: number;
};

type ListOptions = {
  sortBy?: keyof ConversationSummary;
  dir?: "asc" | "desc";
  dbPath?: string;
};

export async function listConversations(opts: ListOptions = {}): Promise<ConversationSummary[]> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const conversations = await prisma.conversation.findMany({
      include: { project: true },
    });

    const modelSums = await prisma.message.groupBy({
      by: ["conversationId", "model"],
      _sum: TOKEN_SUM,
    });
    const timeSpans = await prisma.message.groupBy({
      by: ["conversationId"],
      _min: { timestamp: true },
      _max: { timestamp: true },
    });
    const subAgentCounts = await prisma.agent.groupBy({
      by: ["conversationId"],
      where: { parentAgentId: { not: null } },
      _count: { _all: true },
    });
    const errorCounts = await prisma.message.groupBy({
      by: ["conversationId"],
      where: { isApiError: true },
      _count: { _all: true },
    });

    const modelRowsById = new Map<number, ModelSumRow[]>();
    for (const g of modelSums) {
      let rows = modelRowsById.get(g.conversationId);
      if (rows === undefined) {
        rows = [];
        modelRowsById.set(g.conversationId, rows);
      }
      rows.push(toModelSumRow(g));
    }
    const boundsById = new Map<number, { startedAt: string; endedAt: string }>();
    for (const t of timeSpans) {
      boundsById.set(t.conversationId, isoBounds(t._min.timestamp, t._max.timestamp));
    }
    const subCountById = new Map<number, number>();
    for (const c of subAgentCounts) {
      subCountById.set(c.conversationId, c._count._all);
    }
    const errorCountById = new Map<number, number>();
    for (const c of errorCounts) {
      errorCountById.set(c.conversationId, c._count._all);
    }
    const continuedFromById = await resolveContinuedFromIds(prisma, conversations);

    const summaries = conversations.map((convo) =>
      assembleSummary(convo, {
        groups: pricedRollup(modelRowsById.get(convo.id) ?? []),
        bounds: boundsById.get(convo.id) ?? { startedAt: "", endedAt: "" },
        subAgentCount: subCountById.get(convo.id) ?? 0,
        errorCount: errorCountById.get(convo.id) ?? 0,
        continuedFromId:
          convo.continuedFromConversationId === null
            ? null
            : (continuedFromById.get(convo.continuedFromConversationId) ?? null),
      }),
    );

    if (opts.sortBy) {
      sortSummaries(summaries, opts.sortBy, opts.dir ?? "asc");
    }
    return summaries;
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

async function resolveContinuedFromIds(
  prisma: PrismaClient,
  conversations: { continuedFromConversationId: number | null }[],
): Promise<Map<number, string>> {
  const referenced = [
    ...new Set(conversations.map((c) => c.continuedFromConversationId).filter((id): id is number => id !== null)),
  ];
  const out = new Map<number, string>();
  if (referenced.length === 0) return out;
  const rows = await prisma.conversation.findMany({
    where: { id: { in: referenced } },
    select: { id: true, sessionId: true },
  });
  for (const r of rows) out.set(r.id, r.sessionId);
  return out;
}

type DetailOptions = { dbPath?: string };

export async function getConversation(id: string, opts: DetailOptions = {}): Promise<ConversationDetail | null> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const convo = await prisma.conversation.findUnique({
      where: { sessionId: id },
      include: { project: true },
    });
    if (convo === null) return null;

    const { summary, groups } = await summarizeConversation(prisma, convo);
    const perModel = groups.map((g) => ({
      model: g.model,
      tokens: g.tokens,
      costUsd: g.costUsd,
      unpriced: g.unpriced,
    }));
    const perSkill = await pricedGroupsBySkill(prisma, convo.id);
    const subAgents = await subAgentBreakdown(prisma, convo.id);

    return { ...summary, perModel, subAgents, perSkill };
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

async function pricedGroupsBySkill(
  prisma: PrismaClient,
  conversationId: number,
): Promise<{ skill: string; tokens: Tokens; costUsd: number }[]> {
  const grouped = await prisma.message.groupBy({
    by: ["attributionSkill", "model"],
    where: {
      conversationId,
      attributionSkill: { not: null },
      model: { not: null },
    },
    _sum: TOKEN_SUM,
  });

  const bySkill = new Map<string, ModelSumRow[]>();
  const order: string[] = [];
  for (const g of grouped) {
    const skill = g.attributionSkill as string;
    let rows = bySkill.get(skill);
    if (rows === undefined) {
      rows = [];
      bySkill.set(skill, rows);
      order.push(skill);
    }
    rows.push(toModelSumRow(g));
  }

  return order.map((skill) => {
    const groups = pricedRollup(bySkill.get(skill) as ModelSumRow[]);
    const tokens: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
    let costUsd = 0;
    for (const g of groups) {
      addTokens(tokens, g.tokens);
      costUsd += g.costUsd;
    }
    return { skill, tokens, costUsd };
  });
}

async function subAgentBreakdown(
  prisma: PrismaClient,
  conversationId: number,
): Promise<ConversationDetail["subAgents"]> {
  const subs = await prisma.agent.findMany({
    where: { conversationId, parentAgentId: { not: null } },
    select: { id: true, externalAgentId: true, agentType: true, resolvedModel: true },
  });

  const costs = await ownCostByAgent(
    prisma,
    subs.map((s) => s.id),
  );
  return subs.map((sub) => {
    const c = costs.get(sub.id) ?? { tokens: emptyTokens(), costUsd: 0 };
    return {
      agentId: sub.externalAgentId ?? String(sub.id),
      agentType: sub.agentType ?? "",
      model: sub.resolvedModel ?? "",
      tokens: c.tokens,
      costUsd: c.costUsd,
    };
  });
}

function emptyTokens(): Tokens {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
}

type OwnCost = { tokens: Tokens; costUsd: number; unpriced: boolean };

async function ownCostByAgent(prisma: PrismaClient, agentIds: number[]): Promise<Map<number, OwnCost>> {
  const out = new Map<number, OwnCost>();
  if (agentIds.length === 0) return out;

  const grouped = await prisma.message.groupBy({
    by: ["agentId", "model"],
    where: { agentId: { in: agentIds }, model: { not: null } },
    _sum: TOKEN_SUM,
  });

  const rowsByAgent = new Map<number, ModelSumRow[]>();
  for (const g of grouped) {
    let rows = rowsByAgent.get(g.agentId);
    if (rows === undefined) {
      rows = [];
      rowsByAgent.set(g.agentId, rows);
    }
    rows.push(toModelSumRow(g));
  }

  for (const id of agentIds) {
    const groups = pricedRollup(rowsByAgent.get(id) ?? []);
    const tokens = emptyTokens();
    let costUsd = 0;
    let unpriced = false;
    for (const g of groups) {
      addTokens(tokens, g.tokens);
      costUsd += g.costUsd;
      if (g.unpriced) unpriced = true;
    }
    out.set(id, { tokens, costUsd, unpriced });
  }
  return out;
}

type TranscriptOptions = {
  dbPath?: string;
  agentId?: string;
};

type AgentRow = {
  id: number;
  parentAgentId: number | null;
  externalAgentId: string | null;
  spawnedByMessageId: number | null;
  agentType: string | null;
  resolvedModel: string | null;
};

function agentKey(a: { externalAgentId: string | null; id: number }): string {
  return a.externalAgentId ?? String(a.id);
}

export async function getTranscript(id: string, opts: TranscriptOptions = {}): Promise<TranscriptView | null> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const convo = await prisma.conversation.findUnique({
      where: { sessionId: id },
      select: { id: true, sessionId: true, title: true },
    });
    if (convo === null) return null;

    const agents: AgentRow[] = await prisma.agent.findMany({
      where: { conversationId: convo.id },
      select: {
        id: true,
        parentAgentId: true,
        externalAgentId: true,
        spawnedByMessageId: true,
        agentType: true,
        resolvedModel: true,
      },
    });
    const agentIds = agents.map((a) => a.id);

    const [ownCost, errorAgentIds, metaByAgent, firstTsByAgent] = await Promise.all([
      ownCostByAgent(prisma, agentIds),
      errorAgentIdSet(prisma, convo.id),
      metaCountByAgent(prisma, convo.id),
      firstMessageTsByAgent(prisma, convo.id),
    ]);

    const spawnToolUseByAgent = await resolveSpawnToolUseIds(prisma, agents, firstTsByAgent);

    const tree = buildAgentTree(agents, {
      ownCost,
      errorAgentIds,
      metaByAgent,
      firstTsByAgent,
      spawnToolUseByAgent,
    });

    const totalTokens = emptyTokens();
    let totalCostUsd = 0;
    for (const a of agents) {
      const oc = ownCost.get(a.id);
      if (oc === undefined) continue;
      addTokens(totalTokens, oc.tokens);
      totalCostUsd += oc.costUsd;
    }

    const mainAgent = agents.find((a) => a.parentAgentId === null) ?? agents[0];
    const selected =
      (opts.agentId === undefined ? undefined : agents.find((a) => agentKey(a) === opts.agentId)) ?? mainAgent;

    const messages = selected === undefined ? [] : await readAgentTranscript(prisma, selected.id);

    return {
      sessionId: convo.sessionId,
      title: convo.title,
      tree,
      totalCostUsd,
      totalTokens,
      selectedAgentId: selected === undefined ? "" : agentKey(selected),
      messages,
      metaHiddenCount: selected === undefined ? 0 : (metaByAgent.get(selected.id) ?? 0),
    };
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

export type DailySpendModel = {
  model: string;
  costUsd: number;
  tokens: Tokens;
};

export type DailySpendDay = {
  date: string;
  costUsd: number;
  tokens: Tokens;
  perModel: { model: string; costUsd: number }[];
};

export type DailySpend = {
  days: DailySpendDay[];
  models: DailySpendModel[];
  totalCostUsd: number;
  totalTokens: Tokens;
  hasUnpriced: boolean;
  hasApproximate: boolean;
};

type DailySpendOptions = {
  folder?: string;
  days?: number;
  now?: number;
  dbPath?: string;
};

export async function getDailySpend(opts: DailySpendOptions = {}): Promise<DailySpend> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const today = startOfLocalDay(opts.now ?? Date.now());
    const from = opts.days === undefined ? null : addLocalDays(today, 1 - opts.days);

    const rows = await prisma.message.findMany({
      where: {
        model: { not: null },
        timestamp: {
          lt: BigInt(addLocalDays(today, 1).getTime()),
          ...(from === null ? {} : { gte: BigInt(from.getTime()) }),
        },
        ...(opts.folder === undefined ? {} : { conversation: { project: { folderName: opts.folder } } }),
      },
      select: {
        timestamp: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreation5mTokens: true,
        cacheCreation1hTokens: true,
        cacheReadTokens: true,
      },
    });

    const byDay = foldByLocalDay(rows);
    return assembleDailySpend(byDay, {
      from: from ?? earliestDay(byDay, today),
      to: today,
      empty: from === null && byDay.size === 0,
    });
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

type DailyMessageRow = {
  timestamp: bigint | number | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
  cacheReadTokens: number | null;
};

function emptySplit(): TokenSplit {
  return { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
}

function foldByLocalDay(rows: DailyMessageRow[]): Map<string, Map<string, TokenSplit>> {
  const byDay = new Map<string, Map<string, TokenSplit>>();
  for (const r of rows) {
    if (r.timestamp === null || r.model === null) continue;
    const key = localDayKey(startOfLocalDay(Number(r.timestamp)));
    let models = byDay.get(key);
    if (models === undefined) {
      models = new Map<string, TokenSplit>();
      byDay.set(key, models);
    }
    let split = models.get(r.model);
    if (split === undefined) {
      split = emptySplit();
      models.set(r.model, split);
    }
    split.input += r.inputTokens ?? 0;
    split.output += r.outputTokens ?? 0;
    split.cacheWrite5m += r.cacheCreation5mTokens ?? 0;
    split.cacheWrite1h += r.cacheCreation1hTokens ?? 0;
    split.cacheRead += r.cacheReadTokens ?? 0;
  }
  return byDay;
}

function earliestDay(byDay: Map<string, Map<string, TokenSplit>>, fallback: Date): Date {
  let earliest: string | undefined;
  for (const key of byDay.keys()) {
    if (earliest === undefined || key < earliest) earliest = key;
  }
  if (earliest === undefined) return fallback;
  const [year, month, date] = earliest.split("-").map(Number);
  return new Date(year, month - 1, date);
}

function addSplitTokens(into: Tokens, split: TokenSplit): void {
  addTokens(into, {
    input: split.input,
    output: split.output,
    cacheWrite: split.cacheWrite5m + split.cacheWrite1h,
    cacheRead: split.cacheRead,
    total: 0,
  });
}

function assembleDailySpend(
  byDay: Map<string, Map<string, TokenSplit>>,
  range: { from: Date; to: Date; empty: boolean },
): DailySpend {
  const days: DailySpendDay[] = [];
  const modelTotals = new Map<string, DailySpendModel>();
  const totalTokens = emptyTokens();
  let totalCostUsd = 0;
  let hasUnpriced = false;
  let hasApproximate = false;

  for (
    let cursor = range.from;
    !range.empty && cursor.getTime() <= range.to.getTime();
    cursor = addLocalDays(cursor, 1)
  ) {
    const date = localDayKey(cursor);
    const tokens = emptyTokens();
    const perModel: { model: string; costUsd: number }[] = [];
    let costUsd = 0;

    for (const [model, split] of byDay.get(date) ?? []) {
      addSplitTokens(tokens, split);
      const cost = priceSplitByType(split, model);
      if (cost.unpriced) {
        hasUnpriced = true;
        continue;
      }
      if (cost.approximate) hasApproximate = true;
      costUsd += cost.usd;
      perModel.push({ model, costUsd: cost.usd });
      accumulateModelTotal(modelTotals, model, split, cost.usd);
    }

    perModel.sort(byCostDesc);
    addTokens(totalTokens, tokens);
    totalCostUsd += costUsd;
    days.push({ date, costUsd, tokens, perModel });
  }

  return {
    days,
    models: [...modelTotals.values()].sort(byCostDesc),
    totalCostUsd,
    totalTokens,
    hasUnpriced,
    hasApproximate,
  };
}

function accumulateModelTotal(
  totals: Map<string, DailySpendModel>,
  model: string,
  split: TokenSplit,
  costUsd: number,
): void {
  let entry = totals.get(model);
  if (entry === undefined) {
    entry = { model, costUsd: 0, tokens: emptyTokens() };
    totals.set(model, entry);
  }
  entry.costUsd += costUsd;
  addSplitTokens(entry.tokens, split);
}

function byCostDesc(a: { model: string; costUsd: number }, b: { model: string; costUsd: number }): number {
  return b.costUsd - a.costUsd || a.model.localeCompare(b.model);
}

async function errorAgentIdSet(prisma: PrismaClient, conversationId: number): Promise<Set<number>> {
  const rows = await prisma.message.groupBy({
    by: ["agentId"],
    where: { conversationId, isApiError: true },
    _count: { _all: true },
  });
  return new Set(rows.map((r) => r.agentId));
}

async function metaCountByAgent(prisma: PrismaClient, conversationId: number): Promise<Map<number, number>> {
  const rows = await prisma.message.groupBy({
    by: ["agentId"],
    where: { conversationId, role: "user", kind: "meta" },
    _count: { _all: true },
  });
  const out = new Map<number, number>();
  for (const r of rows) out.set(r.agentId, r._count._all);
  return out;
}

async function firstMessageTsByAgent(prisma: PrismaClient, conversationId: number): Promise<Map<number, number>> {
  const rows = await prisma.message.groupBy({
    by: ["agentId"],
    where: { conversationId },
    _min: { timestamp: true },
  });
  const out = new Map<number, number>();
  for (const r of rows) {
    const ts = r._min.timestamp;
    if (ts !== null) out.set(r.agentId, Number(ts));
  }
  return out;
}

async function resolveSpawnToolUseIds(
  prisma: PrismaClient,
  agents: AgentRow[],
  firstTsByAgent: Map<number, number>,
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  const spawnMsgIds = [...new Set(agents.map((a) => a.spawnedByMessageId).filter((x): x is number => x !== null))];
  if (spawnMsgIds.length === 0) return out;

  const calls = await prisma.toolCall.findMany({
    where: { messageId: { in: spawnMsgIds }, name: "Agent" },
    select: { messageId: true, toolUseId: true },
    orderBy: { id: "asc" },
  });
  const callsByMsg = new Map<number, (string | null)[]>();
  for (const c of calls) {
    let arr = callsByMsg.get(c.messageId);
    if (arr === undefined) {
      arr = [];
      callsByMsg.set(c.messageId, arr);
    }
    arr.push(c.toolUseId);
  }

  const kidsByMsg = new Map<number, AgentRow[]>();
  for (const a of agents) {
    if (a.spawnedByMessageId === null) continue;
    let arr = kidsByMsg.get(a.spawnedByMessageId);
    if (arr === undefined) {
      arr = [];
      kidsByMsg.set(a.spawnedByMessageId, arr);
    }
    arr.push(a);
  }
  const ts = (aid: number) => firstTsByAgent.get(aid) ?? Number.MAX_SAFE_INTEGER;
  for (const [msgId, kids] of kidsByMsg) {
    const ordered = [...kids].sort((x, y) => ts(x.id) - ts(y.id) || x.id - y.id);
    const msgCalls = callsByMsg.get(msgId) ?? [];
    ordered.forEach((kid, i) => out.set(kid.id, msgCalls[i] ?? null));
  }
  return out;
}

function buildAgentTree(
  agents: AgentRow[],
  ctx: {
    ownCost: Map<number, OwnCost>;
    errorAgentIds: Set<number>;
    metaByAgent: Map<number, number>;
    firstTsByAgent: Map<number, number>;
    spawnToolUseByAgent: Map<number, string | null>;
  },
): TranscriptAgentNode {
  const nodeById = new Map<number, TranscriptAgentNode>();
  for (const a of agents) {
    const oc = ctx.ownCost.get(a.id) ?? {
      tokens: emptyTokens(),
      costUsd: 0,
      unpriced: false,
    };
    nodeById.set(a.id, {
      id: agentKey(a),
      agentType: a.agentType,
      resolvedModel: a.resolvedModel,
      costUsd: oc.costUsd,
      tokens: oc.tokens,
      unpriced: oc.unpriced,
      hasError: ctx.errorAgentIds.has(a.id),
      metaCount: ctx.metaByAgent.get(a.id) ?? 0,
      spawnedByMessageId: a.spawnedByMessageId,
      spawnedByToolUseId: ctx.spawnToolUseByAgent.get(a.id) ?? null,
      children: [],
    });
  }

  const main = agents.find((a) => a.parentAgentId === null) ?? agents[0];
  const mainId = main?.id;

  const ts = (aid: number) => ctx.firstTsByAgent.get(aid) ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...agents].sort((x, y) => ts(x.id) - ts(y.id) || x.id - y.id);
  for (const a of ordered) {
    if (a.id === mainId) continue;
    const node = nodeById.get(a.id);
    if (node === undefined) continue;
    const parent = a.parentAgentId !== null ? nodeById.get(a.parentAgentId) : undefined;
    (parent ?? (mainId === undefined ? undefined : nodeById.get(mainId)))?.children.push(node);
  }

  return mainId === undefined ? emptyMainNode() : (nodeById.get(mainId) as TranscriptAgentNode);
}

function emptyMainNode(): TranscriptAgentNode {
  return {
    id: "main",
    agentType: null,
    resolvedModel: null,
    costUsd: 0,
    tokens: emptyTokens(),
    unpriced: false,
    hasError: false,
    metaCount: 0,
    spawnedByMessageId: null,
    spawnedByToolUseId: null,
    children: [],
  };
}

async function readAgentTranscript(prisma: PrismaClient, agentId: number): Promise<TranscriptMessage[]> {
  const rows = await prisma.message.findMany({
    where: {
      agentId,
      OR: [{ role: "assistant" }, { role: "user", kind: "prompt" }],
    },
    orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    select: {
      id: true,
      uuid: true,
      role: true,
      kind: true,
      text: true,
      model: true,
      effort: true,
      inputTokens: true,
      outputTokens: true,
      cacheCreation5mTokens: true,
      cacheCreation1hTokens: true,
      cacheReadTokens: true,
      isApiError: true,
      apiErrorMessage: true,
      timestamp: true,
    },
  });

  const toolCallsByMsg = await toolCallsByMessage(
    prisma,
    rows.map((r) => r.id),
  );

  return rows.map((r) => {
    const turn = priceTurn(r);
    return {
      id: r.id,
      uuid: r.uuid,
      role: r.role,
      kind: r.kind,
      text: r.text,
      model: r.model,
      effort: r.effort,
      tokens: turn.tokens,
      costUsd: turn.costUsd,
      unpriced: turn.unpriced,
      isApiError: r.isApiError,
      apiErrorMessage: r.apiErrorMessage,
      timestamp: r.timestamp === null ? null : new Date(Number(r.timestamp)).toISOString(),
      toolCalls: toolCallsByMsg.get(r.id) ?? [],
    };
  });
}

type TurnRow = {
  role: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
  cacheReadTokens: number | null;
};

function priceTurn(row: TurnRow): {
  tokens: Tokens | null;
  costUsd: number;
  unpriced: boolean;
} {
  if (row.role !== "assistant") {
    return { tokens: null, costUsd: 0, unpriced: false };
  }
  const input = row.inputTokens ?? 0;
  const output = row.outputTokens ?? 0;
  const cw5m = row.cacheCreation5mTokens ?? 0;
  const cw1h = row.cacheCreation1hTokens ?? 0;
  const cr = row.cacheReadTokens ?? 0;
  const cacheWrite = cw5m + cw1h;
  const tokens: Tokens = {
    input,
    output,
    cacheWrite,
    cacheRead: cr,
    total: input + output + cacheWrite + cr,
  };
  if (row.model === null) {
    return { tokens, costUsd: 0, unpriced: true };
  }
  const cost = priceSplitByType({ input, output, cacheWrite5m: cw5m, cacheWrite1h: cw1h, cacheRead: cr }, row.model);
  return { tokens, costUsd: cost.usd, unpriced: cost.unpriced };
}

async function toolCallsByMessage(
  prisma: PrismaClient,
  messageIds: number[],
): Promise<Map<number, TranscriptToolCall[]>> {
  const out = new Map<number, TranscriptToolCall[]>();
  if (messageIds.length === 0) return out;
  const rows = await prisma.toolCall.findMany({
    where: { messageId: { in: messageIds } },
    orderBy: { id: "asc" },
    select: {
      messageId: true,
      toolUseId: true,
      name: true,
      inputJson: true,
      resultText: true,
      resultTruncated: true,
      resultCharSize: true,
      isError: true,
    },
  });
  for (const r of rows) {
    let arr = out.get(r.messageId);
    if (arr === undefined) {
      arr = [];
      out.set(r.messageId, arr);
    }
    arr.push({
      toolUseId: r.toolUseId,
      name: r.name,
      inputJson: r.inputJson,
      resultText: r.resultText,
      resultTruncated: r.resultTruncated,
      resultCharSize: r.resultCharSize,
      isError: r.isError,
    });
  }
  return out;
}

type ConversationRow = {
  id: number;
  sessionId: string;
  title: string | null;
  continuedFromConversationId: number | null;
  project: { folderName: string; path: string };
};

type ModelSumRow = {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
  cacheReadTokens: number | null;
};

type PricedGroup = {
  model: string;
  tokens: Tokens;
  costUsd: number;
  costByType: CostByType;
  unpriced: boolean;
};

function priceModelRow(row: ModelSumRow): PricedGroup {
  const model = row.model as string;
  const input = Number(row.inputTokens ?? 0);
  const output = Number(row.outputTokens ?? 0);
  const cw5m = Number(row.cacheCreation5mTokens ?? 0);
  const cw1h = Number(row.cacheCreation1hTokens ?? 0);
  const cr = Number(row.cacheReadTokens ?? 0);
  const cacheWrite = cw5m + cw1h;
  const tokens: Tokens = {
    input,
    output,
    cacheWrite,
    cacheRead: cr,
    total: input + output + cacheWrite + cr,
  };
  const cost = priceSplitByType({ input, output, cacheWrite5m: cw5m, cacheWrite1h: cw1h, cacheRead: cr }, model);
  return {
    model,
    tokens,
    costUsd: cost.usd,
    costByType: cost.byType,
    unpriced: resolveModel(model).unpriced,
  };
}

function pricedRollup(rows: ModelSumRow[]): PricedGroup[] {
  const byModel = new Map<string, PricedGroup>();
  const order: string[] = [];
  for (const row of rows) {
    if (row.model === null) continue;
    const priced = priceModelRow(row);
    const existing = byModel.get(priced.model);
    if (existing === undefined) {
      byModel.set(priced.model, priced);
      order.push(priced.model);
      continue;
    }
    addTokens(existing.tokens, priced.tokens);
    existing.costUsd += priced.costUsd;
    addCostByType(existing.costByType, priced.costByType);
    existing.unpriced = existing.unpriced || priced.unpriced;
  }
  return order.map((m) => byModel.get(m) as PricedGroup);
}

function toModelSumRow(g: {
  model: string | null;
  _sum: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheCreation5mTokens: number | null;
    cacheCreation1hTokens: number | null;
    cacheReadTokens: number | null;
  };
}): ModelSumRow {
  return {
    model: g.model,
    inputTokens: g._sum.inputTokens,
    outputTokens: g._sum.outputTokens,
    cacheCreation5mTokens: g._sum.cacheCreation5mTokens,
    cacheCreation1hTokens: g._sum.cacheCreation1hTokens,
    cacheReadTokens: g._sum.cacheReadTokens,
  };
}

const TOKEN_SUM = {
  inputTokens: true,
  outputTokens: true,
  cacheCreation5mTokens: true,
  cacheCreation1hTokens: true,
  cacheReadTokens: true,
} as const;

function addCostByType(a: CostByType, b: CostByType): void {
  a.input += b.input;
  a.output += b.output;
  a.cacheWrite += b.cacheWrite;
  a.cacheRead += b.cacheRead;
}

function addTokens(a: Tokens, b: Tokens): void {
  a.input += b.input;
  a.output += b.output;
  a.cacheWrite += b.cacheWrite;
  a.cacheRead += b.cacheRead;
  a.total = a.input + a.output + a.cacheWrite + a.cacheRead;
}

async function pricedGroupsByModel(prisma: PrismaClient, conversationId: number): Promise<PricedGroup[]> {
  const grouped = await prisma.message.groupBy({
    by: ["model"],
    where: { conversationId },
    _sum: TOKEN_SUM,
  });
  return pricedRollup(grouped.map(toModelSumRow));
}

function isoBounds(
  minTs: bigint | number | null,
  maxTs: bigint | number | null,
): { startedAt: string; endedAt: string } {
  const min = minTs == null ? null : Number(minTs);
  const max = maxTs == null ? null : Number(maxTs);
  return {
    startedAt: min === null ? "" : new Date(min).toISOString(),
    endedAt: max === null ? "" : new Date(max).toISOString(),
  };
}

async function timeBounds(
  prisma: PrismaClient,
  conversationId: number,
): Promise<{ startedAt: string; endedAt: string }> {
  const bounds = await prisma.message.aggregate({
    where: { conversationId },
    _min: { timestamp: true },
    _max: { timestamp: true },
  });
  return isoBounds(bounds._min.timestamp, bounds._max.timestamp);
}

function assembleSummary(
  convo: ConversationRow,
  parts: {
    groups: PricedGroup[];
    bounds: { startedAt: string; endedAt: string };
    subAgentCount: number;
    errorCount: number;
    continuedFromId: string | null;
  },
): ConversationSummary {
  const totals: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
  const costByType: CostByType = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let costUsd = 0;
  let unpriced = false;
  let dominant = "";
  let dominantOutput = -1;

  for (const g of parts.groups) {
    addTokens(totals, g.tokens);
    costUsd += g.costUsd;
    addCostByType(costByType, g.costByType);
    if (g.unpriced) unpriced = true;
    if (g.tokens.output > dominantOutput) {
      dominant = g.model;
      dominantOutput = g.tokens.output;
    }
  }

  return {
    id: convo.sessionId,
    title: convo.title,
    project: { folder: convo.project.folderName, path: convo.project.path },
    startedAt: parts.bounds.startedAt,
    endedAt: parts.bounds.endedAt,
    models: { dominant, distinctCount: parts.groups.length },
    tokens: totals,
    costUsd,
    costByType,
    unpriced,
    subAgentCount: parts.subAgentCount,
    errorCount: parts.errorCount,
    continuedFromId: parts.continuedFromId,
  };
}

async function summarizeConversation(
  prisma: PrismaClient,
  convo: ConversationRow,
): Promise<{ summary: ConversationSummary; groups: PricedGroup[] }> {
  const groups = await pricedGroupsByModel(prisma, convo.id);
  const bounds = await timeBounds(prisma, convo.id);
  const subAgentCount = await prisma.agent.count({
    where: { conversationId: convo.id, parentAgentId: { not: null } },
  });
  const errorCount = await prisma.message.count({
    where: { conversationId: convo.id, isApiError: true },
  });

  let continuedFromId: string | null = null;
  if (convo.continuedFromConversationId !== null) {
    const from = await prisma.conversation.findUnique({
      where: { id: convo.continuedFromConversationId },
      select: { sessionId: true },
    });
    continuedFromId = from?.sessionId ?? null;
  }

  const summary = assembleSummary(convo, {
    groups,
    bounds,
    subAgentCount,
    errorCount,
    continuedFromId,
  });
  return { summary, groups };
}

function sortSummaries(summaries: ConversationSummary[], sortBy: keyof ConversationSummary, dir: "asc" | "desc"): void {
  const factor = dir === "desc" ? -1 : 1;
  summaries.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
}
