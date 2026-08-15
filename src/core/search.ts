import { readClient } from "@/core/db";
import { Prisma, type PrismaClient } from "@/core/prisma/generated/client";

const DEFAULT_LIMIT = 50;

const SNIPPETS_PER_RESULT = 3;

const SNIPPET_TOKENS = 12;

const MARK_OPEN = "";
const MARK_CLOSE = "";

export type SearchSegment = {
  text: string;
  match: boolean;
};

export type SearchSnippet = {
  source: "message" | "title";
  messageUuid: string | null;
  agentId: string | null;
  segments: SearchSegment[];
};

export type SearchResult = {
  sessionId: string;
  title: string | null;
  project: { folder: string; path: string };
  lastMatchAt: string | null;
  matchCount: number;
  snippets: SearchSnippet[];
};

export type SearchResults = {
  results: SearchResult[];
  hasMore: boolean;
};

type SearchOptions = {
  limit?: number;
  dbPath?: string;
};

export async function searchConversations(rawQuery: string, opts: SearchOptions = {}): Promise<SearchResults> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const match = toFtsQuery(rawQuery);
  if (match === null) return { results: [], hasMore: false };

  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const [messageHits, titleHitIds] = await Promise.all([
      messageHitsByConversation(prisma, match),
      titleHitConversationIds(prisma, match),
    ]);

    const conversationIds = [...new Set([...messageHits.keys(), ...titleHitIds])];
    if (conversationIds.length === 0) return { results: [], hasMore: false };

    const lastActivity = await lastActivityByConversation(
      prisma,
      conversationIds.filter((id) => !messageHits.has(id)),
    );

    const ordered = conversationIds
      .map((id) => ({
        id,
        lastMatchAt: messageHits.get(id)?.lastTs ?? lastActivity.get(id) ?? null,
      }))
      .sort((a, b) => (b.lastMatchAt ?? -1) - (a.lastMatchAt ?? -1) || b.id - a.id);

    const page = ordered.slice(0, limit);
    const pageIds = page.map((p) => p.id);

    const [rows, snippets] = await Promise.all([
      conversationRows(prisma, pageIds),
      messageSnippets(prisma, match, pageIds),
    ]);
    const titleSnippets = await titleSnippetsFor(
      prisma,
      match,
      pageIds.filter((id) => titleHitIds.has(id)),
    );

    const results: SearchResult[] = [];
    for (const { id, lastMatchAt } of page) {
      const row = rows.get(id);
      if (row === undefined) continue;
      const titleSnippet = titleSnippets.get(id);
      results.push({
        sessionId: row.sessionId,
        title: row.title,
        project: { folder: row.folder, path: row.path },
        lastMatchAt: lastMatchAt === null ? null : isoOf(lastMatchAt),
        matchCount: (messageHits.get(id)?.count ?? 0) + (titleHitIds.has(id) ? 1 : 0),
        snippets: [...(titleSnippet === undefined ? [] : [titleSnippet]), ...(snippets.get(id) ?? [])].slice(
          0,
          SNIPPETS_PER_RESULT,
        ),
      });
    }

    return { results, hasMore: ordered.length > page.length };
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

function toFtsQuery(rawQuery: string): string | null {
  const chunks: string[] = [];
  for (const m of rawQuery.matchAll(/"([^"]*)"|(\S+)/g)) {
    const piece = m[1] ?? m[2] ?? "";
    if (!/[\p{L}\p{N}]/u.test(piece)) continue;
    chunks.push(`"${piece.replaceAll('"', '""')}"`);
  }
  return chunks.length === 0 ? null : chunks.join(" AND ");
}

async function messageHitsByConversation(
  prisma: PrismaClient,
  match: string,
): Promise<Map<number, { count: number; lastTs: number | null }>> {
  const rows = await prisma.$queryRaw<{ cid: number | bigint; n: number | bigint; lastTs: number | bigint | null }[]>`
    SELECT m.conversation_id AS cid, COUNT(*) AS n, MAX(m.timestamp) AS lastTs
      FROM message_fts f JOIN message m ON m.id = f.rowid
     WHERE message_fts MATCH ${match}
     GROUP BY m.conversation_id`;

  const out = new Map<number, { count: number; lastTs: number | null }>();
  for (const r of rows) {
    out.set(Number(r.cid), {
      count: Number(r.n),
      lastTs: r.lastTs === null ? null : Number(r.lastTs),
    });
  }
  return out;
}

async function titleHitConversationIds(prisma: PrismaClient, match: string): Promise<Set<number>> {
  const rows = await prisma.$queryRaw<{ cid: number | bigint }[]>`
    SELECT rowid AS cid FROM conversation_title_fts
     WHERE conversation_title_fts MATCH ${match}`;
  return new Set(rows.map((r) => Number(r.cid)));
}

async function lastActivityByConversation(
  prisma: PrismaClient,
  conversationIds: number[],
): Promise<Map<number, number | null>> {
  if (conversationIds.length === 0) return new Map();
  const groups = await prisma.message.groupBy({
    by: ["conversationId"],
    where: { conversationId: { in: conversationIds } },
    _max: { timestamp: true },
  });
  return new Map(groups.map((g) => [g.conversationId, g._max.timestamp === null ? null : Number(g._max.timestamp)]));
}

async function conversationRows(
  prisma: PrismaClient,
  conversationIds: number[],
): Promise<Map<number, { sessionId: string; title: string | null; folder: string; path: string }>> {
  const rows = await prisma.conversation.findMany({
    where: { id: { in: conversationIds } },
    select: {
      id: true,
      sessionId: true,
      title: true,
      project: { select: { folderName: true, path: true } },
    },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        sessionId: r.sessionId,
        title: r.title,
        folder: r.project.folderName,
        path: r.project.path,
      },
    ]),
  );
}

async function messageSnippets(
  prisma: PrismaClient,
  match: string,
  conversationIds: number[],
): Promise<Map<number, SearchSnippet[]>> {
  const out = new Map<number, SearchSnippet[]>();
  if (conversationIds.length === 0) return out;
  const ids = Prisma.join(conversationIds);

  const ranked = await prisma.$queryRaw<{ cid: number | bigint; rowid: number | bigint }[]>`
    SELECT cid, rowid FROM (
      SELECT m.conversation_id AS cid, f.rowid AS rowid,
             ROW_NUMBER() OVER (
               PARTITION BY m.conversation_id ORDER BY bm25(message_fts), f.rowid
             ) AS rn
        FROM message_fts f JOIN message m ON m.id = f.rowid
       WHERE message_fts MATCH ${match} AND m.conversation_id IN (${ids})
    ) WHERE rn <= ${SNIPPETS_PER_RESULT}`;
  if (ranked.length === 0) return out;

  const winners = Prisma.join(ranked.map((r) => Number(r.rowid)));
  const rows = await prisma.$queryRaw<
    {
      cid: number | bigint;
      rowid: number | bigint;
      uuid: string | null;
      externalAgentId: string | null;
      agentRowId: number | bigint;
      extract: string;
    }[]
  >`
    SELECT m.conversation_id AS cid,
           f.rowid AS rowid,
           m.uuid AS uuid,
           a.external_agent_id AS externalAgentId,
           a.id AS agentRowId,
           snippet(message_fts, 0, ${MARK_OPEN}, ${MARK_CLOSE}, '…', ${SNIPPET_TOKENS}) AS extract
      FROM message_fts f
      JOIN message m ON m.id = f.rowid
      JOIN agent a ON a.id = m.agent_id
     WHERE message_fts MATCH ${match} AND f.rowid IN (${winners})`;

  const rank = new Map(ranked.map((r, i) => [Number(r.rowid), i]));
  for (const r of [...rows].sort((a, b) => (rank.get(Number(a.rowid)) ?? 0) - (rank.get(Number(b.rowid)) ?? 0))) {
    const cid = Number(r.cid);
    const list = out.get(cid) ?? [];
    list.push({
      source: "message",
      messageUuid: r.uuid,
      agentId: r.externalAgentId ?? String(Number(r.agentRowId)),
      segments: toSegments(r.extract),
    });
    out.set(cid, list);
  }
  return out;
}

async function titleSnippetsFor(
  prisma: PrismaClient,
  match: string,
  conversationIds: number[],
): Promise<Map<number, SearchSnippet>> {
  const out = new Map<number, SearchSnippet>();
  if (conversationIds.length === 0) return out;
  const ids = Prisma.join(conversationIds);

  const rows = await prisma.$queryRaw<{ cid: number | bigint; extract: string }[]>`
    SELECT rowid AS cid,
           snippet(conversation_title_fts, 0, ${MARK_OPEN}, ${MARK_CLOSE}, '…', ${SNIPPET_TOKENS}) AS extract
      FROM conversation_title_fts
     WHERE conversation_title_fts MATCH ${match} AND rowid IN (${ids})`;

  for (const r of rows) {
    out.set(Number(r.cid), {
      source: "title",
      messageUuid: null,
      agentId: null,
      segments: toSegments(r.extract),
    });
  }
  return out;
}

function toSegments(extract: string): SearchSegment[] {
  const segments: SearchSegment[] = [];
  for (const part of extract.split(MARK_OPEN)) {
    const [matched, ...rest] = part.split(MARK_CLOSE);
    if (rest.length === 0) {
      if (matched !== "") segments.push({ text: matched, match: false });
      continue;
    }
    if (matched !== "") segments.push({ text: matched, match: true });
    const plain = rest.join(MARK_CLOSE);
    if (plain !== "") segments.push({ text: plain, match: false });
  }
  return segments;
}

function isoOf(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
