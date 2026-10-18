// The Recording format (ADR-0006, docs/recording-format.md): the writer the
// Recorder appends with and the reader ingestion reads with, in one module so
// the two cannot drift apart. Node built-ins only: the Recorder imports it and
// never touches the database.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { constants as zlibConstants, gunzipSync, gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

/** The value stored in place of a secret. */
const REDACTED = "<redacted>";
/** Headers whose values are never written (request and response alike). */
const SECRET_HEADER_NAMES = new Set(["authorization", "x-api-key", "cookie", "set-cookie"]);
/** The file stem of the API requests no session could be found for. */
const UNATTRIBUTED_FILE_STEM = "unattributed";
/** The session ids that can name a file: anything else is filed as unattributed. */
const SAFE_SESSION_ID = /^[A-Za-z0-9-]{1,128}$/;
const RECORDING_FILE_SUFFIX = ".jsonl.gz";
/** The legacy `metadata.user_id` shape: `user_<device>_account_<account>_session_<session>`. */
const LEGACY_USER_ID = /^user_(.*)_account_(.*)_session_(.+)$/;

/** HTTP headers as Node gives them, lower-cased. */
export type RecordedHeaders = Record<string, string | string[]>;

/** When an API request reached the Recorder, when its response's first byte came back, and when it ended (ISO 8601). */
export type ApiRequestTimings = {
  arrivedAt: string;
  /** Null when no response byte ever came back (an unreachable upstream). */
  firstByteAt: string | null;
  endedAt: string;
};

/** The response to an API request, as the Recorder passed it back. */
export type RecordedResponse = {
  status: number;
  /** The `request-id` response header, null when there was none. */
  requestId: string | null;
  headers: RecordedHeaders;
  /**
   * The reassembled message of a streamed response, the parsed JSON of any
   * other, the text of a body that is not JSON, or null for an empty one.
   */
  body: unknown;
  /** True when the response was an event stream, reassembled into `body`. */
  isStreamed: boolean;
};

/** One API request and its response, as the writer takes it and the reader returns it. */
export type RecordedApiRequest = {
  /** The Conversation's session id, null for an unattributed API request. */
  sessionId: string | null;
  /** The `x-claude-code-agent-id` header, sent by a sub-agent. */
  agentId: string | null;
  method: string;
  path: string;
  /** The query string, without its `?`; empty when there was none. */
  query: string;
  headers: RecordedHeaders;
  /** The parsed JSON body, the text of a body that is not JSON, or null for an empty one. */
  body: unknown;
  response: RecordedResponse;
  timings: ApiRequestTimings;
  /** Why the Recorder answered for an upstream it could not reach. */
  proxyError?: string;
  /** True when the client disconnected before the response ended. */
  isClientAborted?: boolean;
};

/** Appends API requests to the Recordings under one root. */
export type RecordingWriter = {
  /** Redact `apiRequest`, then append it with its new pieces to its session's file, as one gzip member. */
  append(apiRequest: RecordedApiRequest): Promise<void>;
  /** Resolve once every append started so far has settled. */
  flush(): Promise<void>;
};

/** A line of a Recording file: a deduplicated piece, or an API request referencing pieces by hash. */
type RecordingLine = PieceLine | ApiRequestLine;
type PieceLine = { type: "piece"; hash: string; content: unknown };
type ApiRequestLine = Omit<RecordedApiRequest, "body"> & { type: "api_request"; body: StoredBody };
/** The request body on disk: its pieces split out by hash, or kept whole when it is not a JSON object. */
type StoredBody =
  | null
  | { text: string }
  | { json: unknown }
  | {
      parameters: Record<string, unknown>;
      system?: string | string[];
      tools?: string[];
      messages?: string[];
    };

/**
 * The root the Recorder writes Recordings under: `CCA_RECORDINGS_ROOT` (empty
 * counts as unset) resolved against the process cwd, else
 * `~/.claude-convo-analyzer/recordings`. Read at call time.
 *
 * @example
 * // CCA_RECORDINGS_ROOT=data/recordings → "<cwd>/data/recordings"
 * const apiRequests = readRecordings(defaultRecordingsRoot());
 */
export function defaultRecordingsRoot(): string {
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.CCA_RECORDINGS_ROOT ||
      path.join(os.homedir(), ".claude-convo-analyzer", "recordings"),
  );
}

/**
 * The session id carried by a `metadata.user_id`, in its JSON shape
 * (`{"session_id": …}`) or its legacy one (`user_…_account_…_session_<id>`);
 * null for any other.
 *
 * @example
 * sessionIdInUserId("user_ab_account__session_6f1c"); // "6f1c"
 */
export function sessionIdInUserId(userId: string): string | null {
  const userIdObject = parseJsonObject(userId);
  if (userIdObject) return typeof userIdObject.session_id === "string" ? userIdObject.session_id : null;
  return LEGACY_USER_ID.exec(userId)?.[3] ?? null;
}

/**
 * A writer appending to the Recordings under `recordingsRoot`, created on the
 * first append. Appends to one file are serialized, so a piece shared by
 * concurrent API requests is still written once.
 *
 * @example
 * const writer = openRecordingWriter(defaultRecordingsRoot());
 * await writer.append(apiRequest);
 */
export function openRecordingWriter(recordingsRoot: string): RecordingWriter {
  /** Per file: the hashes already in it (loaded on first use) and the tail of its append queue. */
  const fileStateByPath = new Map<string, { pieceHashes: Set<string> | null; appendQueue: Promise<void> }>();

  async function appendToFile(filePath: string, apiRequest: RecordedApiRequest): Promise<void> {
    const fileState = fileStateByPath.get(filePath)!;
    if (!fileState.pieceHashes) {
      await mkdir(recordingsRoot, { recursive: true });
      fileState.pieceHashes = await pieceHashesInFile(filePath);
    }
    const newPieceLines: PieceLine[] = [];
    const storePiece = (content: unknown): string => {
      const hash = hashOf(content);
      if (!fileState.pieceHashes!.has(hash) && !newPieceLines.some((line) => line.hash === hash)) {
        newPieceLines.push({ type: "piece", hash, content });
      }
      return hash;
    };
    const apiRequestLine: ApiRequestLine = {
      ...apiRequest,
      type: "api_request",
      body: storedBody(apiRequest.body, storePiece),
    };
    const text = [...newPieceLines, apiRequestLine].map((line) => JSON.stringify(line) + "\n").join("");
    // One gzip member, one write: a crash leaves at most this member cut short.
    await appendFile(filePath, await gzipAsync(text));
    for (const line of newPieceLines) fileState.pieceHashes.add(line.hash);
  }

  return {
    append(apiRequest) {
      const redactedApiRequest = redacted(apiRequest);
      const filePath = path.join(recordingsRoot, recordingFileName(redactedApiRequest.sessionId));
      const fileState = fileStateByPath.get(filePath) ?? { pieceHashes: null, appendQueue: Promise.resolve() };
      fileStateByPath.set(filePath, fileState);
      const appended = fileState.appendQueue.then(() => appendToFile(filePath, redactedApiRequest));
      fileState.appendQueue = appended.catch(() => {});
      return appended;
    },
    async flush() {
      await Promise.all([...fileStateByPath.values()].map((fileState) => fileState.appendQueue));
    },
  };
}

/**
 * Every API request in the Recordings under `recordingsRoot`, in full, file by
 * file (sorted by name) and in append order within a file. A file's last gzip
 * member, if cut short, is read up to its last complete API request.
 *
 * @example
 * const sideRequests = readRecordings(defaultRecordingsRoot()).filter((r) => r.agentId === null);
 */
export function readRecordings(recordingsRoot: string): RecordedApiRequest[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(recordingsRoot).filter((name) => name.endsWith(RECORDING_FILE_SUFFIX));
  } catch {
    return [];
  }
  return fileNames.sort().flatMap((fileName) => {
    const contentByHash = new Map<string, unknown>();
    const apiRequests: RecordedApiRequest[] = [];
    for (const line of linesInFile(readFileSync(path.join(recordingsRoot, fileName)))) {
      if (line.type === "piece") contentByHash.set(line.hash, line.content);
      else apiRequests.push({ ...withoutType(line), body: restoredBody(line.body, contentByHash) });
    }
    return apiRequests;
  });
}

/** The file an API request of `sessionId` is appended to. */
function recordingFileName(sessionId: string | null): string {
  return (sessionId ?? UNATTRIBUTED_FILE_STEM) + RECORDING_FILE_SUFFIX;
}

/** `apiRequest` with its secrets replaced, and an unsafe session id dropped. */
function redacted(apiRequest: RecordedApiRequest): RecordedApiRequest {
  const sessionId =
    apiRequest.sessionId !== null && SAFE_SESSION_ID.test(apiRequest.sessionId) ? apiRequest.sessionId : null;
  return {
    ...apiRequest,
    sessionId,
    headers: redactedHeaders(apiRequest.headers),
    body: bodyWithRedactedUserId(apiRequest.body),
    response: { ...apiRequest.response, headers: redactedHeaders(apiRequest.response.headers) },
  };
}

function redactedHeaders(headers: RecordedHeaders): RecordedHeaders {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      if (!SECRET_HEADER_NAMES.has(name.toLowerCase())) return [name, value];
      return [name, Array.isArray(value) ? value.map(() => REDACTED) : REDACTED];
    }),
  );
}

/** `body` with every part of its `metadata.user_id` but the session id replaced. */
function bodyWithRedactedUserId(body: unknown): unknown {
  if (!isPlainObject(body) || !isPlainObject(body.metadata) || typeof body.metadata.user_id !== "string") return body;
  return { ...body, metadata: { ...body.metadata, user_id: redactedUserId(body.metadata.user_id) } };
}

function redactedUserId(userId: string): string {
  const userIdObject = parseJsonObject(userId);
  if (userIdObject) {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(userIdObject).map(([key, value]) => [key, key === "session_id" ? value : REDACTED]),
      ),
    );
  }
  const legacySessionId = LEGACY_USER_ID.exec(userId)?.[3];
  return legacySessionId ? `user_${REDACTED}_account_${REDACTED}_session_${legacySessionId}` : REDACTED;
}

/** The body as stored: a JSON object's system blocks, tool definitions and messages become hashes. */
function storedBody(body: unknown, storePiece: (content: unknown) => string): StoredBody {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return { text: body };
  if (!isPlainObject(body)) return { json: body };
  const { system, tools, messages, ...parameters } = body;
  const stored: StoredBody = { parameters };
  if (typeof system === "string") stored.system = storePiece(system);
  else if (Array.isArray(system)) stored.system = system.map(storePiece);
  else if (system !== undefined) parameters.system = system;
  if (Array.isArray(tools)) stored.tools = tools.map(storePiece);
  else if (tools !== undefined) parameters.tools = tools;
  if (Array.isArray(messages)) stored.messages = messages.map(storePiece);
  else if (messages !== undefined) parameters.messages = messages;
  return stored;
}

function restoredBody(stored: StoredBody, contentByHash: Map<string, unknown>): unknown {
  if (stored === null) return null;
  if ("text" in stored) return stored.text;
  if ("json" in stored) return stored.json;
  const contentOf = (hash: string): unknown => {
    if (!contentByHash.has(hash)) throw new Error(`Recording references a missing piece ${hash}`);
    return contentByHash.get(hash);
  };
  const body: Record<string, unknown> = { ...stored.parameters };
  if (stored.system !== undefined) {
    body.system = typeof stored.system === "string" ? contentOf(stored.system) : stored.system.map(contentOf);
  }
  if (stored.tools) body.tools = stored.tools.map(contentOf);
  if (stored.messages) body.messages = stored.messages.map(contentOf);
  return body;
}

/** The hash a piece is stored under: sha256 (hex) of its canonical JSON. */
function hashOf(content: unknown): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

/** JSON with every object's keys sorted, so equal values serialize alike. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    isPlainObject(nested)
      ? Object.fromEntries(
          Object.keys(nested)
            .sort()
            .map((key) => [key, nested[key]]),
        )
      : nested,
  );
}

async function pieceHashesInFile(filePath: string): Promise<Set<string>> {
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
  return new Set(linesInFile(bytes).flatMap((line) => (line.type === "piece" ? [line.hash] : [])));
}

/** The lines of a Recording file, its gzip members decoded; a line cut short at the end is dropped. */
function linesInFile(bytes: Buffer): RecordingLine[] {
  // A sync flush returns what a truncated last member decodes to instead of throwing.
  const lines = gunzipSync(bytes, { finishFlush: zlibConstants.Z_SYNC_FLUSH }).toString("utf8").split("\n");
  const completeLines = lines.slice(0, -1); // the text after the last newline is cut short, or empty
  return completeLines.map((line) => JSON.parse(line) as RecordingLine);
}

function withoutType(line: ApiRequestLine): Omit<ApiRequestLine, "type"> {
  const apiRequest: Partial<ApiRequestLine> = { ...line };
  delete apiRequest.type;
  return apiRequest as Omit<ApiRequestLine, "type">;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
