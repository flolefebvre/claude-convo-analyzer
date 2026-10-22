import path from "node:path";
import { describe, expect, it } from "vitest";

import { TRANSCRIPT_PAGE_SIZE, getTranscript } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

// `sess-pages` renders eight messages, in this order: two undated prompts
// (null timestamps sort first), then pa1 · pu1 · pa2 · pa3 · pu2 · pa4, where
// pa3 and pu2 share one timestamp. Tool-result carriers and one meta record
// are hidden. With three messages a page that is three Transcript pages:
//   1: pu0 pu00 pa1 | 2: pu1 pa2 pa3 | 3: pu2 pa4
const LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "page-logs");
const SESSION = "sess-pages";
const PAGE_SIZE = 3;

describe("getTranscript — Transcript pages", () => {
  const db = seededTempDb({ prefix: "cca-transcript-page-", logsRoot: LOGS_ROOT });

  const read = (
    opts: { page?: number | "all"; anchoredMessage?: string; anchoredCall?: string; pageSize?: number } = {},
  ) => getTranscript(SESSION, { dbPath: db.dbPath, pageSize: PAGE_SIZE, ...opts });

  const uuids = (view: Awaited<ReturnType<typeof read>>) => view?.messages.map((m) => m.uuid);

  it("pages by TRANSCRIPT_PAGE_SIZE when no page size is given", async () => {
    const view = await getTranscript(SESSION, { dbPath: db.dbPath });
    expect(view?.pageSize).toBe(TRANSCRIPT_PAGE_SIZE);
    expect(TRANSCRIPT_PAGE_SIZE).toBe(200);
    expect(view?.page).toBe(1);
    expect(view?.pageCount).toBe(1);
    expect(view?.messages).toHaveLength(8);
  });

  it("opens on the first page, undated messages first", async () => {
    const view = await read();
    expect(view?.page).toBe(1);
    expect(view?.pageCount).toBe(3);
    expect(view?.pageSize).toBe(PAGE_SIZE);
    expect(uuids(view)).toEqual(["pu0", "pu00", "pa1"]);
  });

  it("reads the whole transcript as its one page when asked for all of it", async () => {
    const view = await read({ page: "all" });
    expect(uuids(view)).toEqual(["pu0", "pu00", "pa1", "pu1", "pa2", "pa3", "pu2", "pa4"]);
    expect(view?.page).toBe(1);
    expect(view?.pageCount).toBe(1);
    expect(view?.pageSize).toBe(8);
    expect(view?.messageCount).toBe(8);
  });

  it("windows the requested page, and the last page holds the remainder", async () => {
    expect(uuids(await read({ page: 2 }))).toEqual(["pu1", "pa2", "pa3"]);
    expect(uuids(await read({ page: 3 }))).toEqual(["pu2", "pa4"]);
  });

  it("clamps a page below 1 to the first page", async () => {
    for (const page of [0, -4]) {
      const view = await read({ page });
      expect(view?.page).toBe(1);
      expect(uuids(view)).toEqual(["pu0", "pu00", "pa1"]);
    }
  });

  it("clamps a page past the end to the last page", async () => {
    const view = await read({ page: 99 });
    expect(view?.page).toBe(3);
    expect(uuids(view)).toEqual(["pu2", "pa4"]);
  });

  it("describes the whole agent, not the page, on a non-first page", async () => {
    const view = await read({ page: 3 });
    expect(view?.messageCount).toBe(8);
    expect(view?.turnCount).toBe(4);
    expect(view?.toolCallCount).toBe(3);
    expect(view?.effortLevels).toEqual(["high", "xhigh"]);
    expect(view?.metaHiddenCount).toBe(1);
  });

  it("opens the page holding a ?msg= anchor when no page is asked for", async () => {
    // pa2 follows both undated prompts, which count as before it.
    expect((await read({ anchoredMessage: "pa2" }))?.page).toBe(2);
    // pu2 shares pa3's timestamp but was logged after it.
    const view = await read({ anchoredMessage: "pu2" });
    expect(view?.page).toBe(3);
    expect(uuids(view)).toEqual(["pu2", "pa4"]);
  });

  it("places an undated ?msg= anchor among the undated messages, by log order", async () => {
    expect((await read({ anchoredMessage: "pu00", pageSize: 1 }))?.page).toBe(2);
    expect((await read({ anchoredMessage: "pu0", pageSize: 1 }))?.page).toBe(1);
  });

  it("opens the page holding a ?call= anchor when no page is asked for", async () => {
    expect((await read({ anchoredCall: "toolu-pg-2" }))?.page).toBe(2);
    expect((await read({ anchoredCall: "toolu-pg-3" }))?.page).toBe(3);
  });

  it("opens the first page for an anchor the agent does not hold", async () => {
    expect((await read({ anchoredMessage: "no-such-uuid" }))?.page).toBe(1);
    expect((await read({ anchoredCall: "no-such-call" }))?.page).toBe(1);
    // A hidden tool-result carrier is not a rendered message.
    expect((await read({ anchoredMessage: "pr3" }))?.page).toBe(1);
  });

  it("lets an explicit page override an anchor", async () => {
    expect((await read({ page: 2, anchoredMessage: "pu2" }))?.page).toBe(2);
    expect((await read({ page: 1, anchoredCall: "toolu-pg-3" }))?.page).toBe(1);
  });

  it("carries the effort before the window, across a page boundary", async () => {
    expect((await read({ page: 1 }))?.effortBefore).toBeNull();
    // Page 2 follows pa1 (high); page 3 follows pa3 (no effort), so pa2's high.
    expect((await read({ page: 2 }))?.effortBefore).toBe("high");
    expect((await read({ page: 3 }))?.effortBefore).toBe("high");
  });
});
