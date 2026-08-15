import type { ConversationFamily } from "@/core/family";

import { formatDate } from "@/app/_lib/format";
import { friendlyFolderName } from "@/app/_lib/folders";
import { expandHref, type ListLinkContext } from "@/app/_lib/sort";

export type FamilyViewRow = {
  id: string;
  title: string | null;
  depth: number;
  isCurrent: boolean;
  dateLabel: string;
  dateAbsolute: string;
  costUsd: number;
  unpriced: boolean;
  projectLabel: string | null;
  href: string;
};

export type FamilyView = {
  rows: FamilyViewRow[];
  size: number;
  totalCostUsd: number;
  hasUnpriced: boolean;
};

export type FamilyLinkContext = ListLinkContext;

export function familyView(family: ConversationFamily, ctx: FamilyLinkContext, now: Date = new Date()): FamilyView {
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
        projectLabel: member.project.folder === currentFolder ? null : friendlyFolderName(member.project.path),
        href: expandHref(member.id, undefined, {
          ...ctx,
          folder: inScope ? ctx.folder : undefined,
          errorsOnly: false,
        }),
      };
    }),
    size: family.size,
    totalCostUsd: family.totalCostUsd,
    hasUnpriced: family.hasUnpriced,
  };
}
