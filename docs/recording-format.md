# Recording format (reference)

What the Recorder writes to disk, and what ingestion reads back (ADR-0006). The
writer and the reader are one module, `src/core/recording.ts`
(`openRecordingWriter`, `readRecordings`); this page describes the bytes they
agree on, so a Recording can be read without that module.

## 1. Files

```
~/.claude-convo-analyzer/recordings/      ← CCA_RECORDINGS_ROOT
    <sessionId>.jsonl.gz                  ← one file per session
    unattributed.jsonl.gz                 ← API requests no session was found for
```

- The **session id** names the file only when it is 1–128 characters of
  `[A-Za-z0-9-]` (a Claude Code session id is a UUID). An API request with no
  session, or one outside that charset, goes to `unattributed.jsonl.gz` with
  `sessionId: null`.
- How the Recorder finds the session of an API request: the
  `x-claude-code-session-id` header, else the session id in `metadata.user_id`
  (§4), else the only active session if exactly one is (one that sent an API
  request in the last 15 minutes), else none.
- Files are **append-only**. Nothing is ever rewritten or deleted.

## 2. Gzip members

A file is a concatenation of complete **gzip members**, one per API request,
each written with a single append. `gunzip` (or `zcat`) reads the whole file as
one text. A crash can leave at most the last member cut short; a reader decodes
what it can of it and drops the line cut short, so every API request before it
survives.

The decoded text is JSON Lines. One member holds, in order, the **pieces** the
API request introduced to this file, then the **API request** line. A piece
always precedes, in the same file, the first line that references it.

## 3. Lines

Every line has a `type`.

### `piece`

```json
{ "type": "piece", "hash": "<sha256 hex>", "content": <any JSON> }
```

One system block, tool definition or message, stored once per file.
`content` is the value exactly as sent. A system prompt sent as one string is a
piece whose `content` is that string.

**Hashing rule**: `hash` is the lowercase hex sha256 of the content's
**canonical JSON**: `JSON.stringify` with every object's keys sorted (arrays
keep their order, no whitespace). Two values that differ only in key order are
the same piece. A message that differs in any byte — e.g. a moved
`cache_control` marker — is a new piece.

### `api_request`

```json
{
  "type": "api_request",
  "sessionId": "<uuid>" | null,
  "agentId": "<x-claude-code-agent-id>" | null,
  "method": "POST",
  "path": "/v1/messages",
  "query": "beta=true",
  "headers": { "<lower-cased name>": "<value>" | ["<value>", …] },
  "body": <stored body>,
  "response": {
    "status": 200,
    "requestId": "req_…" | null,
    "headers": { … },
    "body": <response body>,
    "isStreamed": true
  },
  "timings": { "arrivedAt": "<ISO 8601>", "firstByteAt": "<ISO 8601>" | null, "endedAt": "<ISO 8601>" },
  "proxyError": "<message>",
  "isClientAborted": true
}
```

- `query` is the query string without its `?`, empty when there was none.
- `headers` are the request headers as Claude Code sent them, redacted (§4).
- **Stored body** — one of:
  - `null`: no body;
  - `{ "text": "…" }`: a body that is not JSON;
  - `{ "json": <value> }`: JSON that is not an object;
  - `{ "parameters": {…}, "system": "<hash>" | ["<hash>", …], "tools": ["<hash>", …], "messages": ["<hash>", …] }`:
    a JSON object. `system`, `tools` and `messages` are replaced by the hashes
    of their pieces, in order, when they are a string or an array (only
    `system` may be a string); each is absent when the request had none.
    `parameters` is every other field (`model`, `max_tokens`, `thinking`,
    `metadata`, …), as sent but redacted. Restoring the body is
    `{ ...parameters, system, tools, messages }` with each hash replaced by its
    piece's `content`.
- `response.body` is not deduplicated:
  - for an event stream (`isStreamed: true`), the **reassembled message**, in
    the shape of a non-streamed Messages response. Text, thinking and signature
    deltas are concatenated into their block; an `input_json_delta` block's
    JSON is parsed at `content_block_stop`; `message_delta` merges in
    `stop_reason`, `stop_sequence` and `usage`, deep-merged so the
    `cache_creation` 5m/1h split survives. The raw event stream is not kept. An
    `error` event mid-stream is kept as the message's `error`;
  - for any other response, the parsed JSON, the text of a body that is not
    JSON, or `null` for an empty one.
- `response.requestId` is the `request-id` response header.
- `timings`: `arrivedAt` when the request reached the Recorder, `firstByteAt`
  when the first byte of the upstream response came back (null if none did),
  `endedAt` when the response ended or failed.
- `proxyError` (present only then): the upstream could not be reached; the
  Recorder answered `502` with
  `{"type":"error","error":{"type":"proxy_error","message":"…"}}`, which is
  `response.body`.
- `isClientAborted` (present only then): Claude Code disconnected before the
  response ended; the upstream request was aborted and `response.body` holds
  what was reassembled so far.

## 4. Redaction

Applied by the writer before anything is serialized, so no caller can write a
secret:

- the `authorization`, `x-api-key`, `cookie` and `set-cookie` headers (request
  and response) are stored as `"<redacted>"` (each value, for a list);
- `body.metadata.user_id` keeps only its session id:
  - JSON shape — `{"device_id":"…","account_uuid":"…","session_id":"…"}` — every
    field but `session_id` becomes `"<redacted>"`;
  - legacy shape — `user_<device>_account_<account>_session_<id>` — becomes
    `user_<redacted>_account_<redacted>_session_<id>`;
  - any other shape is stored as `"<redacted>"`.

The device id goes with the account: a Recording is a file a user may share,
and nothing downstream needs either.
