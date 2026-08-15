import { readClient } from "@/core/db";
import type { PrismaClient } from "@/core/prisma/generated/client";
import { addLocalDays, startOfLocalDay } from "@/core/local-day";

export type ToolStat = {
  name: string;
  calls: number;
  errors: number;
  errorRate: number;
  sizedCalls: number;
  meanSize: number | null;
  p50Size: number | null;
  p95Size: number | null;
  maxSize: number | null;
  totalSize: number;
};

export type ToolStats = {
  tools: ToolStat[];
  totalCalls: number;
  totalErrors: number;
  totalSize: number;
};

export type ToolStatsOptions = {
  folder?: string;
  days?: number;
  now?: number;
  dbPath?: string;
};

export async function getToolStats(opts: ToolStatsOptions = {}): Promise<ToolStats> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const rows = await prisma.toolCall.findMany({
      where: scopeWhere(opts),
      select: { name: true, isError: true, resultCharSize: true },
    });
    return assembleToolStats(rows);
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

type ToolCallRow = {
  name: string;
  isError: boolean;
  resultCharSize: number | null;
};

type Accumulator = {
  name: string;
  calls: number;
  errors: number;
  sizes: number[];
};

function assembleToolStats(rows: ToolCallRow[]): ToolStats {
  const byName = new Map<string, Accumulator>();
  for (const row of rows) {
    let acc = byName.get(row.name);
    if (acc === undefined) {
      acc = { name: row.name, calls: 0, errors: 0, sizes: [] };
      byName.set(row.name, acc);
    }
    acc.calls += 1;
    if (row.isError) acc.errors += 1;
    if (row.resultCharSize !== null) acc.sizes.push(row.resultCharSize);
  }

  const tools = [...byName.values()].map(summarize).sort(byCallsDesc);
  return {
    tools,
    totalCalls: tools.reduce((sum, t) => sum + t.calls, 0),
    totalErrors: tools.reduce((sum, t) => sum + t.errors, 0),
    totalSize: tools.reduce((sum, t) => sum + t.totalSize, 0),
  };
}

function summarize(acc: Accumulator): ToolStat {
  const sizes = [...acc.sizes].sort((a, b) => a - b);
  const totalSize = sizes.reduce((sum, size) => sum + size, 0);
  const sized = sizes.length > 0;
  return {
    name: acc.name,
    calls: acc.calls,
    errors: acc.errors,
    errorRate: acc.calls === 0 ? 0 : acc.errors / acc.calls,
    sizedCalls: sizes.length,
    meanSize: sized ? totalSize / sizes.length : null,
    p50Size: sized ? percentile(sizes, 0.5) : null,
    p95Size: sized ? percentile(sizes, 0.95) : null,
    maxSize: sized ? sizes[sizes.length - 1] : null,
    totalSize,
  };
}

function percentile(sizes: number[], k: number): number {
  const index = Math.min(sizes.length - 1, Math.max(0, Math.ceil(k * sizes.length) - 1));
  return sizes[index];
}

function byCallsDesc(a: ToolStat, b: ToolStat): number {
  if (a.calls !== b.calls) return b.calls - a.calls;
  return a.name.localeCompare(b.name);
}

function scopeWhere(opts: ToolStatsOptions) {
  const today = startOfLocalDay(opts.now ?? Date.now());
  const from = opts.days === undefined ? null : addLocalDays(today, 1 - opts.days);
  return {
    message: {
      timestamp: {
        lt: BigInt(addLocalDays(today, 1).getTime()),
        ...(from === null ? {} : { gte: BigInt(from.getTime()) }),
      },
      ...(opts.folder === undefined ? {} : { conversation: { project: { folderName: opts.folder } } }),
    },
  };
}

export type ToolCallSample = {
  sessionId: string;
  conversationTitle: string | null;
  agentId: string;
  toolUseId: string | null;
  timestamp: string | null;
  charSize: number | null;
  isError: boolean;
  inputJson: string;
  excerpt: string | null;
};

export type ToolBreakdownEntry = {
  key: string;
  calls: number;
  errors: number;
};

export type ToolCallSamples = {
  name: string;
  recentErrors: ToolCallSample[];
  largestResults: ToolCallSample[];
  breakdown: ToolBreakdownEntry[];
};

const DEFAULT_SAMPLE_LIMIT = 5;

const EXCERPT_CHARS = 240;

const UNKNOWN_KEY = "unknown";

const BREAKDOWN_FIELD: Record<string, string> = {
  Skill: "skill",
  Agent: "subagent_type",
};

export type ToolCallSamplesOptions = ToolStatsOptions & {
  limit?: number;
};

export async function getToolCallSamples(name: string, opts: ToolCallSamplesOptions = {}): Promise<ToolCallSamples> {
  const limit = opts.limit ?? DEFAULT_SAMPLE_LIMIT;
  const { prisma, owned } = readClient(opts.dbPath);
  const where = { name, ...scopeWhere(opts) };
  try {
    const [errorRows, largestRows] = await Promise.all([
      prisma.toolCall.findMany({
        where: { ...where, isError: true },
        orderBy: [{ message: { timestamp: "desc" } }, { toolUseId: "asc" }],
        take: limit,
        select: SAMPLE_SELECT,
      }),
      prisma.toolCall.findMany({
        where: { ...where, resultCharSize: { not: null } },
        orderBy: [{ resultCharSize: "desc" }, { toolUseId: "asc" }],
        take: limit,
        select: SAMPLE_SELECT,
      }),
    ]);

    return {
      name,
      recentErrors: errorRows.map(toSample),
      largestResults: largestRows.map(toSample),
      breakdown: await breakdownFor(name, prisma, where),
    };
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

const SAMPLE_SELECT = {
  toolUseId: true,
  inputJson: true,
  resultText: true,
  resultCharSize: true,
  isError: true,
  agent: { select: { id: true, externalAgentId: true } },
  message: {
    select: {
      timestamp: true,
      conversation: { select: { sessionId: true, title: true } },
    },
  },
} as const;

type BreakdownClient = Pick<PrismaClient, "toolCall">;

type SampleRow = {
  toolUseId: string | null;
  inputJson: string;
  resultText: string | null;
  resultCharSize: number | null;
  isError: boolean;
  agent: { id: number; externalAgentId: string | null };
  message: {
    timestamp: bigint | number | null;
    conversation: { sessionId: string; title: string | null };
  } | null;
};

function toSample(row: SampleRow): ToolCallSample {
  const ts = row.message?.timestamp ?? null;
  return {
    sessionId: row.message?.conversation.sessionId ?? "",
    conversationTitle: row.message?.conversation.title ?? null,
    agentId: row.agent.externalAgentId ?? String(row.agent.id),
    toolUseId: row.toolUseId,
    timestamp: ts === null ? null : new Date(Number(ts)).toISOString(),
    charSize: row.resultCharSize,
    isError: row.isError,
    inputJson: row.inputJson,
    excerpt: row.resultText === null ? null : row.resultText.slice(0, EXCERPT_CHARS),
  };
}

async function breakdownFor(name: string, prisma: BreakdownClient, where: object): Promise<ToolBreakdownEntry[]> {
  const field = BREAKDOWN_FIELD[name];
  if (field === undefined) return [];

  const rows = await prisma.toolCall.findMany({
    where,
    select: { inputJson: true, isError: true },
  });

  const byKey = new Map<string, ToolBreakdownEntry>();
  for (const row of rows) {
    const key = inputField(row.inputJson, field) ?? UNKNOWN_KEY;
    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = { key, calls: 0, errors: 0 };
      byKey.set(key, entry);
    }
    entry.calls += 1;
    if (row.isError) entry.errors += 1;
  }

  return [...byKey.values()].sort((a, b) => (a.calls === b.calls ? a.key.localeCompare(b.key) : b.calls - a.calls));
}

function inputField(inputJson: string, field: string): string | null {
  try {
    const parsed: unknown = JSON.parse(inputJson);
    if (parsed === null || typeof parsed !== "object") return null;
    const value = (parsed as Record<string, unknown>)[field];
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}
