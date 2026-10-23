// Ingest spine (ADR-0001, ADR-0002). `refresh()` discovers top-level session
// files + their sub-agent transcripts, parses them, and writes ALL twelve
// tables.
// The read seams (`listConversations()`, `getConversation()`) live in `read.ts`.
// It writes through a bare better-sqlite3 connection, not Prisma (ADR-0005);
// every statement it runs lives in `prisma/refresh-statements.ts`.
//
// ONE CONVERSATION AT A TIME, COMMITTED IN BATCHES: a conversation is parsed,
// written (its row inserted or updated in place, its changed Agents rewritten),
// then dropped — no run holds more than one parsed conversation. Writes share a transaction until a batch
// is full (`MAX_CONVERSATIONS_PER_BATCH`, `MAX_BATCH_DURATION_MS`); each commit
// is reported through `onProgress`. Readers on other connections (WAL, see
// `db.ts`) never find a re-parsed conversation missing.
//
// INCREMENTAL REFRESH (Slice 5): `refresh()` skips conversations whose source
// has not changed, re-parses changed/new ones, and drops conversations whose
// source file disappeared. The change key is a COMPOSITE of the main session
// file PLUS its sub-agent transcripts (max mtime, summed size) — a sub-agent
// file changing alone (the main file untouched) still triggers a re-parse.
// Behind that first-level skip, the AGENT'S LOG FILE is the unit of re-parse
// and rewrite (ADR-0010): each `agent` row keeps its own file's change key, and
// a changed Conversation re-parses its Main thread, each Sub-agent file that
// changed, and only what their lineage needs (see `parseConversation`); it
// rewrites only the Agents whose file changed (see `writeConversation`).
// The stored `parserVersion` is part of that decision too: rows produced by an
// older parser are re-parsed once even when their source files are untouched
// (see `PARSER_VERSION`). It doubles as the COMMIT MARK of a refresh: a
// conversation is stamped only after its continuation link has been resolved,
// so an INTERRUPTED run leaves its conversations re-parseable rather than
// looking up-to-date with a missing link (see `UNSTAMPED_PARSER_VERSION`).
//
// DUPLICATE SESSION IDS: the session id is a FILE STEM, so a transcript copied
// into a second log folder presents as two sessions with one id — which the
// unique `conversation.sessionId` rejected, aborting the whole run. Discovery
// now keeps ONE file per session id (smallest source path wins) and reports the
// losers in `RefreshSummary.duplicateSessionsSkipped` (see `dedupeBySessionId`).
//
// VANISHED LOG FILES: a file the compare picked to re-parse may be deleted
// before it is read (a scratch session cleaned up, a worktree removed). Such a
// file is skipped and counted in `RefreshSummary.vanishedLogFilesSkipped`: a
// main transcript is treated as gone (its stored row deleted), a sub-agent
// transcript is left out of its Conversation (its stored Agent deleted). Only ENOENT counts as vanished; any
// other error fails the run (see `vanished-file.ts`).
//
// ROLLUP DESIGN (ADR-0001): conversation totals/cost are SUM queries over ALL
// messages of ALL agents in the conversation — so sub-agent tokens roll up
// automatically, counted ONCE (the parent Agent aggregate is never summed in).

import path from "node:path";
import { performance } from "node:perf_hooks";
import { defaultDbPath, openRefreshConnection } from "@/core/db";
import {
  decodeLogFolderName,
  defaultLogsRoot,
  type DiscoveredSession,
  discoverSessions,
  discoverSubAgents,
} from "@/core/discovery";
import {
  type ParsedAgentSpawn,
  type ParsedApiRequest,
  parseSessionLines,
  type ParsedSession,
  parseSubAgentMeta,
  type ParsedSubAgentMeta,
} from "@/core/parse";
import {
  type AgentLineageRow,
  type ContinuationCandidate,
  type ConversationRow,
  type MessageRow,
  prepareRefreshStatements,
  type RefreshStatements,
  type StoredAgent,
} from "@/core/prisma/refresh-statements";
import { readFileUnlessVanished, statUnlessVanished } from "@/core/vanished-file";

/**
 * One `.jsonl` file dropped because another file already claimed its session id
 * (see `dedupeBySessionId`). Carries both paths so the report can tell the user
 * exactly which stray file to delete.
 */
export type DuplicateSessionSkip = {
  sessionId: string;
  /** The file that was ingested (smallest source path). */
  keptPath: string;
  /** The file that was NOT ingested. */
  skippedPath: string;
};

export type RefreshSummary = {
  conversationsParsed: number;
  conversationsSkipped: number;
  conversationsDeleted: number;
  malformedLinesSkipped: number;
  /** Log files (main or sub-agent) read and parsed for the Conversations written. */
  logFilesParsed: number;
  /** Files dropped for sharing a session id with an already-claimed file. */
  duplicateSessionsSkipped: DuplicateSessionSkip[];
  /** Log files (main or sub-agent) picked to re-parse, then gone before their read. */
  vanishedLogFilesSkipped: number;
  durationMs: number;
  /** Where `durationMs` went, in fractional milliseconds per phase (see `RefreshPhase`). */
  durationMsByPhase: Record<RefreshPhase, number>;
};

/**
 * A stretch of a Refresh, timed on its own: `discovery` (find the files, read
 * the stored rows, delete vanished Conversations, pick what to re-parse),
 * `parse` and `write` (summed over every Conversation), `links` (continued-from,
 * and the Turns whose API request is in another file) and `stamp` (the parser-version commit mark).
 */
export type RefreshPhase = "discovery" | "parse" | "write" | "links" | "stamp";

type RefreshOptions = {
  logsRoot?: string;
  dbPath?: string;
  /**
   * Called with `{ done: 0, total }` once the run knows what to re-parse, then
   * after each batch of conversation writes has committed. A throw aborts the run.
   */
  onProgress?: (progress: RefreshProgress) => void;
};

/**
 * Version of the parse/write logic behind the rows in the database.
 *
 * BUMP THIS whenever a parser or writer change makes previously ingested rows
 * wrong or incomplete: a conversation whose stored `parserVersion` differs is
 * treated as CHANGED even when its source files did not move, so it re-parses
 * exactly once and is stamped with the new version. This replaces the old
 * `UPDATE conversation SET source_mtime = -1` migration hack.
 *
 * 1 — sub-agents nest under the agent that actually spawned them (before, every
 *     sub-agent was flattened onto the main thread).
 * 2 — assistant turns carry their reasoning `effort` (previously ignored), so
 *     already-ingested conversations must re-parse to fill the new column.
 * 3 — user Messages are classified by `origin.kind` (Inter-agent messages and
 *     Task notifications, with their `origin` extras) and `queued_command`
 *     attachments become mid-turn Messages.
 * 4 — a Project is identified by its path: a Conversation that switches into a
 *     git worktree belongs to the worktree, and a cwd-less one borrows the
 *     Project of a sibling in its log folder.
 * 5 — an Agent call's result is stored whole (before, it was truncated to ~10k
 *     chars like every other tool's, cutting off long hand-backs).
 * 6 — a failed attempt of a Turn joins that Turn (`is_failed_attempt` of the
 *     Recording-fed `api_request` table, since dropped), and every API request
 *     keeps its response's error message.
 * 7 — every API request is classified by kind (`kind` of that same table, Side
 *     requests told apart), and keeps its response's usage and model.
 * 8 — the request records Claude Code 2.1.300+ logs are stored
 *     (`api_request`, with each system prompt and tool set once).
 * 9 — so are the messages they sent (`sent_message`, each once).
 * 10 — a request record the next one resent joins the Turn it was a Failed
 *     attempt of (`api_request.failed_attempt_of_message_id`).
 * 11 — assistant turns carry their thinking text and duration
 *     (`message.thinking_text`, `message.thinking_duration_ms`).
 * 12 — a sent message keeps the pieces of Injected context its file's
 *     attachments name in it (`sent_message.injected_context_pieces_json`).
 * 13 — a Turn names its API request (`message.api_request_id`, from its
 *     `message.request_ref`), in its own file or another's; `api_request`
 *     no longer names its Turn.
 * 14 — Windows paths are read by their shape: a switch into a worktree under a
 *     Windows repo is recognised, and a Windows log folder name decodes to a
 *     Windows path.
 * 15 — each Agent carries its own log file's change key (`agent.source_mtime`,
 *     `agent.source_size`), so a changed Conversation rewrites only the Agents
 *     whose file changed (ADR-0010).
 * 16 — a continuation is found by the copy of its parent's records it holds
 *     and the `continued-in` records naming it (`continued_in`), and its
 *     copied Messages are flagged (`message.is_copied`, log-format §10).
 * 17 — the title is the last `custom-title`, else the last `ai-title`, as
 *     Claude Code resolves it, not the first (`conversation.title`).
 * 18 — a forked Sub-agent's copy of its spawning Agent's records is flagged
 *     too (`message.is_copied`, log-format §10).
 * 19 — a Sub-agent whose spawn ledger states no type takes the one its
 *     `agent-<id>.meta.json` states (`agent.agent_type`), and one no ledger
 *     names is linked to its spawner by the meta file's `toolUseId`.
 */
export const PARSER_VERSION = 19;

/**
 * The version a conversation carries while it is written but NOT YET COMPLETE:
 * its rows exist, its `continued_from` link has not been resolved. Never equal
 * to `PARSER_VERSION`, so such a row always re-parses.
 *
 * This is what makes an INTERRUPTED refresh recoverable. Stamping the current
 * version at write time left a window — crash after the conversation writes,
 * before `resolveContinuations` — in which rows looked up-to-date to every
 * later run and were skipped forever, their `continuedFromConversationId`
 * permanently null. Conversations are now stamped only once linking has run
 * for the whole refresh (`stampParserVersion`), so an aborted run leaves them
 * re-parseable and the next run completes them.
 *
 * It shares the column's DEFAULT (0), which already means "not produced by any
 * current parser run" for rows predating the column — both cases want the same
 * treatment: re-parse.
 */
const UNSTAMPED_PARSER_VERSION = 0;

/**
 * A write batch commits once it holds this many conversations, or once
 * {@link MAX_BATCH_DURATION_MS} has passed since it opened, whichever is first.
 * Each commit costs a WAL frame flush; batching amortizes it (sized with
 * `pnpm bench:refresh`, see ADR-0005).
 */
const MAX_CONVERSATIONS_PER_BATCH = 50;

/** A write batch commits once this long has passed since it opened (see above). */
const MAX_BATCH_DURATION_MS = 1000;

/** A log file's change key, as discovery stats it and an `agent` row stores it. */
type FileChangeKey = {
  /** Epoch ms, floored. */
  sourceMtime: number;
  sourceSize: number;
};

/**
 * A Sub-agent's log file, `subagents/agent-<agentId>.jsonl`, with its change
 * key, and the path of the meta file beside it (null when there is none).
 */
type SubAgentFile = FileChangeKey & { agentId: string; sourcePath: string; metaPath: string | null };

/** A discovered session whose stored conversation is missing or stale. */
type SessionToReparse = {
  /** The session, its `sourceMtime`/`sourceSize` set to the COMPOSITE change key. */
  session: DiscoveredSession;
  /** The change key of the Main thread's own file. */
  mainThreadFileKey: FileChangeKey;
  subAgentFiles: SubAgentFile[];
  /** Row id of the stored conversation the re-parse rewrites (null = new). */
  priorConversationId: number | null;
  /**
   * Every stored Agent is rewritten, whatever its change key: the stored rows
   * come from another parser version, an interrupted run, or another file.
   */
  isEveryAgentRewritten: boolean;
};

/** A Sub-agent of a Conversation about to be written. */
type SubAgentToWrite = {
  file: SubAgentFile;
  /** Its stored row; null when it is new. */
  stored: StoredAgent | null;
  /** Its parsed log file; null when it is kept without being read. */
  parsed: ParsedSession | null;
  /** Its parsed meta file, once read (see `metaOf`); undefined until then. */
  meta: ParsedSubAgentMeta | undefined;
  /** Its stored rows are deleted and written again from `parsed`. */
  isRewritten: boolean;
};

/** Who spawned a Sub-agent, by the spawn ledger that names it. */
type SpawnLedgerEntry = {
  /** External id of the spawning Sub-agent; null ⇒ the Main thread. */
  parentExternalId: string | null;
  spawn: ParsedAgentSpawn;
};

/**
 * A Conversation parsed as far as its write needs: its Main thread always,
 * each Sub-agent whose file changed, and each one whose lineage the write
 * must decide again (see `parseConversation`).
 */
type ParsedConversation = {
  session: DiscoveredSession;
  parsed: ParsedSession;
  mainThreadFileKey: FileChangeKey;
  /** The Main thread's stored row; null when the Conversation is new. */
  storedMainThread: StoredAgent | null;
  isMainThreadRewritten: boolean;
  /** Every Sub-agent whose file is on disk, in discovery order. */
  subAgents: SubAgentToWrite[];
  /** The stored Sub-agents whose file is gone. */
  removedAgentRowIds: number[];
  /** The spawn ledgers of every parsed log file, by spawned external id (see `indexSpawnLedgers`). */
  spawnLedgerByAgentId: Map<string, SpawnLedgerEntry>;
  /** How many log files were read and parsed. */
  parsedLogFileCount: number;
  /** Row id of the stored conversation the write rewrites (null = new). */
  priorConversationId: number | null;
};

/** What deciding a Sub-agent's lineage looks at (see `isLineageDecidedAgain`). */
type SubAgentLineageContext = Pick<
  ParsedConversation,
  "storedMainThread" | "subAgents" | "removedAgentRowIds" | "spawnLedgerByAgentId"
>;

/** What linking and stamping need of a conversation this run has written. */
type WrittenConversation = {
  /** Row id of the conversation as this run wrote it. */
  conversationId: number;
  /** The `uuid` of its Main thread's first Message: every copy of it, and every copy it is, holds it too. */
  firstMessageUuid: string | null;
  /** The sessions its `continued-in` records name. */
  continuedInSessionIds: string[];
};

/** How far a Refresh has got: conversations committed out of those it re-parses. */
export type RefreshProgress = { done: number; total: number };

/** A discovered session paired with its computed composite change key. */
type DiscoveredWithKey = {
  /** The session, its `sourceMtime`/`sourceSize` the Main thread file's own. */
  session: DiscoveredSession;
  /** Sub-agent log files (folded into the change key + parsed if changed). */
  subAgentFiles: SubAgentFile[];
  /** Composite mtime: max over the session file + every sub-agent transcript. */
  compositeMtime: number;
  /** Composite size: sum over the session file + every sub-agent transcript. */
  compositeSize: number;
};

/**
 * Incremental scan → parse → write of the logs root into a fresh-or-existing DB.
 *
 * For every discovered session we compute a COMPOSITE change key — the max mtime
 * and total size across the main `<sessionId>.jsonl` AND its
 * `subagents/agent-*.jsonl` transcripts — and compare it against the stored
 * `conversation.sourceMtime`/`sourceSize`, without parsing anything. Unchanged
 * conversations are skipped; conversations whose source file no longer exists
 * are deleted. The rest — new or changed — are the run's `total`, reported
 * through `onProgress` as `{ done: 0, total }`.
 *
 * Then three passes over that set only: (1) parse each conversation and write it
 * with its agents/messages/tool_calls/pr_links/turn_durations — a stored one in
 * place, rewriting only the Agents whose own file changed (each `agent` row
 * keeps its file's change key, ADR-0010) — in ONE transaction, so a reader on
 * another connection sees the old version or the new one, never neither; drop
 * the parsed content —
 * memory stays flat however large the logs grow. A transaction holds a batch of
 * conversations; once it commits, report `{ done, total }`, `done` counting the
 * conversations committed so far. Conversations whose records state no `cwd`
 * are written last, in discovery order, as they borrow their Project from the
 * siblings in their log folder (see `resolveProjectPath`); (2) resolve
 * the `continued_from` link and Copied Messages of that set and of every stored
 * Conversation of their families — the ones holding their first Message, the
 * ones they name or that continue from them, and the continuations of every
 * deleted Conversation — against the persisted rows of ALL conversations, so
 * a skipped (unchanged) parent still resolves (see `resolveContinuations`), and link
 * every Turn of the database with a `requestRef` and no API request to the
 * request of another file it names, if any, reading ids only (log-format §9,
 * "How they are stored") — a kept Agent's Turns included, whose links a
 * rewritten Agent's delete just nulled; (3) stamp the
 * current `parserVersion` on that set — the commit mark that lets a later run
 * skip them — and delete every Project left without a Conversation, and every
 * system prompt and tool set no API request references, and every sent
 * message no tail names. Passes 2 and 3 share one final transaction. The
 * sub-agent transcript is the single source of truth for its tokens (GOTCHA 3) — the
 * parent aggregate is a cross-check only.
 *
 * @example
 * const summary = await refresh({ onProgress: ({ done, total }) => console.log(`${done}/${total}`) });
 */
export async function refresh(opts: RefreshOptions = {}): Promise<RefreshSummary> {
  // Monotonic clock for the elapsed measure: `Date.now()` can jump BACKWARD on a
  // wall-clock adjustment (NTP, or WSL2 resuming from sleep), which produced a
  // nonsensical NEGATIVE durationMs in the refresh digest. `performance.now()`
  // never goes back.
  const start = performance.now();
  const logsRoot = opts.logsRoot ?? defaultLogsRoot();
  const dbPath = opts.dbPath ?? defaultDbPath();
  const db = openRefreshConnection(dbPath);

  let conversationsParsed = 0;
  let conversationsSkipped = 0;
  let conversationsDeleted = 0;
  let malformedLinesSkipped = 0;
  let logFilesParsed = 0;
  let vanishedLogFilesSkipped = 0;

  // Assigned by the dedupe below, before anything else looks at the file set.
  let duplicateSessionsSkipped: DuplicateSessionSkip[] = [];

  const durationMsByPhase: Record<RefreshPhase, number> = { discovery: 0, parse: 0, write: 0, links: 0, stamp: 0 };
  let phaseStart = start;
  /** Add the time since the previous call (or the run's start) to `phase`. */
  const endPhase = (phase: RefreshPhase) => {
    const now = performance.now();
    durationMsByPhase[phase] += now - phaseStart;
    phaseStart = now;
  };

  try {
    const statements = prepareRefreshStatements(db);

    // Two files may carry the same session id (a copied transcript). Resolve
    // that HERE, before the incremental compare, so every pass below sees one
    // file per session id (see `dedupeBySessionId`).
    const { unique: discovered, duplicatesSkipped } = dedupeBySessionId(discoverWithKeys(logsRoot));
    duplicateSessionsSkipped = duplicatesSkipped;

    // Stored rows, for the skip/changed/delete decision.
    const storedConversationBySessionId = new Map(
      statements.selectStoredConversations().map((row) => [row.sessionId, row]),
    );

    // A deleted Conversation's continuations lose their parent: pass 2 decides
    // theirs again. Until it has, they are unstamped, so an interrupted run
    // leaves them re-parseable; pass 3 stamps them back.
    const orphanedContinuationIds = new Set<number>();
    /** Delete a Conversation (its rows go by cascade), setting its continuations aside. */
    const deleteConversation = (conversationId: number) => {
      const continuationIds = statements.selectContinuationIds([conversationId]);
      for (const continuationId of continuationIds) orphanedContinuationIds.add(continuationId);
      statements.updateParserVersion(continuationIds, UNSTAMPED_PARSER_VERSION);
      statements.deleteConversation(conversationId);
    };

    // Delete conversations whose source file is gone.
    const onDisk = new Set(discovered.map((d) => d.session.sessionId));
    statements.beginTransaction();
    for (const [sessionId, row] of storedConversationBySessionId) {
      if (onDisk.has(sessionId)) continue;
      deleteConversation(row.id);
      conversationsDeleted += 1;
    }
    statements.commitTransaction();

    // Compare — pick the NEW or CHANGED sessions, without parsing anything, so
    // the run knows its total before its first write.
    const sessionsToReparse: SessionToReparse[] = [];

    for (const d of discovered) {
      const prior = storedConversationBySessionId.get(d.session.sessionId);
      // Rows written by another parser version are stale by definition, however
      // untouched their source files are — re-parse them (exactly once: the
      // rewrite stamps the current version).
      //
      // The source PATH is part of the comparison, not just (mtime, size): when
      // a duplicate at a smaller path takes over a session id (see
      // `dedupeBySessionId`), a metadata-preserving copy presents the very same
      // composite key. Without the path check the conversation would look
      // unchanged and keep the LOSER's rows while the summary reports the winner
      // as the file that was kept.
      const unchanged =
        prior !== undefined &&
        prior.parserVersion === PARSER_VERSION &&
        prior.sourcePath === d.session.sourcePath &&
        prior.sourceMtime === d.compositeMtime &&
        prior.sourceSize === d.compositeSize;
      if (unchanged) {
        conversationsSkipped += 1;
        continue;
      }

      // Store the COMPOSITE key on the conversation row so a later run can detect
      // a sub-agent-only change (the main file's own mtime/size alone would not).
      // Behind it, each Agent's own key decides which of them is rewritten —
      // unless the stored rows are another parser's, or another file's.
      sessionsToReparse.push({
        session: { ...d.session, sourceMtime: d.compositeMtime, sourceSize: d.compositeSize },
        mainThreadFileKey: { sourceMtime: d.session.sourceMtime, sourceSize: d.session.sourceSize },
        subAgentFiles: d.subAgentFiles,
        priorConversationId: prior?.id ?? null,
        isEveryAgentRewritten:
          prior !== undefined && (prior.parserVersion !== PARSER_VERSION || prior.sourcePath !== d.session.sourcePath),
      });
    }

    const total = sessionsToReparse.length;
    endPhase("discovery");
    opts.onProgress?.({ done: 0, total });

    // Pass 1 — parse and write one conversation at a time, its parsed content
    // dropped once written, so memory stays flat however large the logs grow.
    // Writes go in batches: one transaction holds several conversations, each
    // replacing its prior row, and every commit is reported.
    const writtenConversations: WrittenConversation[] = [];
    let batchOpenedAt: number | null = null;
    const commitBatch = () => {
      statements.commitTransaction();
      batchOpenedAt = null;
      // A batch holding only the deletes of vanished sessions moves no count.
      const isDoneUnchanged = conversationsParsed === writtenConversations.length;
      conversationsParsed = writtenConversations.length;
      endPhase("write");
      if (!isDoneUnchanged) opts.onProgress?.({ done: conversationsParsed, total });
    };
    // A cwd-less Conversation borrows its Project from the siblings already
    // written (see `resolveProjectPath`), so it is set aside and parsed again
    // after every other one: re-parsing these near-empty files beats holding them.
    const cwdLessSessions: SessionToReparse[] = [];
    /** Open a write batch unless one is open; returns when the open one opened. */
    const openBatchIfNone = (): number => {
      if (batchOpenedAt !== null) return batchOpenedAt;
      statements.beginTransaction();
      batchOpenedAt = performance.now();
      return batchOpenedAt;
    };
    const parseAndWrite = (sessionToReparse: SessionToReparse, isCwdLessPass: boolean) => {
      phaseStart = performance.now();
      const { parsedConversation, vanishedSubAgentFileCount } = parseConversation(statements, sessionToReparse);
      if (parsedConversation === null) {
        // Its main transcript vanished: the session is gone, as if discovery
        // had not found it.
        vanishedLogFilesSkipped += 1;
        endPhase("parse");
        if (sessionToReparse.priorConversationId === null) return;
        openBatchIfNone();
        deleteConversation(sessionToReparse.priorConversationId);
        conversationsDeleted += 1;
        endPhase("write");
        return;
      }
      if (!isCwdLessPass && parsedConversation.parsed.projectPath === null) {
        cwdLessSessions.push(sessionToReparse);
        endPhase("parse");
        return;
      }
      vanishedLogFilesSkipped += vanishedSubAgentFileCount;
      logFilesParsed += parsedConversation.parsedLogFileCount;
      malformedLinesSkipped += parsedConversation.parsed.malformedLines;
      for (const sub of parsedConversation.subAgents) malformedLinesSkipped += sub.parsed?.malformedLines ?? 0;
      endPhase("parse");

      const currentBatchOpenedAt = openBatchIfNone();
      writtenConversations.push({
        conversationId: writeConversation(statements, parsedConversation),
        firstMessageUuid: parsedConversation.parsed.messages[0]?.uuid ?? null,
        continuedInSessionIds: parsedConversation.parsed.continuedInSessionIds,
      });
      const conversationsInBatch = writtenConversations.length - conversationsParsed;
      const isBatchFull =
        conversationsInBatch >= MAX_CONVERSATIONS_PER_BATCH ||
        performance.now() - currentBatchOpenedAt >= MAX_BATCH_DURATION_MS;
      if (isBatchFull) commitBatch();
      else endPhase("write");
    };
    for (const sessionToReparse of sessionsToReparse) parseAndWrite(sessionToReparse, false);
    for (const sessionToReparse of cwdLessSessions) parseAndWrite(sessionToReparse, true);
    if (batchOpenedAt !== null) commitBatch();

    // Passes 2 and 3 share one transaction.
    phaseStart = performance.now();
    statements.beginTransaction();
    // Pass 2 — decide the continuations of the (re)written conversations and
    // of their families, authoritatively against the persisted rows of ALL
    // conversations; then link every Turn of the database whose API request
    // is in another file — a skipped child's Turns included, whose links a
    // rewritten parent's delete just nulled.
    resolveContinuations(statements, writtenConversations, orphanedContinuationIds);
    statements.updateUnlinkedTurnApiRequests();
    endPhase("links");

    // Pass 3 — only NOW are these conversations complete: stamp them, so the
    // next run may skip them. An abort before this point leaves them unstamped
    // and therefore re-parseable (see `UNSTAMPED_PARSER_VERSION`).
    stampParserVersion(statements, [
      ...writtenConversations.map((written) => written.conversationId),
      ...orphanedContinuationIds,
    ]);
    // A re-parse or a vanished file can leave a Project with no Conversation,
    // a system prompt or tool set no API request references, and a sent
    // message no tail names: gone, as a cold Refresh would never have stored them.
    statements.deleteProjectsWithoutConversations();
    statements.deleteUnreferencedInternedValues();
    statements.commitTransaction();
    endPhase("stamp");
  } finally {
    // Closing rolls back a transaction left open by a throw — that batch only:
    // what earlier batches committed stays, unstamped, for the next run.
    db.close();
  }

  return {
    conversationsParsed,
    conversationsSkipped,
    conversationsDeleted,
    malformedLinesSkipped,
    logFilesParsed,
    duplicateSessionsSkipped,
    vanishedLogFilesSkipped,
    durationMs: Math.round(performance.now() - start),
    durationMsByPhase,
  };
}

/**
 * Drop every file that shares a session id with one already claimed, so the rest
 * of `refresh()` only ever sees ONE file per session id.
 *
 * WHY: the session id is a file STEM, so two copies of a transcript in two
 * log folders (a user copying a `.jsonl` around) present as two sessions
 * with one id — and `conversation.sessionId` is UNIQUE, so writing the second
 * threw and aborted the ENTIRE refresh (issue #37).
 *
 * THE RULE — the smallest `sourcePath` by plain lexicographic order wins.
 * Directory listing order is filesystem-dependent and must never decide this;
 * sorting makes the winner identical on every machine and on every run, so a
 * conversation does not flip between copies from one refresh to the next.
 *
 * This runs at DISCOVERY, before the incremental compare, so the winner is
 * well-defined even when a new, smaller-path duplicate appears next to a
 * conversation that is already in the database.
 */
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

/**
 * Discover every session and fold its sub-agent transcripts into a composite
 * change key. A sub-agent file changing without the main file changing still
 * shifts the composite (max mtime / summed size), so the Conversation re-parses.
 */
function discoverWithKeys(logsRoot: string): DiscoveredWithKey[] {
  const out: DiscoveredWithKey[] = [];
  for (const session of discoverSessions(logsRoot)) {
    const projectDir = path.dirname(session.sourcePath);
    const subAgentFiles: SubAgentFile[] = [];

    let compositeMtime = session.sourceMtime;
    let compositeSize = session.sourceSize;
    for (const sub of discoverSubAgents(projectDir, session.sessionId)) {
      // Gone between its listing and its stat: absent at discovery.
      const stat = statUnlessVanished(sub.sourcePath);
      if (stat === null) continue;
      const sourceMtime = Math.floor(stat.mtimeMs);
      subAgentFiles.push({ ...sub, sourceMtime, sourceSize: stat.size });
      compositeMtime = Math.max(compositeMtime, sourceMtime);
      compositeSize += stat.size;
    }
    out.push({ session, subAgentFiles, compositeMtime, compositeSize });
  }
  return out;
}

/**
 * Read + parse one transcript file (main or sub-agent — same per-turn shape),
 * its tool results cut to what the write stores of them (see
 * `keepStoredToolResults`), or null when it vanished since discovery.
 */
function parseSession(sourcePath: string): ParsedSession | null {
  const text = readFileUnlessVanished(sourcePath);
  return text === null ? null : keepStoredToolResults(parseSessionLines(text.split("\n")));
}

/** A meta file stating nothing: none beside the transcript, or one gone or malformed. */
const EMPTY_SUB_AGENT_META: ParsedSubAgentMeta = { agentType: null, toolUseId: null };

/**
 * What `subAgent`'s meta file states (log-format §4), read and parsed on first
 * use and kept on it: a few hundred bytes, read only for the Sub-agents whose
 * lineage a Refresh decides.
 */
function metaOf(subAgent: SubAgentToWrite): ParsedSubAgentMeta {
  if (subAgent.meta !== undefined) return subAgent.meta;
  const text = subAgent.file.metaPath === null ? null : readFileUnlessVanished(subAgent.file.metaPath);
  subAgent.meta = text === null ? EMPTY_SUB_AGENT_META : parseSubAgentMeta(text);
  return subAgent.meta;
}

/**
 * Parse what writing a changed session needs (ADR-0010): its Main thread,
 * always; each Sub-agent file that is new or whose change key differs from its
 * stored Agent's, and the stored parent of each such stored Sub-agent, so its
 * lineage comes from a parsed ledger; then, until none is left, each kept
 * Sub-agent whose stored spawn is gone (see `hasLostStoredSpawn`), so it falls
 * back to its own dominant model as a cold Refresh's does, and each kept one
 * that may hold a new fork's spawn (see `unreadHoldersOfUnnamedNewFirstMessages`)
 * or the Agent call a meta file names (see `unreadHoldersOfMetaSpawnCalls`).
 * Every other Sub-agent is kept without being read. The conversation is null when the main
 * transcript vanished; a vanished sub-agent file is left out — removed, when
 * stored — and counted.
 */
function parseConversation(
  statements: RefreshStatements,
  { session, mainThreadFileKey, subAgentFiles, priorConversationId, isEveryAgentRewritten }: SessionToReparse,
): { parsedConversation: ParsedConversation | null; vanishedSubAgentFileCount: number } {
  const parsed = parseSession(session.sourcePath);
  if (parsed === null) return { parsedConversation: null, vanishedSubAgentFileCount: 0 };

  const storedAgents = priorConversationId === null ? [] : statements.selectStoredAgents(priorConversationId);
  const storedAgentByRowId = new Map(storedAgents.map((agent) => [agent.id, agent]));
  const storedMainThread = storedAgents.find((agent) => agent.externalAgentId === null) ?? null;
  const storedSubAgentByAgentId = new Map(
    storedAgents.flatMap((agent) => (agent.externalAgentId === null ? [] : [[agent.externalAgentId, agent] as const])),
  );
  /** Whether `stored` was written from its file as `fileKey` finds it now. */
  const isStoredFromFileAsIs = (stored: StoredAgent | null, fileKey: FileChangeKey) =>
    !isEveryAgentRewritten &&
    stored !== null &&
    stored.sourceMtime === fileKey.sourceMtime &&
    stored.sourceSize === fileKey.sourceSize;

  let subAgents: SubAgentToWrite[] = subAgentFiles.map((file) => {
    const stored = storedSubAgentByAgentId.get(file.agentId) ?? null;
    return { file, stored, parsed: null, meta: undefined, isRewritten: !isStoredFromFileAsIs(stored, file) };
  });
  const subAgentByRowId = new Map(
    subAgents.flatMap((sub) => (sub.stored === null ? [] : [[sub.stored.id, sub] as const])),
  );
  const onDiskAgentIds = new Set(subAgentFiles.map((file) => file.agentId));
  const removedAgentRowIds = storedAgents
    .filter((agent) => agent.externalAgentId !== null && !onDiskAgentIds.has(agent.externalAgentId))
    .map((agent) => agent.id);

  let parsedLogFileCount = 1;
  let vanishedSubAgentFileCount = 0;
  /** Parse each of `subAgentsToRead`: one whose file vanished is left out, and removed when stored. */
  const read = (subAgentsToRead: Set<SubAgentToWrite>) => {
    for (const subAgent of subAgentsToRead) {
      subAgent.parsed = parseSession(subAgent.file.sourcePath);
      if (subAgent.parsed !== null) {
        parsedLogFileCount += 1;
        continue;
      }
      vanishedSubAgentFileCount += 1;
      if (subAgent.stored !== null) removedAgentRowIds.push(subAgent.stored.id);
    }
    subAgents = subAgents.filter((sub) => !subAgentsToRead.has(sub) || sub.parsed !== null);
  };

  const changedSubAgentsAndParents = new Set<SubAgentToWrite>();
  for (const subAgent of subAgents) {
    if (!subAgent.isRewritten) continue;
    changedSubAgentsAndParents.add(subAgent);
    const storedParentRowId = subAgent.stored?.parentAgentId ?? null;
    const storedParent = storedParentRowId === null ? undefined : subAgentByRowId.get(storedParentRowId);
    if (storedParent !== undefined) changedSubAgentsAndParents.add(storedParent);
  }
  read(changedSubAgentsAndParents);

  let spawnLedgerByAgentId = indexSpawnLedgers(parsed, subAgents);
  for (;;) {
    const readOrRemovedRowIds = new Set<number | undefined>([
      storedMainThread?.id,
      ...removedAgentRowIds,
      ...subAgents.filter((sub) => sub.parsed !== null).map((sub) => sub.stored?.id),
    ]);
    const subAgentsWithLostSpawn = new Set(
      subAgents.filter(
        (sub) =>
          sub.parsed === null && hasLostStoredSpawn(sub, storedAgentByRowId, readOrRemovedRowIds, spawnLedgerByAgentId),
      ),
    );
    if (subAgentsWithLostSpawn.size > 0) {
      read(subAgentsWithLostSpawn);
    } else {
      const forkSpawners = unreadHoldersOfUnnamedNewFirstMessages(
        statements,
        priorConversationId,
        subAgents,
        spawnLedgerByAgentId,
      );
      if (forkSpawners.size > 0) {
        read(forkSpawners);
      } else {
        const lineage = { storedMainThread, subAgents, removedAgentRowIds, spawnLedgerByAgentId };
        const spawnCallHolders = unreadHoldersOfMetaSpawnCalls(statements, parsed, lineage);
        if (spawnCallHolders.size === 0) break;
        read(spawnCallHolders);
      }
    }
    spawnLedgerByAgentId = indexSpawnLedgers(parsed, subAgents);
  }

  return {
    parsedConversation: {
      session,
      parsed,
      mainThreadFileKey,
      storedMainThread,
      isMainThreadRewritten: !isStoredFromFileAsIs(storedMainThread, mainThreadFileKey),
      subAgents,
      removedAgentRowIds,
      spawnLedgerByAgentId,
      parsedLogFileCount,
      priorConversationId,
    },
    vanishedSubAgentFileCount,
  };
}

/**
 * The kept, unread Sub-agents of stored Conversation `priorConversationId`
 * holding the first Message of a new Sub-agent no parsed ledger names: a fork's
 * file starts with a copy of its spawner's records (log-format §10), so these
 * may hold its spawn ledger. A new Sub-agent that is no fork costs one indexed
 * lookup, and reads nothing more.
 */
function unreadHoldersOfUnnamedNewFirstMessages(
  statements: RefreshStatements,
  priorConversationId: number | null,
  subAgents: SubAgentToWrite[],
  spawnLedgerByAgentId: Map<string, SpawnLedgerEntry>,
): Set<SubAgentToWrite> {
  const holders = new Set<SubAgentToWrite>();
  if (priorConversationId === null) return holders;
  const unreadSubAgentByRowId = new Map(
    subAgents.flatMap((sub) => (sub.parsed === null && sub.stored !== null ? [[sub.stored.id, sub] as const] : [])),
  );
  for (const sub of subAgents) {
    if (sub.stored !== null || spawnLedgerByAgentId.has(sub.file.agentId)) continue;
    const firstMessageUuid = sub.parsed?.messages[0]?.uuid;
    if (firstMessageUuid == null) continue;
    for (const agentRowId of statements.selectHoldingAgentIds(firstMessageUuid, priorConversationId)) {
      const holder = unreadSubAgentByRowId.get(agentRowId);
      if (holder !== undefined) holders.add(holder);
    }
  }
  return holders;
}

/**
 * The kept, unread Sub-agents holding the Agent call that spawned a Sub-agent
 * whose lineage this run decides, no parsed ledger names, and whose meta file
 * names a call the Main thread does not hold (log-format §4): its spawner is
 * among them, and reading them makes it, and its ledger if any, known as a cold
 * Refresh knows them (see `spawnerOfAgentCall`). One indexed lookup per such
 * Sub-agent, rare: nearly every spawn is named by a ledger.
 */
function unreadHoldersOfMetaSpawnCalls(
  statements: RefreshStatements,
  mainThread: ParsedSession,
  lineage: SubAgentLineageContext,
): Set<SubAgentToWrite> {
  const holders = new Set<SubAgentToWrite>();
  const unreadSubAgentByRowId = new Map(
    lineage.subAgents.flatMap((sub) =>
      sub.parsed === null && sub.stored !== null ? [[sub.stored.id, sub] as const] : [],
    ),
  );
  if (unreadSubAgentByRowId.size === 0) return holders;
  const unreadRowIds = [...unreadSubAgentByRowId.keys()];
  for (const sub of lineage.subAgents) {
    if (lineage.spawnLedgerByAgentId.has(sub.file.agentId) || !isLineageDecidedAgain(sub, lineage)) continue;
    const toolUseId = metaOf(sub).toolUseId;
    if (toolUseId === null || holdsToolUse(mainThread, toolUseId)) continue;
    for (const agentRowId of statements.selectToolUseHoldingAgentIds(toolUseId, unreadRowIds)) {
      const holder = unreadSubAgentByRowId.get(agentRowId)!;
      if (holder !== sub) holders.add(holder);
    }
  }
  return holders;
}

/** Whether `parsed` holds a `tool_use` with id `toolUseId`. */
function holdsToolUse(parsed: ParsedSession, toolUseId: string): boolean {
  return parsed.messages.some((message) => message.toolUses.some((toolUse) => toolUse.toolUseId === toolUseId));
}

/**
 * Whether the kept, unread `subAgent` was stored as a spawn that no ledger now
 * makes: its stored row names a spawning Sub-agent, an Agent type or a
 * spawning Message; its stored parent was read or removed this run; and no
 * parsed ledger names a resolved model for it. Its stored resolved model may
 * then be the lost spawn's, where a cold Refresh takes its own dominant one.
 */
function hasLostStoredSpawn(
  subAgent: SubAgentToWrite,
  storedAgentByRowId: Map<number, StoredAgent>,
  readOrRemovedRowIds: Set<number | undefined>,
  spawnLedgerByAgentId: Map<string, SpawnLedgerEntry>,
): boolean {
  const stored = subAgent.stored;
  if (stored === null || stored.parentAgentId === null) return false;
  const isStoredParentSubAgent = storedAgentByRowId.get(stored.parentAgentId)?.externalAgentId != null;
  const wasStoredAsSpawn = isStoredParentSubAgent || stored.agentType !== null || stored.spawnedByMessageId !== null;
  return (
    wasStoredAsSpawn &&
    readOrRemovedRowIds.has(stored.parentAgentId) &&
    spawnLedgerByAgentId.get(subAgent.file.agentId)?.spawn.resolvedModel == null
  );
}

/**
 * The path of the Project a parsed Conversation belongs to: the one its records
 * state (`ParsedSession.projectPath`); else — for a cwd-less Conversation — the
 * one most Conversations filed in the same log folder state through their own
 * records, ties to the smallest path, read from the database so siblings this
 * run skipped count; else the log folder name, decoded.
 *
 * `refresh()` writes cwd-less Conversations after every other one, so the
 * siblings of this run are already in. A cwd-less Conversation resolved while
 * its log folder had no cwd-bearing sibling keeps the decoded path until it
 * itself changes: a later sibling does not re-assign it.
 */
function resolveProjectPath(statements: RefreshStatements, session: DiscoveredSession, parsed: ParsedSession): string {
  return (
    parsed.projectPath ??
    statements.selectBorrowableProjectPath(path.dirname(session.sourcePath), session.sessionId) ??
    decodeLogFolderName(session.logFolderName)
  );
}

/** Find or create the row of the Project at `projectPath`. */
function upsertProject(statements: RefreshStatements, projectPath: string): number {
  return statements.selectProjectId(projectPath) ?? statements.insertProject({ path: projectPath });
}

/** The `message` row of one parsed message (FK columns + accounting). */
function messageRow(m: ParsedSession["messages"][number], conversationId: number, agentId: number): MessageRow {
  return {
    conversationId,
    agentId,
    messageId: m.messageId,
    uuid: m.uuid,
    role: m.role,
    kind: m.kind,
    text: m.text,
    origin: m.origin === null ? null : JSON.stringify(m.origin),
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheCreation5mTokens: m.cacheCreation5mTokens,
    cacheCreation1hTokens: m.cacheCreation1hTokens,
    cacheReadTokens: m.cacheReadTokens,
    model: m.model,
    effort: m.effort,
    thinkingText: m.thinkingText,
    thinkingDurationMs: m.thinkingDurationMs,
    attributionSkill: m.attributionSkill,
    attributionAgent: m.attributionAgent,
    attributionPlugin: m.attributionPlugin,
    attributionMcpServer: m.attributionMcpServer,
    permissionMode: m.permissionMode,
    isApiError: m.isApiError,
    apiErrorMessage: m.apiErrorMessage,
    timestamp: m.timestamp,
    requestRef: m.requestRef,
  };
}

const RESULT_TRUNCATE_CHARS = 10_000;

/**
 * How many chars of a `name` tool's result are stored (ADR-0001): an `Agent`
 * call's hand-back whole, every other tool's first {@link RESULT_TRUNCATE_CHARS}.
 *
 * @example resultStorageCap("Agent") // Infinity
 */
function resultStorageCap(name: string): number {
  return name === "Agent" ? Infinity : RESULT_TRUNCATE_CHARS;
}

/**
 * Cut each of `parsed`'s tool results, in place, to the most any `tool_use`
 * naming it stores ({@link resultStorageCap}; a result no `tool_use` names is
 * never stored, so cut like any non-Agent one), so a Conversation held until
 * its write keeps no more of a result than its rows: `resultCharSize` keeps
 * the full length. A `slice` keeps the string it was cut from alive; the JSON
 * round trip is the copy that frees it.
 */
function keepStoredToolResults(parsed: ParsedSession): ParsedSession {
  const capByToolUseId = new Map<string, number>();
  for (const message of parsed.messages) {
    for (const toolUse of message.toolUses) {
      if (toolUse.toolUseId === null) continue;
      const cap = Math.max(capByToolUseId.get(toolUse.toolUseId) ?? 0, resultStorageCap(toolUse.name));
      capByToolUseId.set(toolUse.toolUseId, cap);
    }
  }
  for (const result of parsed.toolResults.values()) {
    const cap = capByToolUseId.get(result.toolUseId) ?? RESULT_TRUNCATE_CHARS;
    if (result.resultText !== null && result.resultText.length > cap) {
      result.resultText = JSON.parse(JSON.stringify(result.resultText.slice(0, cap))) as string;
    }
  }
  return parsed;
}

/**
 * Write the `tool_call` rows for one agent's messages, pairing each `tool_use`
 * with its result (matched by `tool_use_id`, finding #6). The result is stored
 * up to its tool's {@link resultStorageCap}; `resultCharSize` keeps the FULL
 * length as a token-cost proxy (ADR-0001). `messageRowByMsgId` maps an assistant
 * `message.id` to its written row id (tool_uses only live on assistant turns).
 */
function writeToolCalls(
  statements: RefreshStatements,
  parsed: ParsedSession,
  agentId: number,
  messageRowByMsgId: Map<string, number>,
): void {
  for (const msg of parsed.messages) {
    if (msg.toolUses.length === 0 || msg.messageId === null) continue;
    const messageRowId = messageRowByMsgId.get(msg.messageId);
    if (messageRowId === undefined) continue;

    for (const tu of msg.toolUses) {
      const result = tu.toolUseId === null ? undefined : parsed.toolResults.get(tu.toolUseId);
      const fullResult = result?.resultText ?? null;
      const fullLength = result?.resultCharSize ?? null;
      const cap = resultStorageCap(tu.name);
      const truncated = fullResult !== null && fullLength !== null && fullLength > cap;
      statements.insertToolCall({
        messageId: messageRowId,
        agentId,
        toolUseId: tu.toolUseId,
        name: tu.name,
        inputJson: tu.inputJson,
        resultText: fullResult === null || !truncated ? fullResult : fullResult.slice(0, cap),
        resultTruncated: truncated,
        resultCharSize: fullResult === null ? null : fullLength,
        isError: result?.isError ?? false,
      });
    }
  }
}

/**
 * Insert `parsed.messages` for one agent, in order, and return a
 * `message.id → row id` map (for tool_call + spawnedBy linkage). When two rows
 * share a `message.id`, the later row wins.
 */
function writeAgentMessages(
  statements: RefreshStatements,
  parsed: ParsedSession,
  conversationId: number,
  agentId: number,
): Map<string, number> {
  const messageRowByMsgId = new Map<string, number>();
  for (const message of parsed.messages) {
    const messageRowId = statements.insertMessage(messageRow(message, conversationId, agentId));
    if (message.messageId !== null) messageRowByMsgId.set(message.messageId, messageRowId);
  }
  return messageRowByMsgId;
}

/**
 * Write one agent's log file's request records (log-format §9): each distinct
 * system prompt, tool set and sent message under its hash, unless already
 * stored, then one `api_request` row per `api-request` record, in file
 * order; then link each Turn of the file to the request of the file its
 * `requestRef` names. A Turn whose `requestRef` names a request of another
 * file is linked by the links pass (`refresh`).
 */
function writeApiRequests(
  statements: RefreshStatements,
  parsed: ParsedSession,
  conversationId: number,
  agentId: number,
  messageRowByMsgId: Map<string, number>,
): void {
  if (parsed.apiRequests.length === 0) return;
  const messageRowIdByRequestRef = new Map<string, number>();
  for (const message of parsed.messages) {
    if (message.requestRef === null || message.messageId === null) continue;
    const messageRowId = messageRowByMsgId.get(message.messageId);
    if (messageRowId !== undefined && !messageRowIdByRequestRef.has(message.requestRef)) {
      messageRowIdByRequestRef.set(message.requestRef, messageRowId);
    }
  }
  for (const [hash, blocksJson] of parsed.systemPromptJsonByHash) statements.insertSystemPrompt(hash, blocksJson);
  for (const [hash, toolsJson] of parsed.toolSetJsonByHash) statements.insertToolSet(hash, toolsJson);
  for (const [hash, sentMessage] of parsed.sentMessageByHash) statements.insertSentMessage(hash, sentMessage);
  const failedAttemptOfMessageRowIds = failedAttemptOwners(parsed.apiRequests, messageRowIdByRequestRef);
  parsed.apiRequests.forEach((request, positionInFile) => {
    statements.insertApiRequest({
      conversationId,
      agentId,
      failedAttemptOfMessageId: failedAttemptOfMessageRowIds[positionInFile]!,
      recordId: request.recordId,
      baseRecordId: request.baseRecordId,
      keptMessageCount: request.keptMessageCount,
      tailMessageHashesJson: JSON.stringify(request.tailMessageHashes),
      parametersJson: JSON.stringify(request.parameters),
      cacheBreakpointsJson: JSON.stringify(request.cacheBreakpoints),
      querySource: request.querySource,
      requestDigest: request.requestDigest,
      sentAt: request.sentAt,
      positionInFile,
      systemPromptHash: request.systemPromptHash,
      toolSetHash: request.toolSetHash,
    });
  });
  statements.updateTurnApiRequestsInFile(agentId);
}

/**
 * Of each request of one file's `requests`, in file order, the assistant
 * Message row of the Turn owning it as a Failed attempt (log-format §9,
 * Retries), else null. A request no Turn answered (none in
 * `messageRowIdByRequestRef`) is one when the file's next request resent it —
 * the same known `requestDigest`, its `base` this request — and then belongs
 * to that request's owner: its Turn, or the Turn owning it as a Failed attempt
 * in turn. A chain ending in a request nothing answers belongs to no Turn.
 */
function failedAttemptOwners(
  requests: ParsedApiRequest[],
  messageRowIdByRequestRef: Map<string, number>,
): (number | null)[] {
  const failedAttemptOfMessageRowIds: (number | null)[] = requests.map(() => null);
  // From the file's end back: the next request's owner is known before its own.
  let nextOwnerMessageRowId: number | null = null;
  for (let position = requests.length - 1; position >= 0; position--) {
    const request = requests[position]!;
    const next = requests[position + 1];
    const answeringMessageRowId = messageRowIdByRequestRef.get(request.recordId);
    const isResentByNext =
      next !== undefined &&
      request.requestDigest !== null &&
      next.requestDigest === request.requestDigest &&
      next.baseRecordId === request.recordId;
    if (answeringMessageRowId !== undefined) {
      nextOwnerMessageRowId = answeringMessageRowId;
    } else if (isResentByNext && nextOwnerMessageRowId !== null) {
      failedAttemptOfMessageRowIds[position] = nextOwnerMessageRowId;
    } else {
      nextOwnerMessageRowId = null;
    }
  }
  return failedAttemptOfMessageRowIds;
}

/**
 * Write one conversation, inside the caller's transaction, and return its row
 * id. A new one is inserted whole: its row, the Main thread (agent row +
 * messages + tool_calls + API requests), each sub-agent the same way, then
 * pr_links, turn_durations and continued_in rows. A stored one is rewritten in place, Agent by
 * Agent (ADR-0010): its row updated; each Agent whose file changed, and each
 * Sub-agent whose file is gone, deleted (cascading); each changed Agent written
 * again, the Main thread's pr_links, turn_durations and continued_in rows with it; and each kept
 * Sub-agent whose lineage this run decided again (see `isLineageDecidedAgain`)
 * updated in place.
 *
 * A Sub-agent's lineage comes from the spawn ledger naming it (log-format §4) —
 * in whichever log file it lives, main thread or another sub-agent (see
 * `orderParentsFirst`): its parent, its `spawnedByMessageId` (the parent's
 * Message holding the spawning `Agent` tool_use), its `agentType` and
 * `resolvedModel`; its meta file fills in what the ledger leaves out, and
 * without a ledger names the Agent call whose holder is its parent (see
 * `spawnOf`); without either, the Main thread and its own dominant model.
 *
 * A new conversation's rows go in this exact order, so a fresh database gets
 * the same row ids on every run (`stored-data-equivalence.test.ts` pins them).
 */
function writeConversation(statements: RefreshStatements, parsedConversation: ParsedConversation): number {
  const { session, parsed, storedMainThread, isMainThreadRewritten, subAgents, priorConversationId } =
    parsedConversation;

  // A stored Conversation is rewritten in place, in the SAME transaction as
  // its content, so a reader on another connection sees the old version or the
  // new one — never the Conversation missing — and its id, which the
  // Conversations continuing from it name, never changes.
  const projectId = upsertProject(statements, resolveProjectPath(statements, session, parsed));
  const conversationRow: ConversationRow = {
    sessionId: session.sessionId,
    projectId,
    projectPathFromRecords: parsed.projectPath !== null,
    title: parsed.title,
    gitBranch: parsed.gitBranch,
    ccVersion: parsed.ccVersion,
    sourcePath: session.sourcePath,
    sourceMtime: session.sourceMtime,
    sourceSize: session.sourceSize,
    // Not stamped yet — pass 3 does that once this refresh's continuation
    // linking has run (see `UNSTAMPED_PARSER_VERSION`).
    parserVersion: UNSTAMPED_PARSER_VERSION,
    // Resolved again by pass 2 (`resolveContinuations`).
    continuedFromConversationId: null,
  };
  let conversationId: number;
  if (priorConversationId === null) {
    conversationId = statements.insertConversation(conversationRow);
  } else {
    conversationId = priorConversationId;
    statements.updateConversation(conversationId, conversationRow);
    deleteRewrittenAndRemovedAgents(statements, conversationId, parsedConversation);
  }

  let mainThreadRowId: number;
  if (isMainThreadRewritten) {
    mainThreadRowId = statements.insertAgent({
      conversationId,
      parentAgentId: null,
      externalAgentId: null,
      spawnedByMessageId: null,
      agentType: null, // root/main thread
      resolvedModel: parsed.dominantModel,
      ...parsedConversation.mainThreadFileKey,
    });
    writeAgentContent(statements, parsed, conversationId, mainThreadRowId);
  } else {
    mainThreadRowId = storedMainThread!.id;
  }

  // Sub-agents: each log file is its own agent row (single source of truth
  // for its tokens — the parent aggregate is NOT summed), written parents-first
  // so a child's parent row and Messages exist when its lineage is set.
  const agentRowIdByAgentId = new Map(
    subAgents.flatMap((sub) => (sub.isRewritten ? [] : [[sub.file.agentId, sub.stored!.id] as const])),
  );
  const subAgentByAgentId = new Map(subAgents.map((sub) => [sub.file.agentId, sub]));
  const isDecidedAgain = (sub: SubAgentToWrite) => isLineageDecidedAgain(sub, parsedConversation);
  const plans = orderParentsFirst(
    new Map(
      subAgents.filter(isDecidedAgain).map((sub) => [sub.file.agentId, spawnOf(sub, parsedConversation)] as const),
    ),
    new Set(subAgents.filter((sub) => !isDecidedAgain(sub)).map((sub) => sub.file.agentId)),
  );
  for (const plan of plans) {
    const subAgent = subAgentByAgentId.get(plan.agentId)!;
    const parentAgentRowId =
      plan.parentExternalId === null ? mainThreadRowId : agentRowIdByAgentId.get(plan.parentExternalId)!;
    const toolUseId = plan.spawn.toolUseId;
    const lineage: AgentLineageRow = {
      parentAgentId: parentAgentRowId,
      spawnedByMessageId:
        toolUseId === null ? null : (statements.selectSpawningMessageId(parentAgentRowId, toolUseId) ?? null),
      agentType: plan.spawn.agentType,
      // A kept Sub-agent left unread kept its spawn, or never had one: its
      // stored model is what its file and that spawn gave (`parseConversation`).
      resolvedModel:
        plan.spawn.resolvedModel ??
        (subAgent.parsed === null ? subAgent.stored!.resolvedModel : subAgent.parsed.dominantModel),
    };
    if (!subAgent.isRewritten) {
      statements.updateAgentLineage(subAgent.stored!.id, lineage);
      continue;
    }
    const subAgentRowId = statements.insertAgent({
      conversationId,
      externalAgentId: plan.agentId,
      ...lineage,
      sourceMtime: subAgent.file.sourceMtime,
      sourceSize: subAgent.file.sourceSize,
    });
    writeAgentContent(statements, subAgent.parsed!, conversationId, subAgentRowId);
    agentRowIdByAgentId.set(plan.agentId, subAgentRowId);
  }

  if (!isMainThreadRewritten) return conversationId;
  for (const prLink of parsed.prLinks) {
    statements.insertPrLink({
      conversationId,
      prNumber: prLink.prNumber,
      prUrl: prLink.prUrl,
      prRepository: prLink.prRepository,
    });
  }
  for (const turnDuration of parsed.turnDurations) {
    statements.insertTurnDuration({
      conversationId,
      durationMs: turnDuration.durationMs,
      messageCount: turnDuration.messageCount,
    });
  }
  for (const sessionId of parsed.continuedInSessionIds) statements.insertContinuedIn({ conversationId, sessionId });
  return conversationId;
}

/**
 * Delete, from a stored Conversation, each Agent whose file changed or is gone
 * — its Messages, Tool calls and API requests by cascade, which also clears the
 * lineage of its kept children and the API request links of Turns in other
 * files — and, when the Main thread changed, its pr_links, turn_durations and continued_in rows.
 */
function deleteRewrittenAndRemovedAgents(
  statements: RefreshStatements,
  conversationId: number,
  { storedMainThread, isMainThreadRewritten, subAgents, removedAgentRowIds }: ParsedConversation,
): void {
  for (const agentRowId of removedAgentRowIds) statements.deleteAgent(agentRowId);
  for (const sub of subAgents) if (sub.isRewritten && sub.stored !== null) statements.deleteAgent(sub.stored.id);
  if (!isMainThreadRewritten) return;
  if (storedMainThread !== null) statements.deleteAgent(storedMainThread.id);
  statements.deletePrLinksTurnDurationsAndContinuedIn(conversationId);
}

/**
 * Whether this run decides `subAgent`'s lineage again: it is written anew, a
 * parsed ledger names it, its stored parent was read, rewritten or removed, or
 * it was stored with neither a type nor a spawning Message and now has a meta
 * file, which may give it both (log-format §4). A kept Sub-agent under a parent
 * left unread, and named by no parsed ledger, keeps its stored lineage.
 */
function isLineageDecidedAgain(
  subAgent: SubAgentToWrite,
  { storedMainThread, subAgents, removedAgentRowIds, spawnLedgerByAgentId }: SubAgentLineageContext,
): boolean {
  if (subAgent.isRewritten || spawnLedgerByAgentId.has(subAgent.file.agentId)) return true;
  const stored = subAgent.stored!;
  if (stored.agentType === null && stored.spawnedByMessageId === null && subAgent.file.metaPath !== null) return true;
  const storedParentRowId = stored.parentAgentId;
  return (
    storedParentRowId === storedMainThread?.id ||
    removedAgentRowIds.includes(storedParentRowId!) ||
    subAgents.some((sub) => sub.parsed !== null && sub.stored?.id === storedParentRowId)
  );
}

/** Write one Agent's Messages, Tool calls and API requests, from its parsed log file. */
function writeAgentContent(
  statements: RefreshStatements,
  parsed: ParsedSession,
  conversationId: number,
  agentRowId: number,
): void {
  const messageRowByMsgId = writeAgentMessages(statements, parsed, conversationId, agentRowId);
  writeToolCalls(statements, parsed, agentRowId, messageRowByMsgId);
  writeApiRequests(statements, parsed, conversationId, agentRowId, messageRowByMsgId);
}

/**
 * A Sub-agent's spawn, each field from the ledger naming it when the ledger
 * states it, else from its meta file (log-format §4).
 */
type SubAgentSpawn = {
  /** External id of the spawning Sub-agent; null ⇒ the Main thread, or no spawner found. */
  parentExternalId: string | null;
  /** The `tool_use_id` of the spawning Agent call; null when no spawner holds one. */
  toolUseId: string | null;
  agentType: string | null;
  /** The ledger's; a meta file's is never read (the transcript's dominant model is exact). */
  resolvedModel: string | null;
};

/** One sub-agent resolved to its true parent, in write order. */
type SubAgentPlan = {
  agentId: string;
  /** External id of the spawning SUB-agent; null ⇒ spawned by the main thread. */
  parentExternalId: string | null;
  spawn: SubAgentSpawn;
};

/**
 * `subAgent`'s spawn: the ledger naming it, its type and Agent call filled in
 * from its meta file where the ledger states none; without a ledger, the meta
 * file's type, and the Agent holding the call the meta file names as its
 * spawner (see `spawnerOfAgentCall`); without either, no spawner and no type.
 * The meta file is read only when the ledger leaves a field to fill.
 */
function spawnOf(
  subAgent: SubAgentToWrite,
  { parsed, subAgents, spawnLedgerByAgentId }: ParsedConversation,
): SubAgentSpawn {
  const ledger = spawnLedgerByAgentId.get(subAgent.file.agentId);
  if (ledger !== undefined) {
    const { toolUseId, agentType, resolvedModel } = ledger.spawn;
    return {
      parentExternalId: ledger.parentExternalId,
      toolUseId: toolUseId ?? metaOf(subAgent).toolUseId,
      agentType: agentType ?? metaOf(subAgent).agentType,
      resolvedModel,
    };
  }
  const { agentType, toolUseId } = metaOf(subAgent);
  const spawner =
    toolUseId === null ? undefined : spawnerOfAgentCall(toolUseId, subAgent, parsed, subAgents, spawnLedgerByAgentId);
  return spawner === undefined
    ? { parentExternalId: null, toolUseId: null, agentType, resolvedModel: null }
    : { parentExternalId: spawner.externalAgentId, toolUseId, agentType, resolvedModel: null };
}

/**
 * The Agent holding the Agent call `toolUseId` that spawned `subAgent`, by
 * external id (null ⇒ the Main thread), or undefined when no parsed log file
 * holds it. Several may hold it — a fork's file copies its spawner's records,
 * its spawner's Agent calls included (log-format §10) — so, in order:
 *   1. the Main thread, when it holds it;
 *   2. never `subAgent` itself, nor any of its descendants: a spawner cannot
 *      descend from what it spawned;
 *   3. of the Sub-agents left, not one spawned by another of them, which
 *      copied the call from that spawner;
 *   4. then the first in discovery order.
 * Who spawned a Sub-agent, for 2 and 3, is what this run's ledgers say, else
 * the stored lineage of a Sub-agent kept as it is (see `spawnerExternalIdOf`).
 */
function spawnerOfAgentCall(
  toolUseId: string,
  subAgent: SubAgentToWrite,
  mainThread: ParsedSession,
  subAgents: SubAgentToWrite[],
  spawnLedgerByAgentId: Map<string, SpawnLedgerEntry>,
): { externalAgentId: string | null } | undefined {
  if (holdsToolUse(mainThread, toolUseId)) return { externalAgentId: null };
  const spawnerIdOf = spawnerExternalIdOf(subAgents, spawnLedgerByAgentId);
  /** Whether Sub-agent `agentId` is `subAgent` or descends from it. */
  const isSubAgentOrDescendant = (agentId: string) => {
    const visited = new Set<string>();
    for (let id: string | null = agentId; id !== null && !visited.has(id); id = spawnerIdOf(id)) {
      if (id === subAgent.file.agentId) return true;
      visited.add(id);
    }
    return false;
  };
  const holderIds = subAgents
    .filter((sub) => sub.parsed !== null && holdsToolUse(sub.parsed, toolUseId))
    .map((sub) => sub.file.agentId)
    .filter((holderId) => !isSubAgentOrDescendant(holderId));
  const isCopiedFromAnotherHolder = (holderId: string) => {
    const spawnerId = spawnerIdOf(holderId);
    return spawnerId !== null && spawnerId !== holderId && holderIds.includes(spawnerId);
  };
  const spawnerId = holderIds.find((holderId) => !isCopiedFromAnotherHolder(holderId)) ?? holderIds[0];
  return spawnerId === undefined ? undefined : { externalAgentId: spawnerId };
}

/**
 * A lookup of the external id of the Sub-agent that spawned Sub-agent
 * `agentId` (null ⇒ the Main thread, or none known): the parsed ledger naming
 * it, else, for a Sub-agent kept as it is, its stored parent.
 */
function spawnerExternalIdOf(
  subAgents: SubAgentToWrite[],
  spawnLedgerByAgentId: Map<string, SpawnLedgerEntry>,
): (agentId: string) => string | null {
  const externalIdByRowId = new Map(
    subAgents.flatMap((sub) => (sub.stored === null ? [] : [[sub.stored.id, sub.file.agentId] as const])),
  );
  const storedParentRowIdByAgentId = new Map(
    subAgents.flatMap((sub) =>
      sub.isRewritten || sub.stored === null ? [] : [[sub.file.agentId, sub.stored.parentAgentId] as const],
    ),
  );
  return (agentId) => {
    const ledger = spawnLedgerByAgentId.get(agentId);
    if (ledger !== undefined) return ledger.parentExternalId;
    const storedParentRowId = storedParentRowIdByAgentId.get(agentId);
    return storedParentRowId == null ? null : (externalIdByRowId.get(storedParentRowId) ?? null);
  };
}

/**
 * Index the spawn ledgers of the Main thread and of every parsed Sub-agent by
 * the external id they spawned. A grandchild's ledger lives in its parent
 * sub-agent's log file, not the root's. The root's ledgers win over a
 * sub-agent's on a (malformed) duplicate claim, then the first in discovery
 * order; a Sub-agent claiming itself is ignored.
 */
function indexSpawnLedgers(root: ParsedSession, subAgents: SubAgentToWrite[]): Map<string, SpawnLedgerEntry> {
  const spawnLedgerByAgentId = new Map<string, SpawnLedgerEntry>();
  for (const [agentId, spawn] of root.agentSpawns) {
    spawnLedgerByAgentId.set(agentId, { parentExternalId: null, spawn });
  }
  for (const sub of subAgents) {
    if (sub.parsed === null) continue;
    for (const [agentId, spawn] of sub.parsed.agentSpawns) {
      if (agentId === sub.file.agentId || spawnLedgerByAgentId.has(agentId)) continue;
      spawnLedgerByAgentId.set(agentId, { parentExternalId: sub.file.agentId, spawn });
    }
  }
  return spawnLedgerByAgentId;
}

/**
 * Resolve each Sub-agent of `pendingSpawnByAgentId` to its true parent by its
 * spawn (see `spawnOf`), and order them PARENTS-FIRST: a child comes after its
 * parent, so the parent's row and message rows exist when the child is written.
 * A parent in `settledAgentIds` — a kept Sub-agent whose lineage stays — is
 * already there.
 *
 * Unresolvable parentage — no spawner found, or a spawn CYCLE — falls back
 * to the main thread, matching the defensive nesting in `buildAgentTree`
 * (read.ts). The leftover pass is what makes a cycle terminate instead of
 * looping forever.
 */
function orderParentsFirst(
  pendingSpawnByAgentId: Map<string, SubAgentSpawn>,
  settledAgentIds: Set<string>,
): SubAgentPlan[] {
  const ordered: SubAgentPlan[] = [];
  const emitted = new Set(settledAgentIds);
  const pending = [...pendingSpawnByAgentId.keys()];

  // Repeatedly emit every sub-agent whose parent is the main thread or has
  // already been emitted, until a full sweep makes no progress.
  for (let progress = true; progress;) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const agentId = pending[i];
      if (agentId === undefined) continue;
      const spawn = pendingSpawnByAgentId.get(agentId)!;
      const parentExternalId = spawn.parentExternalId;
      if (parentExternalId !== null && !emitted.has(parentExternalId)) continue;
      ordered.push({ agentId, parentExternalId, spawn });
      emitted.add(agentId);
      pending.splice(i, 1);
      progress = true;
    }
  }

  // Leftovers: a cycle → attach under the main thread.
  for (const agentId of pending) {
    ordered.push({ agentId, parentExternalId: null, spawn: pendingSpawnByAgentId.get(agentId)! });
  }
  return ordered;
}

/**
 * Pass 2: decide again the parent (`continuedFromConversationId`) and the
 * Copied Messages of every Conversation this run may have changed them for —
 * each written one; each stored one holding a written one's first Message
 * (every copy of a session, and every session it copies, holds its first
 * Message); each one a written one's `continued-in` records name, or that
 * continues from it; and `orphanedContinuationIds`, the continuations of the
 * Conversations this run deleted. A forked Sub-agent's flags, decided against
 * its spawning Agent of the same Conversation, are decided again with every
 * written one: a change to either Agent's file writes it. Resumed sessions
 * stay DISTINCT rows (ADR-0001): the link only records lineage.
 *
 * Every decision reads the DATABASE, never what this run parsed, so a skipped
 * parent still counts and the outcome is the same in a cold Refresh and an
 * incremental one, whatever order the files were written in. Lookups are by
 * indexed uuid or session id: an unrelated Conversation costs a few.
 */
function resolveContinuations(
  statements: RefreshStatements,
  writtenConversations: WrittenConversation[],
  orphanedContinuationIds: Set<number>,
): void {
  const writtenConversationIds = writtenConversations.map((written) => written.conversationId);
  const conversationIdsToResolve = new Set([...writtenConversationIds, ...orphanedContinuationIds]);
  for (const { conversationId, firstMessageUuid } of writtenConversations) {
    if (firstMessageUuid === null) continue;
    for (const holder of statements.selectOtherHolders(firstMessageUuid, conversationId)) {
      conversationIdsToResolve.add(holder.id);
    }
  }
  const namedSessionIds = writtenConversations.flatMap((written) => written.continuedInSessionIds);
  for (const id of statements.selectConversationIdsBySessionId(namedSessionIds)) conversationIdsToResolve.add(id);
  for (const id of statements.selectContinuationIds(writtenConversationIds)) conversationIdsToResolve.add(id);

  for (const conversationId of conversationIdsToResolve) {
    const continuation = statements.selectContinuationCandidate(conversationId);
    if (continuation === undefined) continue; // deleted by this run
    const parentId =
      statements.selectNamingConversationId(continuation.sessionId, continuation.id) ??
      selectParentByCopy(statements, continuation);
    statements.updateContinuedFrom(continuation.id, parentId);
    statements.updateCopiedMessages(continuation.id, parentId);
  }
}

/**
 * The parent of `continuation` when no `continued-in` record names it
 * (log-format §10): of the other Conversations holding its first Message,
 * those whose Main-thread Messages its Main thread holds all of — not one its
 * own record names, and, when each holds all of the other's, only one with a
 * smaller `source_path` — the one sharing the longest leading run of Messages
 * with it, ties to the smallest `source_path`. Null without one: a near-fork,
 * where each holds a Message the other lacks, is never guessed.
 */
function selectParentByCopy(statements: RefreshStatements, continuation: ContinuationCandidate): number | null {
  const firstMessageUuid = statements.selectFirstMessageUuid(continuation.mainThreadAgentId);
  if (firstMessageUuid == null) return null;
  let parent: { id: number; sharedLeadingRunLength: number } | null = null;
  // Smallest `source_path` first, so a tie keeps the earlier holder.
  for (const holder of statements.selectOtherHolders(firstMessageUuid, continuation.id)) {
    if (statements.isSessionNamed(continuation.id, holder.sessionId)) continue;
    if (!statements.isEveryMessageHeld(holder.mainThreadAgentId, continuation.mainThreadAgentId)) continue;
    const isSameMessages = statements.isEveryMessageHeld(continuation.mainThreadAgentId, holder.mainThreadAgentId);
    if (isSameMessages && holder.sourcePath > continuation.sourcePath) continue;
    const sharedLeadingRunLength = statements.selectSharedLeadingRunLength(
      continuation.mainThreadAgentId,
      holder.mainThreadAgentId,
    );
    if (parent === null || sharedLeadingRunLength > parent.sharedLeadingRunLength) {
      parent = { id: holder.id, sharedLeadingRunLength };
    }
  }
  return parent?.id ?? null;
}

/**
 * Pass 3: mark `conversationIds` as produced by the current parser — the
 * commit point that lets a later run SKIP them.
 *
 * One statement scoped to the conversations this run (re)wrote or linked
 * again: nothing else in the table is touched, so the incremental cost stays
 * proportional to the work actually done, not to the size of the database.
 */
function stampParserVersion(statements: RefreshStatements, conversationIds: number[]): void {
  statements.updateParserVersion(conversationIds, PARSER_VERSION);
}
