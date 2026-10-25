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

  it("numbers each Turn across the Agent's whole Transcript, so the last Turn's number is its turn count", async () => {
    const turnNumbers = (view: Awaited<ReturnType<typeof read>>) => view?.messages.map((m) => m.turnNumber);
    expect(turnNumbers(await read({ page: 1 }))).toEqual([null, null, 1]);
    expect(turnNumbers(await read({ page: 2 }))).toEqual([null, 2, 3]);
    const last = await read({ page: 3 });
    expect(turnNumbers(last)).toEqual([null, 4]);
    expect(last?.messages.at(-1)?.turnNumber).toBe(last?.turnCount);
    expect(turnNumbers(await read({ page: "all" }))).toEqual([null, null, 1, null, 2, 3, null, 4]);
  });

  it("describes a Reply split across pages whole, on both pages, a Tool-result carrier inside it", async () => {
    // At five a page, the Reply pa2 · pa3 (pr2 between them) ends page 1 and opens page 2.
    const whole = await read({ page: "all" });
    const costOf = (uuid: string) => whole?.messages.find((m) => m.uuid === uuid)?.costUsd ?? Number.NaN;
    const reply = {
      turnCount: 2,
      toolCallCount: 1,
      startedAt: "2026-06-22T09:00:20.000Z",
      endedAt: "2026-06-22T09:00:40.000Z",
      costUsd: costOf("pa2") + costOf("pa3"),
      unpriced: false,
      copiedTurnCount: 0,
    };

    const first = await read({ page: 1, pageSize: 5 });
    expect(uuids(first)).toEqual(["pu0", "pu00", "pa1", "pu1", "pa2"]);
    expect(first?.openingReply).toBeNull();
    expect(first?.closingReply).toEqual(reply);

    const second = await read({ page: 2, pageSize: 5 });
    expect(uuids(second)).toEqual(["pa3", "pu2", "pa4"]);
    expect(second?.openingReply).toEqual(reply);
    expect(second?.closingReply).toBeNull();
  });

  it("names no split Reply where a page boundary falls between a Reply and a Message addressed to the Agent", async () => {
    // At two a page: pu0 pu00 | pa1 pu1 | pa2 pa3 | pu2 pa4.
    for (const page of [1, 2, 3, 4]) {
      const view = await read({ page, pageSize: 2 });
      expect(view?.openingReply).toBeNull();
      expect(view?.closingReply).toBeNull();
    }
  });
});

describe("getTranscript — Replies of undated Turns", () => {
  // `sess-undated-turns` renders uu0 · ua1 · ua2 · ua3 · uu1 · ua4: the prompt
  // and the first two Turns are undated (they sort first, by log order), ua3 is
  // the first dated one, and ur1, a Tool-result carrier, is hidden.
  const db = seededTempDb({ prefix: "cca-transcript-undated-", logsRoot: LOGS_ROOT });
  const read = (opts: { page?: number | "all"; pageSize?: number } = {}) =>
    getTranscript("sess-undated-turns", { dbPath: db.dbPath, ...opts });

  it("numbers undated Turns by their place in the Transcript", async () => {
    const view = await read({ page: "all" });
    expect(view?.messages.map((m) => [m.uuid, m.turnNumber])).toEqual([
      ["uu0", null],
      ["ua1", 1],
      ["ua2", 2],
      ["ua3", 3],
      ["uu1", null],
      ["ua4", 4],
    ]);
    expect(view?.turnCount).toBe(4);
  });

  it("bounds a split Reply's time range by its dated Turns only", async () => {
    const view = await read({ page: 1, pageSize: 2 });
    expect(view?.closingReply).toMatchObject({
      turnCount: 3,
      toolCallCount: 1,
      startedAt: "2026-06-22T10:00:05.000Z",
      endedAt: "2026-06-22T10:00:05.000Z",
    });
    const second = await read({ page: 2, pageSize: 2 });
    expect(second?.messages.map((m) => m.turnNumber)).toEqual([2, 3]);
    expect(second?.openingReply).toEqual(view?.closingReply);
  });

  it("describes a page lying wholly inside one Reply by that Reply, as it opens and as it closes", async () => {
    // At one a page, page 3 is ua2 alone, inside the Reply ua1 · ua2 · ua3.
    const view = await read({ page: 3, pageSize: 1 });
    expect(view?.messages.map((m) => m.uuid)).toEqual(["ua2"]);
    expect(view?.openingReply?.turnCount).toBe(3);
    expect(view?.closingReply).toEqual(view?.openingReply);
  });
});

describe("getTranscript — a split Reply partly copied", () => {
  // fork-a opens on its spawner's Prompt and three Turns it copies (the last,
  // its spawning Turn, re-written), then runs three of its own: one Reply.
  const db = seededTempDb({
    prefix: "cca-transcript-copied-reply-",
    logsRoot: path.join(import.meta.dirname, "fixtures", "forked-agent-logs"),
  });

  it("counts the copied Turns of the whole Reply, and only its own Turns' cost", async () => {
    const read = (page: number | "all") =>
      getTranscript("sess-forks", { dbPath: db.dbPath, agentId: "fork-a", page, pageSize: 2 });
    const whole = await read("all");
    const ownCost = whole?.messages.reduce((total, m) => total + m.costUsd, 0);

    const first = await read(1);
    expect(first?.messages.map((m) => m.uuid)).toEqual(["lead-u1", "lead-a1"]);
    expect(first?.closingReply).toMatchObject({ turnCount: 6, copiedTurnCount: 3, costUsd: ownCost });
  });
});
