import { describe, expect, it } from "vitest";

import type { ConversationFamily, FamilyMember } from "@/core/family";

import { familyView } from "@/app/_lib/family-view";

const NOW = new Date("2026-06-21T18:00:00.000Z");

function member(partial: Partial<FamilyMember> & { id: string }): FamilyMember {
  return {
    title: `Title of ${partial.id}`,
    project: { folder: "-home-dev-app", path: "/home/dev/app" },
    startedAt: "2026-06-21T09:00:00.000Z",
    costUsd: 1,
    unpriced: false,
    depth: 0,
    isCurrent: false,
    ...partial,
  };
}

function family(members: FamilyMember[]): ConversationFamily {
  const current = members.find((m) => m.isCurrent) ?? members[0];
  return {
    sessionId: current.id,
    members,
    size: members.length,
    totalCostUsd: members.reduce((sum, m) => sum + m.costUsd, 0),
    hasUnpriced: members.some((m) => m.unpriced),
    parent: null,
    children: [],
  };
}

const SORT = { sortBy: "date", dir: "desc" } as const;

describe("familyView", () => {
  it("keeps the core's order and depth, and links each member to its expanded row", () => {
    const view = familyView(
      family([
        member({ id: "a" }),
        member({ id: "b", depth: 1, isCurrent: true }),
      ]),
      { sort: SORT },
      NOW,
    );

    expect(view.rows.map((r) => [r.id, r.depth])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
    expect(view.rows.map((r) => r.isCurrent)).toEqual([false, true]);
    // Even the member whose panel this is links to itself EXPANDED, never to a
    // collapse — the link is navigation, not the row's toggle.
    for (const row of view.rows) {
      expect(row.href).toContain(`expanded=${row.id}`);
    }
    expect(view.size).toBe(2);
    expect(view.totalCostUsd).toBe(2);
    expect(view.hasUnpriced).toBe(false);
  });

  it("labels only the members that live in another Project", () => {
    const view = familyView(
      family([
        member({ id: "a", isCurrent: true }),
        member({
          id: "b",
          project: { folder: "-home-dev-app-wt", path: "/home/dev/app-wt" },
        }),
      ]),
      { sort: SORT },
      NOW,
    );

    expect(view.rows[0].projectLabel).toBeNull();
    expect(view.rows[1].projectLabel).toBe("app-wt");
  });

  it("drops the folder scope for a member the scope would hide", () => {
    const view = familyView(
      family([
        member({ id: "a", isCurrent: true }),
        member({
          id: "b",
          project: { folder: "-home-dev-app-wt", path: "/home/dev/app-wt" },
        }),
      ]),
      { sort: SORT, folder: "-home-dev-app", range: "30" },
      NOW,
    );

    // The in-scope member keeps the active scope…
    expect(view.rows[0].href).toContain("folder=-home-dev-app");
    // …the cross-project one drops it, so the click can actually reach the row.
    expect(view.rows[1].href).not.toContain("folder=");
    // The Trends range is preserved either way.
    for (const row of view.rows) expect(row.href).toContain("range=30");
  });

  it("drops the errors filter, which could hide a member that never failed", () => {
    const view = familyView(
      family([member({ id: "a", isCurrent: true }), member({ id: "b" })]),
      { sort: SORT, errorsOnly: true, range: "30" },
      NOW,
    );

    for (const row of view.rows) {
      expect(row.href).not.toContain("errors=");
      // Everything else the user chose still travels with the link.
      expect(row.href).toContain("range=30");
    }
  });

  it("carries the lower-bound flag when any member is unpriced", () => {
    const view = familyView(
      family([
        member({ id: "a", isCurrent: true }),
        member({ id: "b", unpriced: true, costUsd: 2 }),
      ]),
      { sort: SORT },
      NOW,
    );

    expect(view.hasUnpriced).toBe(true);
    expect(view.totalCostUsd).toBe(3);
    expect(view.rows.map((r) => r.unpriced)).toEqual([false, true]);
  });
});
