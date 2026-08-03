# TDD — effort level in the Transcript view

## Slice 1 — parse + persist

- [ ] an assistant record's top-level `effort` lands on `ParsedMessage.effort`
- [ ] an assistant record without `effort` parses to `effort: null`
- [ ] a user record always parses to `effort: null`
- [ ] a turn split across content-block lines takes effort from the FIRST line
- [ ] an unknown future value (`low`) passes through unchanged
- [ ] refresh persists `effort` on the message row (fixture with and without)
- [ ] a sub-agent transcript's effort is persisted too
- [ ] PARSER_VERSION bumped so ingested conversations re-parse

## Slice 2 — read model

- [ ] `getTranscript` exposes `effort` on each assistant `TranscriptMessage`
- [ ] absent effort surfaces as null
- [ ] sub-agent transcript messages carry effort

## Slice 3 — `_lib/transcript.ts` classification

- [ ] all turns carry the same effort → that value
- [ ] uniform value mixed with nulls → still that value
- [ ] two distinct values → "mixed"
- [ ] all null / empty → null
- [ ] unknown future value (`low`, `max`) flows through unchanged
- [ ] change markers: only the turn differing from the previous effort-carrying turn
- [ ] no marker on the first effort-carrying turn
- [ ] nulls between two same-value turns produce no marker

## Slice 4 — UI

- [ ] header stat renders `<value> effort` / `mixed effort` / nothing
- [ ] badge renders on flipped turns only
