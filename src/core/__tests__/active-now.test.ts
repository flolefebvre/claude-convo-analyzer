// Active now (GLOSSARY.md, under Live): a Conversation whose newest source
// change is under two minutes old, at a given "now".

import { describe, expect, it } from "vitest";

import { ACTIVE_WINDOW_MS, isActiveNow } from "@/core/live";

const CHANGED_AT = "2026-10-20T10:00:00.000Z";
const changedMs = Date.parse(CHANGED_AT);

describe("isActiveNow", () => {
  it("spans two minutes", () => {
    expect(ACTIVE_WINDOW_MS).toBe(2 * 60_000);
  });

  it("is active from the change until just under two minutes after it", () => {
    expect(isActiveNow(CHANGED_AT, new Date(changedMs))).toBe(true);
    expect(isActiveNow(CHANGED_AT, new Date(changedMs + ACTIVE_WINDOW_MS - 1))).toBe(true);
  });

  it("is no longer active two minutes after the change, or later", () => {
    expect(isActiveNow(CHANGED_AT, new Date(changedMs + ACTIVE_WINDOW_MS))).toBe(false);
    expect(isActiveNow(CHANGED_AT, new Date(changedMs + 60 * 60_000))).toBe(false);
  });
});
