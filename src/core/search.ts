// Full-text search across conversations (issue #45) — the read side of the FTS5
// index built by the `20260804000000_search_fts5` migration.
//
// The question this answers is "find that conversation where we discussed X",
// so the shape of the answer is CONVERSATIONS, not messages: one result per
// conversation, ordered by the recency of its last matching message (you
// half-remember *when*, not how relevant it was), each carrying a few
// relevance-picked extracts to recognize it by. Relevance (bm25) only decides
// WHICH extracts a result shows — never which results you get, nor their order.
//
// The corpus is "what was said": human prompts, assistant text, and titles. The
// index itself enforces that (see the migration); nothing here re-filters.
//
// QUERY SAFETY: the raw string a human typed is NEVER handed to FTS5. FTS5's
// MATCH grammar has operators (`NEAR`, `OR`, `*`, `^`, `:`, parentheses) that
// would turn a stray character into a syntax error — a 500 on a search box.
// Every chunk is re-emitted as a quoted FTS5 string, which is literal by
// construction, and the chunks are ANDed (more words = narrower, the universal
// expectation). So no input can produce a query error; the worst case is a
// literal reading that finds nothing.
//
// ADR-0002: this module is core — plain data in, plain data out, no next/react.

import { readClient } from "@/core/db";
import { Prisma, type PrismaClient } from "@/core/prisma/generated/client";

/** Default cap on returned conversations (the UI hints "refine" beyond it). */
const DEFAULT_LIMIT = 50;

/** Extracts shown per result — enough to recognize a conversation, not read it. */
const SNIPPETS_PER_RESULT = 3;

/** Approximate width of an extract, in tokens (FTS5's `snippet()` budget). */
const SNIPPET_TOKENS = 12;

/**
 * Private markers `snippet()` wraps matched terms in, chosen from control
 * characters that cannot occur in a transcript. They never leave this module:
 * {@link toSegments} turns them into structured segments, so no caller is
 * tempted to render marked-up HTML.
 */
const MARK_OPEN = "";
const MARK_CLOSE = "";

/** One run of a snippet: plain text, or a stretch that matched the query. */
export type SearchSegment = {
  text: string;
  /** True when this run is a query match (render it highlighted). */
  match: boolean;
};

/** One extract shown on a result card, with everything needed to link to it. */
export type SearchSnippet = {
  /** Where the hit was found — a message body, or the conversation title. */
  source: "message" | "title";
  /**
   * Record uuid of the matching message — the transcript anchor. Null for a
   * title hit, and for a message whose log carried no uuid; the link then
   * degrades to the transcript without an anchor. The uuid (not the row id) is
   * the anchor because row ids are re-assigned on every re-parse.
   */
  messageUuid: string | null;
  /** `?agent=` key of the agent whose transcript holds the hit; null for a title. */
  agentId: string | null;
  /** The extract, split into plain and matched runs. */
  segments: SearchSegment[];
};

/** One matching conversation — the unit of the results page. */
export type SearchResult = {
  /** Session id (the `/conversation/<sessionId>` key). */
  sessionId: string;
  title: string | null;
  /** Owning Project: `folder` is the dash-encoded identity, `path` the decoded one. */
  project: { folder: string; path: string };
  /**
   * ISO timestamp the ordering uses: the conversation's most recent matching
   * message. For a title-only match it falls back to the conversation's last
   * message; null when no timestamp is known at all.
   */
  lastMatchAt: string | null;
  /** Matching messages, plus one for a matching title. */
  matchCount: number;
  /** Up to three extracts, picked by relevance (a title hit leads). */
  snippets: SearchSnippet[];
};

/** The whole answer for one query. */
export type SearchResults = {
  results: SearchResult[];
  /** True when more conversations matched than the cap returned. */
  hasMore: boolean;
};

type SearchOptions = {
  /** Max conversations returned (default 50). */
  limit?: number;
  /** Additional (non-seam) opt for isolated DBs in refresh + tests. */
  dbPath?: string;
};

/**
 * Search every conversation for `rawQuery`, grouped into result cards.
 *
 * Always global: no Project scoping (the project label on each card orients
 * you). A query with no searchable term — empty, whitespace, pure punctuation —
 * returns no results without touching the database.
 */
export async function searchConversations(
  rawQuery: string,
  opts: SearchOptions = {},
): Promise<SearchResults> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const match = toFtsQuery(rawQuery);
  if (match === null) return { results: [], hasMore: false };

  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const [messageHits, titleHitIds] = await Promise.all([
      messageHitsByConversation(prisma, match),
      titleHitConversationIds(prisma, match),
    ]);

    const conversationIds = [
      ...new Set([...messageHits.keys(), ...titleHitIds]),
    ];
    if (conversationIds.length === 0) return { results: [], hasMore: false };

    // A title-only hit has no matching message to date it: fall back to the
    // conversation's own last activity so it still sorts with the others.
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
        matchCount:
          (messageHits.get(id)?.count ?? 0) + (titleHitIds.has(id) ? 1 : 0),
        snippets: [
          ...(titleSnippet === undefined ? [] : [titleSnippet]),
          ...(snippets.get(id) ?? []),
        ].slice(0, SNIPPETS_PER_RESULT),
      });
    }

    return { results, hasMore: ordered.length > page.length };
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/**
 * Rewrite what a human typed into an FTS5 MATCH expression that cannot fail to
 * parse, or null when nothing searchable is left.
 *
 * Quoted phrases survive as phrases (`"cache invalidation"` still means
 * adjacent words); everything else becomes one literal term per whitespace
 * chunk. Each is re-quoted — inner quotes doubled, FTS5's own escape — so
 * operators and punctuation are matched as text rather than parsed. Chunks with
 * no letter or digit (`***`, `--`) carry no token and are dropped, since an
 * empty phrase would silently make the whole AND match nothing.
 */
function toFtsQuery(rawQuery: string): string | null {
  const chunks: string[] = [];
  // A "..." phrase, or a run of non-space characters.
  for (const m of rawQuery.matchAll(/"([^"]*)"|(\S+)/g)) {
    const piece = m[1] ?? m[2] ?? "";
    if (!/[\p{L}\p{N}]/u.test(piece)) continue;
    chunks.push(`"${piece.replaceAll('"', '""')}"`);
  }
  return chunks.length === 0 ? null : chunks.join(" AND ");
}

/** Matching-message count and latest match timestamp, per conversation id. */
async function messageHitsByConversation(
  prisma: PrismaClient,
  match: string,
): Promise<Map<number, { count: number; lastTs: number | null }>> {
  const rows = await prisma.$queryRaw<
    { cid: number | bigint; n: number | bigint; lastTs: number | bigint | null }[]
  >`
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

/** Conversation ids whose TITLE matches. */
async function titleHitConversationIds(
  prisma: PrismaClient,
  match: string,
): Promise<Set<number>> {
  const rows = await prisma.$queryRaw<{ cid: number | bigint }[]>`
    SELECT rowid AS cid FROM conversation_title_fts
     WHERE conversation_title_fts MATCH ${match}`;
  return new Set(rows.map((r) => Number(r.cid)));
}

/** Last message timestamp per conversation — the title-only hits' sort key. */
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
  return new Map(
    groups.map((g) => [
      g.conversationId,
      g._max.timestamp === null ? null : Number(g._max.timestamp),
    ]),
  );
}

/** Display fields of the matching conversations, keyed by row id. */
async function conversationRows(
  prisma: PrismaClient,
  conversationIds: number[],
): Promise<
  Map<number, { sessionId: string; title: string | null; folder: string; path: string }>
> {
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

/**
 * The top {@link SNIPPETS_PER_RESULT} extracts per conversation, by bm25.
 *
 * Two passes on purpose: the first ranks (cheap) and the second renders
 * `snippet()` for the handful of winners only — one query that both ranked and
 * rendered would build an extract for every hit in the corpus.
 */
async function messageSnippets(
  prisma: PrismaClient,
  match: string,
  conversationIds: number[],
): Promise<Map<number, SearchSnippet[]>> {
  const out = new Map<number, SearchSnippet[]>();
  if (conversationIds.length === 0) return out;
  const ids = Prisma.join(conversationIds);

  const ranked = await prisma.$queryRaw<
    { cid: number | bigint; rowid: number | bigint }[]
  >`
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

  // Restore the bm25 order the ranking pass established (the render pass is
  // ordered by rowid, which is arbitrary as far as relevance goes).
  const rank = new Map(ranked.map((r, i) => [Number(r.rowid), i]));
  for (const r of [...rows].sort(
    (a, b) => (rank.get(Number(a.rowid)) ?? 0) - (rank.get(Number(b.rowid)) ?? 0),
  )) {
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

/** The title extract for each conversation whose title matched. */
async function titleSnippetsFor(
  prisma: PrismaClient,
  match: string,
  conversationIds: number[],
): Promise<Map<number, SearchSnippet>> {
  const out = new Map<number, SearchSnippet>();
  if (conversationIds.length === 0) return out;
  const ids = Prisma.join(conversationIds);

  const rows = await prisma.$queryRaw<
    { cid: number | bigint; extract: string }[]
  >`
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

/** Split a marked-up extract into plain/matched runs, dropping the markers. */
function toSegments(extract: string): SearchSegment[] {
  const segments: SearchSegment[] = [];
  for (const part of extract.split(MARK_OPEN)) {
    const [matched, ...rest] = part.split(MARK_CLOSE);
    if (rest.length === 0) {
      // Text before the first marker — plain by definition.
      if (matched !== "") segments.push({ text: matched, match: false });
      continue;
    }
    if (matched !== "") segments.push({ text: matched, match: true });
    const plain = rest.join(MARK_CLOSE);
    if (plain !== "") segments.push({ text: plain, match: false });
  }
  return segments;
}

/** Epoch millis (as stored) → ISO string, the serializable shape callers get. */
function isoOf(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
