// Render-ready shaping for the continuation-family section of the expanded
// detail panel (issue #46). Like its sibling `_lib` modules this is pure —
// React-free, I/O-free, only type-only core imports (ADR-0002) — so the link
// composition and the labeling rules unit-test in the node environment and the
// panel component stays a thin renderer.

import type { ConversationFamily } from "@/core/family";

import { formatDate } from "@/app/_lib/format";
import { friendlyFolderName } from "@/app/_lib/folders";
import { expandHref, type SortState } from "@/app/_lib/sort";

/** One family member, ready to render as a row of the panel's tree. */
export type FamilyViewRow = {
  /** The member's session id — the React key and the link target. */
  id: string;
  title: string | null;
  /** Indentation depth in the fork tree (0 = a root of the family). */
  depth: number;
  /** True for the conversation whose panel this is ("you are here"). */
  isCurrent: boolean;
  dateLabel: string;
  dateAbsolute: string;
  costUsd: number;
  unpriced: boolean;
  /**
   * The member's Project label when it differs from the current conversation's
   * (a cross-directory resume), else `null` — same rule the list uses to avoid
   * repeating a folder every row already shares.
   */
  projectLabel: string | null;
  /** Where clicking the member goes: that row, expanded, in the list. */
  href: string;
};

/** The panel's family section: its rows plus the family-wide total. */
export type FamilyView = {
  rows: FamilyViewRow[];
  size: number;
  totalCostUsd: number;
  /** True when a member has unpriced usage — the total is a lower bound. */
  hasUnpriced: boolean;
};

/** The list view-state a member link has to preserve. */
export type FamilyLinkContext = {
  sort: SortState;
  /** The active `?folder=` scope, or `undefined` for "All folders". */
  folder?: string;
  /** The active Trends range, carried verbatim like every other list link. */
  range?: string;
};

/**
 * Shape a {@link ConversationFamily} into the panel's tree rows.
 *
 * Order and depth come from the core walk (chronological, indented by fork), so
 * this only formats: relative dates against ONE request-time `now`, the
 * cross-project label, and each member's expand link. A member that lives in a
 * DIFFERENT Project than the active scope gets a link with the scope DROPPED —
 * otherwise the click would land on a filtered list that cannot show that row.
 */
export function familyView(
  family: ConversationFamily,
  ctx: FamilyLinkContext,
  now: Date = new Date(),
): FamilyView {
  const currentFolder = family.members.find((m) => m.isCurrent)?.project.folder;
  return {
    rows: family.members.map((member) => {
      const date = formatDate(member.startedAt, now);
      const inScope = ctx.folder === undefined || ctx.folder === member.project.folder;
      return {
        id: member.id,
        title: member.title,
        depth: member.depth,
        isCurrent: member.isCurrent,
        dateLabel: date.label,
        dateAbsolute: date.absolute,
        costUsd: member.costUsd,
        unpriced: member.unpriced,
        projectLabel:
          member.project.folder === currentFolder
            ? null
            : friendlyFolderName(member.project.path),
        href: expandHref(
          member.id,
          // Never a toggle: clicking a member always EXPANDS it, even the one
          // already open (whose panel this is).
          undefined,
          ctx.sort,
          inScope ? ctx.folder : undefined,
          ctx.range,
        ),
      };
    }),
    size: family.size,
    totalCostUsd: family.totalCostUsd,
    hasUnpriced: family.hasUnpriced,
  };
}
