import { describe, expect, it } from "vitest";

import { deriveFavoriteFolders } from "@/app/_lib/favorites";
import { deriveFolders } from "@/app/_lib/folders";

import { summary } from "./helpers/summaries";

/** The home directory the folder tree labels `~`. */
const HOME = "/home/me";

describe("deriveFavoriteFolders", () => {
  it("labels the favorited home directory `~`, as the folder tree does", () => {
    const folders = deriveFolders([summary({ id: "a", path: "/home/me/dev/api" })]);

    expect(
      deriveFavoriteFolders([HOME, "/home/me/dev"], folders, HOME)
        .map((f) => f.label)
        .sort(),
    ).toEqual(["dev", "~"]);
  });

  it("labels Windows favorites — a Windows home `~`, a drive by its letter — and sums the Projects below them", () => {
    const folders = deriveFolders([
      summary({ id: "a", path: "C:\\Users\\me\\repo", costUsd: 2 }),
      summary({ id: "b", path: "C:\\Users\\meta\\x", costUsd: 3 }),
    ]);

    expect(
      deriveFavoriteFolders(["C:\\Users\\me", "C:\\"], folders, "C:\\Users\\me").map((f) => [f.label, f.costUsd]),
    ).toEqual([
      ["~", 2],
      ["C:", 5],
    ]);
  });

  it("sums every Project at or below a favorite into its totals", () => {
    const folders = deriveFolders([
      summary({ id: "a", path: "/home/me/dev/api", costUsd: 2 }),
      summary({ id: "b", path: "/home/me/dev/api/.claude/worktrees/spike", costUsd: 3, unpriced: true }),
      summary({ id: "c", path: "/home/me/dev/apiary", costUsd: 7 }),
    ]);

    expect(deriveFavoriteFolders(["/home/me/dev/api"], folders, HOME)).toEqual([
      {
        path: "/home/me/dev/api",
        label: "api",
        count: 2,
        costUsd: 5,
        unpriced: true,
      },
    ]);
  });

  it("shows a favorite that is no tree row of its own, inside a compacted chain", () => {
    // `/home/me/dev` holds one sub-Folder only, so the tree compacts it into `dev/mylibs`.
    const folders = deriveFolders([summary({ id: "a", path: "/home/me/dev/mylibs/ui" })]);

    expect(deriveFavoriteFolders(["/home/me/dev"], folders, HOME).map((favorite) => favorite.count)).toEqual([1]);
  });

  it("hides a favorite with no Conversations at or below it", () => {
    const folders = deriveFolders([summary({ id: "a", path: "/home/me/dev/api" })]);

    expect(deriveFavoriteFolders(["/home/me/dev/gone", "/home/me/dev/api"], folders, HOME).map((f) => f.path)).toEqual([
      "/home/me/dev/api",
    ]);
  });

  it("keeps the favorited order, whatever the activity", () => {
    const folders = deriveFolders([
      summary({ id: "a", path: "/home/me/dev/old", endedAt: "2026-01-01T00:00:00.000Z" }),
      summary({ id: "b", path: "/home/me/dev/new", endedAt: "2026-03-01T00:00:00.000Z" }),
    ]);

    expect(deriveFavoriteFolders(["/home/me/dev/old", "/home/me/dev/new"], folders, HOME).map((f) => f.label)).toEqual([
      "old",
      "new",
    ]);
  });

  it("widens colliding labels to the minimal path suffix among the favorites only", () => {
    const folders = deriveFolders([
      summary({ id: "a", path: "/home/me/dev/app" }),
      summary({ id: "b", path: "/home/me/tmp/app" }),
      summary({ id: "c", path: "/home/me/old/app" }),
    ]);

    expect(
      deriveFavoriteFolders(["/home/me/dev/app", "/home/me/tmp/app"], folders, HOME)
        .map((f) => f.label)
        .sort(),
    ).toEqual(["dev/app", "tmp/app"]);
    expect(deriveFavoriteFolders(["/home/me/dev/app"], folders, HOME).map((f) => f.label)).toEqual(["app"]);
  });
});
