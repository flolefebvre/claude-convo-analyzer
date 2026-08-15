import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createPrismaClient, DEFAULT_DB_PATH } from "@/core/db";
import {
  decodeFolderName,
  DEFAULT_LOGS_ROOT,
  type DiscoveredSession,
  discoverSessions,
  discoverSubAgents,
} from "@/core/discovery";
import { type ParsedAgentSpawn, parseSessionLines, type ParsedSession } from "@/core/parse";
import type { PrismaClient } from "@/core/prisma/generated/client";

type PrismaTx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

type ToolCallData = {
  messageId: number;
  agentId: number;
  toolUseId: string | null;
  name: string;
  inputJson: string;
  resultText: string | null;
  resultTruncated: boolean;
  resultCharSize: number | null;
  isError: boolean;
};

export type DuplicateSessionSkip = {
  sessionId: string;
  keptPath: string;
  skippedPath: string;
};

export type RefreshSummary = {
  conversationsParsed: number;
  conversationsSkipped: number;
  conversationsDeleted: number;
  malformedLinesSkipped: number;
  duplicateSessionsSkipped: DuplicateSessionSkip[];
  durationMs: number;
};

type RefreshOptions = { logsRoot?: string; dbPath?: string };

const PARSER_VERSION = 2;

const UNSTAMPED_PARSER_VERSION = 0;

type ParsedConversation = {
  session: DiscoveredSession;
  parsed: ParsedSession;
  subAgents: { agentId: string; parsed: ParsedSession }[];
  priorId: number | null;
};

type DiscoveredWithKey = {
  session: DiscoveredSession;
  subAgentPaths: { agentId: string; sourcePath: string }[];
  compositeMtime: number;
  compositeSize: number;
};

export async function refresh(opts: RefreshOptions = {}): Promise<RefreshSummary> {
  const start = performance.now();
  const logsRoot = opts.logsRoot ?? DEFAULT_LOGS_ROOT;
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  const prisma = createPrismaClient(dbPath);

  let conversationsParsed = 0;
  let conversationsSkipped = 0;
  let conversationsDeleted = 0;
  let malformedLinesSkipped = 0;

  let duplicateSessionsSkipped: DuplicateSessionSkip[] = [];

  try {
    const { unique: discovered, duplicatesSkipped } = dedupeBySessionId(discoverWithKeys(logsRoot));
    duplicateSessionsSkipped = duplicatesSkipped;

    const existing = new Map<
      string,
      {
        id: number;
        sourcePath: string;
        mtime: bigint;
        size: bigint;
        parserVersion: number;
      }
    >();
    for (const row of await prisma.conversation.findMany({
      select: {
        id: true,
        sessionId: true,
        sourcePath: true,
        sourceMtime: true,
        sourceSize: true,
        parserVersion: true,
      },
    })) {
      existing.set(row.sessionId, {
        id: row.id,
        sourcePath: row.sourcePath,
        mtime: row.sourceMtime,
        size: row.sourceSize,
        parserVersion: row.parserVersion,
      });
    }

    const onDisk = new Set(discovered.map((d) => d.session.sessionId));
    for (const [sessionId, row] of existing) {
      if (onDisk.has(sessionId)) continue;
      await prisma.conversation.delete({ where: { id: row.id } });
      conversationsDeleted += 1;
    }

    const conversations: ParsedConversation[] = [];

    for (const d of discovered) {
      const prior = existing.get(d.session.sessionId);
      const unchanged =
        prior !== undefined &&
        prior.parserVersion === PARSER_VERSION &&
        prior.sourcePath === d.session.sourcePath &&
        prior.mtime === BigInt(d.compositeMtime) &&
        prior.size === BigInt(d.compositeSize);
      if (unchanged) {
        conversationsSkipped += 1;
        continue;
      }

      const session: DiscoveredSession = {
        ...d.session,
        sourceMtime: d.compositeMtime,
        sourceSize: d.compositeSize,
      };

      const parsed = parseSession(session.sourcePath);
      malformedLinesSkipped += parsed.malformedLines;

      const subAgents: { agentId: string; parsed: ParsedSession }[] = [];
      for (const sub of d.subAgentPaths) {
        const subParsed = parseSession(sub.sourcePath);
        malformedLinesSkipped += subParsed.malformedLines;
        subAgents.push({ agentId: sub.agentId, parsed: subParsed });
      }

      conversations.push({ session, parsed, subAgents, priorId: prior?.id ?? null });
    }

    for (const convo of conversations) {
      if (convo.priorId !== null) {
        await prisma.conversation.delete({ where: { id: convo.priorId } });
      }
      await writeConversation(prisma, convo);
      conversationsParsed += 1;
    }

    await resolveContinuedFrom(prisma, conversations);

    await stampParserVersion(prisma, conversations);
  } finally {
    await prisma.$disconnect();
  }

  return {
    conversationsParsed,
    conversationsSkipped,
    conversationsDeleted,
    malformedLinesSkipped,
    duplicateSessionsSkipped,
    durationMs: Math.round(performance.now() - start),
  };
}

function dedupeBySessionId(discovered: DiscoveredWithKey[]): {
  unique: DiscoveredWithKey[];
  duplicatesSkipped: DuplicateSessionSkip[];
} {
  const bySmallestPath = [...discovered].sort((a, b) => (a.session.sourcePath < b.session.sourcePath ? -1 : 1));

  const unique: DiscoveredWithKey[] = [];
  const duplicatesSkipped: DuplicateSessionSkip[] = [];
  const keptPathBySessionId = new Map<string, string>();
  for (const d of bySmallestPath) {
    const { sessionId, sourcePath } = d.session;
    const keptPath = keptPathBySessionId.get(sessionId);
    if (keptPath !== undefined) {
      duplicatesSkipped.push({ sessionId, keptPath, skippedPath: sourcePath });
      continue;
    }
    keptPathBySessionId.set(sessionId, sourcePath);
    unique.push(d);
  }
  return { unique, duplicatesSkipped };
}

function discoverWithKeys(logsRoot: string): DiscoveredWithKey[] {
  const out: DiscoveredWithKey[] = [];
  for (const session of discoverSessions(logsRoot)) {
    const projectDir = path.dirname(session.sourcePath);
    const subAgentPaths = discoverSubAgents(projectDir, session.sessionId).map((s) => ({
      agentId: s.agentId,
      sourcePath: s.sourcePath,
    }));

    let compositeMtime = session.sourceMtime;
    let compositeSize = session.sourceSize;
    for (const sub of subAgentPaths) {
      const stat = statSync(sub.sourcePath);
      compositeMtime = Math.max(compositeMtime, Math.floor(stat.mtimeMs));
      compositeSize += stat.size;
    }

    out.push({ session, subAgentPaths, compositeMtime, compositeSize });
  }
  return out;
}

function parseSession(sourcePath: string): ParsedSession {
  return parseSessionLines(readFileSync(sourcePath, "utf8").split("\n"));
}

async function upsertProject(prisma: PrismaClient, folder: string, parsed: ParsedSession): Promise<number> {
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

function messageData(m: ParsedSession["messages"][number], conversationId: number, agentId: number) {
  return {
    conversationId,
    agentId,
    messageId: m.messageId,
    uuid: m.uuid,
    role: m.role,
    kind: m.kind,
    text: m.text,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheCreation5mTokens: m.cacheCreation5mTokens,
    cacheCreation1hTokens: m.cacheCreation1hTokens,
    cacheReadTokens: m.cacheReadTokens,
    model: m.model,
    effort: m.effort,
    attributionSkill: m.attributionSkill,
    attributionAgent: m.attributionAgent,
    attributionPlugin: m.attributionPlugin,
    attributionMcpServer: m.attributionMcpServer,
    permissionMode: m.permissionMode,
    isApiError: m.isApiError,
    apiErrorMessage: m.apiErrorMessage,
    timestamp: m.timestamp === null ? null : BigInt(m.timestamp),
  };
}

const RESULT_TRUNCATE_CHARS = 10_000;

async function writeToolCalls(
  tx: PrismaTx,
  parsed: ParsedSession,
  agentId: number,
  messageRowByMsgId: Map<string, number>,
): Promise<void> {
  const rows: ToolCallData[] = [];
  for (const msg of parsed.messages) {
    if (msg.toolUses.length === 0 || msg.messageId === null) continue;
    const messageRowId = messageRowByMsgId.get(msg.messageId);
    if (messageRowId === undefined) continue;

    for (const tu of msg.toolUses) {
      const result = tu.toolUseId === null ? undefined : parsed.toolResults.get(tu.toolUseId);
      const fullResult = result?.resultText ?? null;
      const truncated = fullResult !== null && fullResult.length > RESULT_TRUNCATE_CHARS;
      rows.push({
        messageId: messageRowId,
        agentId,
        toolUseId: tu.toolUseId,
        name: tu.name,
        inputJson: tu.inputJson,
        resultText: fullResult === null ? null : fullResult.slice(0, RESULT_TRUNCATE_CHARS),
        resultTruncated: truncated,
        resultCharSize: fullResult === null ? null : fullResult.length,
        isError: result?.isError ?? false,
      });
    }
  }
  if (rows.length > 0) await tx.toolCall.createMany({ data: rows });
}

async function writeAgentMessages(
  tx: PrismaTx,
  parsed: ParsedSession,
  conversationId: number,
  agentId: number,
): Promise<Map<string, number>> {
  if (parsed.messages.length > 0) {
    await tx.message.createMany({
      data: parsed.messages.map((m) => messageData(m, conversationId, agentId)),
    });
  }
  const rows = await tx.message.findMany({
    where: { agentId, messageId: { not: null } },
    select: { id: true, messageId: true },
  });
  const byMsgId = new Map<string, number>();
  for (const r of rows) {
    if (r.messageId !== null) byMsgId.set(r.messageId, r.id);
  }
  return byMsgId;
}

async function writeConversation(prisma: PrismaClient, convo: ParsedConversation): Promise<void> {
  const { session, parsed, subAgents } = convo;
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
        parserVersion: UNSTAMPED_PARSER_VERSION,
        continuedFromConversationId: null,
      },
    });

    const rootAgent = await tx.agent.create({
      data: {
        conversationId: conversation.id,
        parentAgentId: null,
        agentType: null,
        resolvedModel: parsed.dominantModel,
      },
    });

    const rootByMsgId = await writeAgentMessages(tx, parsed, conversation.id, rootAgent.id);
    await writeToolCalls(tx, parsed, rootAgent.id, rootByMsgId);

    const written = new Map<string, AgentWriteTarget>();
    const rootTarget: AgentWriteTarget = {
      agentRowId: rootAgent.id,
      parsed,
      messageRowByMsgId: rootByMsgId,
    };

    for (const plan of planSubAgents(parsed, subAgents)) {
      const parent = plan.parentExternalId === null ? rootTarget : (written.get(plan.parentExternalId) ?? rootTarget);
      const spawnedByMessageId =
        plan.spawn?.toolUseId == null
          ? null
          : (toolUseToMessageRow(parent.parsed, plan.spawn.toolUseId, parent.messageRowByMsgId) ?? null);

      const subAgent = await tx.agent.create({
        data: {
          conversationId: conversation.id,
          parentAgentId: parent.agentRowId,
          externalAgentId: plan.agentId,
          spawnedByMessageId,
          agentType: plan.spawn?.agentType ?? null,
          resolvedModel: plan.spawn?.resolvedModel ?? plan.parsed.dominantModel,
        },
      });

      const subByMsgId = await writeAgentMessages(tx, plan.parsed, conversation.id, subAgent.id);
      await writeToolCalls(tx, plan.parsed, subAgent.id, subByMsgId);
      written.set(plan.agentId, {
        agentRowId: subAgent.id,
        parsed: plan.parsed,
        messageRowByMsgId: subByMsgId,
      });
    }

    if (parsed.prLinks.length > 0) {
      await tx.prLink.createMany({
        data: parsed.prLinks.map((p) => ({
          conversationId: conversation.id,
          prNumber: p.prNumber,
          prUrl: p.prUrl,
          prRepository: p.prRepository,
        })),
      });
    }

    if (parsed.turnDurations.length > 0) {
      await tx.turnDuration.createMany({
        data: parsed.turnDurations.map((t) => ({
          conversationId: conversation.id,
          durationMs: BigInt(t.durationMs),
          messageCount: t.messageCount,
        })),
      });
    }
  });
}

type AgentWriteTarget = {
  agentRowId: number;
  parsed: ParsedSession;
  messageRowByMsgId: Map<string, number>;
};

type SubAgentPlan = {
  agentId: string;
  parsed: ParsedSession;
  parentExternalId: string | null;
  spawn: ParsedAgentSpawn | undefined;
};

function planSubAgents(root: ParsedSession, subAgents: { agentId: string; parsed: ParsedSession }[]): SubAgentPlan[] {
  const ledger = new Map<string, { parentExternalId: string | null; spawn: ParsedAgentSpawn }>();
  for (const [agentId, spawn] of root.agentSpawns) {
    ledger.set(agentId, { parentExternalId: null, spawn });
  }
  for (const sub of subAgents) {
    for (const [agentId, spawn] of sub.parsed.agentSpawns) {
      if (agentId === sub.agentId || ledger.has(agentId)) continue;
      ledger.set(agentId, { parentExternalId: sub.agentId, spawn });
    }
  }

  const ordered: SubAgentPlan[] = [];
  const emitted = new Set<string>();
  const pending = [...subAgents];

  for (let progress = true; progress;) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const sub = pending[i];
      if (sub === undefined) continue;
      const entry = ledger.get(sub.agentId);
      const parentExternalId = entry?.parentExternalId ?? null;
      if (parentExternalId !== null && !emitted.has(parentExternalId)) continue;
      ordered.push({ ...sub, parentExternalId, spawn: entry?.spawn });
      emitted.add(sub.agentId);
      pending.splice(i, 1);
      progress = true;
    }
  }

  for (const sub of pending) {
    ordered.push({
      ...sub,
      parentExternalId: null,
      spawn: ledger.get(sub.agentId)?.spawn,
    });
  }
  return ordered;
}

function toolUseToMessageRow(
  parsed: ParsedSession,
  toolUseId: string,
  messageRowByMsgId: Map<string, number>,
): number | undefined {
  for (const m of parsed.messages) {
    if (m.messageId === null) continue;
    if (m.toolUses.some((tu) => tu.toolUseId === toolUseId)) {
      return messageRowByMsgId.get(m.messageId);
    }
  }
  return undefined;
}

async function resolveContinuedFrom(prisma: PrismaClient, conversations: ParsedConversation[]): Promise<void> {
  for (const convo of conversations) {
    const first = convo.parsed.messages[0];
    if (first?.parentUuid == null) continue;

    const owner = await prisma.message.findFirst({
      where: { uuid: first.parentUuid },
      select: { conversation: { select: { id: true, sessionId: true } } },
    });
    const from = owner?.conversation;
    if (from === undefined || from.sessionId === convo.session.sessionId) {
      continue;
    }

    const toId = (
      await prisma.conversation.findUnique({
        where: { sessionId: convo.session.sessionId },
        select: { id: true },
      })
    )?.id;
    if (toId === undefined) continue;

    await prisma.conversation.update({
      where: { id: toId },
      data: { continuedFromConversationId: from.id },
    });
  }
}

async function stampParserVersion(prisma: PrismaClient, conversations: ParsedConversation[]): Promise<void> {
  if (conversations.length === 0) return;
  await prisma.conversation.updateMany({
    where: { sessionId: { in: conversations.map((c) => c.session.sessionId) } },
    data: { parserVersion: PARSER_VERSION },
  });
}
