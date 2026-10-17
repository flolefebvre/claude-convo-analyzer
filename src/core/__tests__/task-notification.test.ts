import { describe, expect, it } from "vitest";

import { mainSession, messageByUuid, parseLine } from "./helpers/agent-messages";

/**
 * A Task notification (`origin.kind: task-notification`) announces that a
 * background task or Sub-agent stopped. Its status, summary and task id are
 * lifted out of the `<task-notification>` XML; its `text` is the `<result>`
 * (falling back to a Monitor `<event>`), entity-decoded.
 */
describe("Task notification parsing", () => {
  const main = mainSession();

  it("lifts a finished sub-agent's task id, status, summary and decoded result", () => {
    const m = messageByUuid(main, "n1");
    expect(m.kind).toBe("task-notification");
    expect(m.origin).toEqual({ taskId: "a1f00d", taskStatus: "completed", taskSummary: 'Agent "refactor" finished' });
    expect(m.text).toBe("Refactored `parse.ts`: <T> generics & tests.");
  });

  it.each([
    ["n2", "bfail1", "failed", 'Background command "pnpm build" failed with exit code 1'],
    ["n5", "bkill1", "killed", 'Background command "pnpm dev" was killed'],
    ["n6", "a1f00d", "stopped", 'Agent "refactor" was stopped'],
  ])("reads the %s notification's %s status %s", (uuid, taskId, taskStatus, taskSummary) => {
    const m = messageByUuid(main, uuid);
    expect(m.kind).toBe("task-notification");
    expect(m.origin).toEqual({ taskId, taskStatus, taskSummary });
    expect(m.text).toBeNull();
  });

  it("uses a Monitor event as the body when there is no result", () => {
    const m = messageByUuid(main, "n3");
    expect(m.origin).toEqual({ taskId: "bmon1", taskSummary: 'Monitor event: "gate steps"' });
    expect(m.text).toBe("▶ build");
  });

  it("takes the whole text as the summary of a notification without XML", () => {
    const m = messageByUuid(main, "n4");
    expect(m.kind).toBe("task-notification");
    expect(m.origin).toEqual({ taskSummary: 'Background agent "refactor" was stopped by the user.' });
    expect(m.text).toBeNull();
  });

  it("never seeds the title fallback, which falls to the first Prompt", () => {
    expect(main.title).toBe("Coordinate the parser refactor");
  });

  it("degrades a notification without readable content to a bare row", () => {
    const { messages } = parseLine({
      type: "user",
      uuid: "nx",
      origin: { kind: "task-notification" },
      message: { role: "user", content: [{ type: "image" }] },
    });
    expect(messages[0]?.kind).toBe("task-notification");
    expect(messages[0]?.origin).toBeNull();
    expect(messages[0]?.text).toBeNull();
  });
});
