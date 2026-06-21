// Ingest spine + read API (ADR-0001, ADR-0002). `refresh()` discovers top-level
// session files, parses them, and writes the `project`/`conversation`/`agent`
// (root only)/`message` tables. `listConversations()` is the stable read seam.
//
// SLICE SCOPE (Slice 3): full scan + write of 4 tables, happy path. No sub-agents,
// tool_call, pr_link, turn_duration, incremental skip/delete, or continued-from
// (Slices 4/5). sourceMtime/sourceSize ARE captured now for Slice 5.
//
// ROLLUP DESIGN (ADR-0001): conversation totals/cost are SUM queries over ALL
// messages of ALL agents in the conversation — so when Slice 4 adds sub-agent
// agents+messages, the rollup includes them with NO change to listConversations.

import { readFileSync } from "node:fs";
import { priceTokenSplit, resolveModel, type Tokens } from "@/core/cost";
import {
  createPrismaClient,
  DEFAULT_DB_PATH,
} from "@/core/db";
import {
  decodeFolderName,
  DEFAULT_LOGS_ROOT,
  discoverSessions,
} from "@/core/discovery";
import { parseSessionLines, type ParsedSession } from "@/core/parse";
import type { PrismaClient } from "@/core/prisma/generated/client";

export type RefreshSummary = {
  conversationsParsed: number;
  conversationsSkipped: number;
  conversationsDeleted: number;
  malformedLinesSkipped: number;
  durationMs: number;
};

export type ConversationSummary = {
  id: string;
  title: string | null;
  project: { folder: string; path: string };
  startedAt: string;
  endedAt: string;
  models: { dominant: string; distinctCount: number };
  tokens: Tokens;
  costUsd: number;
  unpriced: boolean;
  subAgentCount: number;
  continuedFromId: string | null;
};

type RefreshOptions = { logsRoot?: string; dbPath?: string };

/**
 * Full scan → parse → write of the logs root into a fresh-or-existing DB. Each
 * conversation's writes are wrapped in a transaction with `createMany` batch
 * inserts (finding #11) — never row-by-row.
 */
export async function refresh(opts: RefreshOptions = {}): Promise<RefreshSummary> {
  const start = Date.now();
  const logsRoot = opts.logsRoot ?? DEFAULT_LOGS_ROOT;
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  const prisma = createPrismaClient(dbPath);

  let conversationsParsed = 0;
  let malformedLinesSkipped = 0;

  try {
    const sessions = discoverSessions(logsRoot);
    for (const session of sessions) {
      const raw = readFileSync(session.sourcePath, "utf8");
      const parsed = parseSessionLines(raw.split("\n"));
      malformedLinesSkipped += parsed.malformedLines;

      await writeConversation(prisma, session, parsed);
      conversationsParsed += 1;
    }
  } finally {
    await prisma.$disconnect();
  }

  return {
    conversationsParsed,
    conversationsSkipped: 0,
    conversationsDeleted: 0,
    malformedLinesSkipped,
    durationMs: Date.now() - start,
  };
}

/** Resolve (find-or-create) the project row for an on-disk folder. */
async function upsertProject(
  prisma: PrismaClient,
  folder: string,
  parsed: ParsedSession,
): Promise<number> {
  const projectPath = parsed.cwd ?? decodeFolderName(folder);
  const existing = await prisma.project.findUnique({
    where: { path: projectPath },
  });
  if (existing) return existing.id;
  const created = await prisma.project.create({
    data: { path: projectPath, folderName: folder },
  });
  return created.id;
}

/**
 * Write one conversation + its root agent + messages in a single transaction.
 * The root agent's `resolvedModel` is the dominant model. Messages FK to it.
 */
async function writeConversation(
  prisma: PrismaClient,
  session: { folder: string; sessionId: string; sourcePath: string; sourceMtime: number; sourceSize: number },
  parsed: ParsedSession,
): Promise<void> {
  const projectId = await upsertProject(prisma, session.folder, parsed);

  await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: {
        sessionId: session.sessionId,
        projectId,
        title: parsed.title,
        gitBranch: parsed.gitBranch,
        ccVersion: parsed.ccVersion,
        sourcePath: session.sourcePath,
        sourceMtime: BigInt(session.sourceMtime),
        sourceSize: BigInt(session.sourceSize),
        continuedFromConversationId: null,
      },
    });

    const agent = await tx.agent.create({
      data: {
        conversationId: conversation.id,
        parentAgentId: null,
        agentType: null, // root/main thread
        resolvedModel: parsed.dominantModel,
      },
    });

    if (parsed.messages.length > 0) {
      await tx.message.createMany({
        data: parsed.messages.map((m) => ({
          conversationId: conversation.id,
          agentId: agent.id,
          messageId: m.messageId,
          role: m.role,
          text: m.text,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          cacheCreation5mTokens: m.cacheCreation5mTokens,
          cacheCreation1hTokens: m.cacheCreation1hTokens,
          cacheReadTokens: m.cacheReadTokens,
          model: m.model,
          attributionSkill: m.attributionSkill,
          attributionAgent: m.attributionAgent,
          attributionPlugin: m.attributionPlugin,
          attributionMcpServer: m.attributionMcpServer,
          permissionMode: m.permissionMode,
          isApiError: m.isApiError,
          apiErrorMessage: m.apiErrorMessage,
          timestamp: m.timestamp === null ? null : BigInt(m.timestamp),
        })),
      });
    }
  });
}

type ListOptions = {
  sortBy?: keyof ConversationSummary;
  dir?: "asc" | "desc";
  /** Additional (non-seam) opt for isolated DBs in refresh + tests. */
  dbPath?: string;
};

/**
 * Read all conversations as `ConversationSummary[]`. Totals and cost are computed
 * as SUM queries over every message of every agent in the conversation (ADR-0001),
 * so sub-agents added in Slice 4 roll up automatically.
 */
export async function listConversations(
  opts: ListOptions = {},
): Promise<ConversationSummary[]> {
  const prisma = createPrismaClient(opts.dbPath ?? DEFAULT_DB_PATH);
  try {
    const conversations = await prisma.conversation.findMany({
      include: { project: true },
    });

    const summaries: ConversationSummary[] = [];
    for (const convo of conversations) {
      summaries.push(await summarizeConversation(prisma, convo));
    }

    if (opts.sortBy) {
      sortSummaries(summaries, opts.sortBy, opts.dir ?? "asc");
    }
    return summaries;
  } finally {
    await prisma.$disconnect();
  }
}

type ConversationRow = {
  id: number;
  sessionId: string;
  title: string | null;
  project: { folderName: string; path: string };
};

/** Per-model token sums for one conversation (across all its agents' messages). */
type ModelRow = {
  model: string | null;
  input: bigint | number | null;
  output: bigint | number | null;
  cw5m: bigint | number | null;
  cw1h: bigint | number | null;
  cr: bigint | number | null;
};

async function summarizeConversation(
  prisma: PrismaClient,
  convo: ConversationRow,
): Promise<ConversationSummary> {
  // Per-model token sums via a single grouped SUM query over all agents'
  // messages (ADR-0001: SUM, never stored aggregates).
  const perModel = await prisma.$queryRawUnsafe<ModelRow[]>(
    `SELECT m.model AS model,
            SUM(COALESCE(m.input_tokens, 0)) AS input,
            SUM(COALESCE(m.output_tokens, 0)) AS output,
            SUM(COALESCE(m.cache_creation_5m_tokens, 0)) AS cw5m,
            SUM(COALESCE(m.cache_creation_1h_tokens, 0)) AS cw1h,
            SUM(COALESCE(m.cache_read_tokens, 0)) AS cr
       FROM message m
       JOIN agent a ON a.id = m.agent_id
      WHERE a.conversation_id = ?
        AND m.model IS NOT NULL
      GROUP BY m.model`,
    convo.id,
  );

  const totals: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
  let costUsd = 0;
  let unpriced = false;
  let dominant = "";
  let dominantOutput = -1;

  for (const row of perModel) {
    const model = row.model as string; // model IS NOT NULL filtered above
    const input = Number(row.input ?? 0);
    const output = Number(row.output ?? 0);
    const cw5m = Number(row.cw5m ?? 0);
    const cw1h = Number(row.cw1h ?? 0);
    const cr = Number(row.cr ?? 0);

    totals.input += input;
    totals.output += output;
    totals.cacheWrite += cw5m + cw1h;
    totals.cacheRead += cr;

    const cost = priceTokenSplit(
      { input, output, cacheWrite5m: cw5m, cacheWrite1h: cw1h, cacheRead: cr },
      model,
    );
    costUsd += cost.usd;
    if (resolveModel(model).unpriced) unpriced = true;

    if (output > dominantOutput) {
      dominant = model;
      dominantOutput = output;
    }
  }
  totals.total = totals.input + totals.output + totals.cacheWrite + totals.cacheRead;

  // startedAt/endedAt from min/max message timestamps across all agents.
  const bounds = await prisma.$queryRawUnsafe<{ minTs: bigint | number | null; maxTs: bigint | number | null }[]>(
    `SELECT MIN(m.timestamp) AS minTs, MAX(m.timestamp) AS maxTs
       FROM message m
       JOIN agent a ON a.id = m.agent_id
      WHERE a.conversation_id = ?
        AND m.timestamp IS NOT NULL`,
    convo.id,
  );
  const minTs = bounds[0]?.minTs == null ? null : Number(bounds[0].minTs);
  const maxTs = bounds[0]?.maxTs == null ? null : Number(bounds[0].maxTs);
  const startedAt = minTs === null ? "" : new Date(minTs).toISOString();
  const endedAt = maxTs === null ? "" : new Date(maxTs).toISOString();

  return {
    id: convo.sessionId,
    title: convo.title,
    project: { folder: convo.project.folderName, path: convo.project.path },
    startedAt,
    endedAt,
    models: { dominant, distinctCount: perModel.length },
    tokens: totals,
    costUsd,
    unpriced,
    subAgentCount: 0,
    continuedFromId: null,
  };
}

function sortSummaries(
  summaries: ConversationSummary[],
  sortBy: keyof ConversationSummary,
  dir: "asc" | "desc",
): void {
  const factor = dir === "desc" ? -1 : 1;
  summaries.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
}
