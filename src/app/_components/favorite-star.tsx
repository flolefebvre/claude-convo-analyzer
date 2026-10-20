"use client";

// The Favorite star (GLOSSARY.md, **Favorite**): a toggle beside a Folder's
// name — in the sidebar beside its row's link, never inside it, and in the
// Folder breadcrumb. A click flips it at once and saves the choice through the
// `setFolderFavorite` server action (ADR-0002: no core import from a client
// file); success re-renders the page, so the Favorites section and every other
// star of the Folder follow, and a failure flips it back and says why.

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { type ControlBubbleProps, ControlFailure } from "@/app/_components/control-bubble";
import { SidebarLeadingSlot } from "@/app/_components/folder-rows";
import { SidebarLink } from "@/app/_components/sidebar-link";
import { setFolderFavorite } from "@/app/actions";
import { cn } from "@/lib/utils-cn";

/** The line shown when a favorite could not be saved; the failure's own message is its detail. */
const FAILURE_TEXT = "The favorite could not be saved. Hover for the reason, then try again.";

/**
 * A sidebar entry selecting the Folder at `folderPath`: its `leading` control
 * (a tree row's chevron, a favorite's reorder grip, or nothing) in the
 * {@link SidebarLeadingSlot}, then the link with its cost-share bar, then its
 * star in a gutter the link keeps free, so the star never covers the cost.
 *
 * @example
 * <FolderLinkWithStar folderPath={node.path} folderLabel={node.label} isFavorite={favoritePaths.has(node.path)} costShare={0.25} leading={chevron}>
 *   <FolderRow label={node.label} totals={node} />
 * </FolderLinkWithStar>
 */
export function FolderLinkWithStar({
  folderPath,
  folderLabel,
  isFavorite,
  costShare,
  leading,
  className,
  children,
}: Omit<FavoriteStarProps, "isRevealedByRow" | "failureAlignedEdge"> & {
  /** The Folder's share of the total spend, in `[0, 1]`. */
  costShare: number;
  leading?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("group/row relative flex min-w-0 items-center", className)}>
      <SidebarLeadingSlot>{leading}</SidebarLeadingSlot>
      <SidebarLink
        scope={{ folder: folderPath }}
        costShare={costShare}
        title={folderPath}
        className="min-w-0 flex-1 pr-9"
      >
        {children}
      </SidebarLink>
      <FavoriteStar
        folderPath={folderPath}
        folderLabel={folderLabel}
        isFavorite={isFavorite}
        isRevealedByRow
        failureAlignedEdge="leftFromLg"
        className="absolute top-1/2 right-1 -translate-y-1/2"
      />
    </div>
  );
}

/** The props of {@link FavoriteStar}. */
export type FavoriteStarProps = {
  /** The Folder's absolute path. */
  folderPath: string;
  /** The Folder's name, as its row or the breadcrumb shows it. */
  folderLabel: string;
  /** Whether the Folder is a favorite, as the server part read it. */
  isFavorite: boolean;
  /**
   * Whether an empty star shows only while its row (the nearest `group/row`)
   * is hovered or holds the focus, on a device with a fine pointer; a filled
   * star always shows.
   */
  isRevealedByRow?: boolean;
  /** The star's edge its failure bubble lines up with, as {@link ControlBubbleProps} `alignedEdge` reads it. */
  failureAlignedEdge?: ControlBubbleProps["alignedEdge"];
  className?: string;
};

/**
 * The star that favorites or unfavorites a Folder.
 *
 * @example <FavoriteStar folderPath={node.path} folderLabel={node.label} isFavorite={favoritePaths.has(node.path)} isRevealedByRow />
 */
export function FavoriteStar({
  folderPath,
  folderLabel,
  isFavorite: isFavoriteAsRendered,
  isRevealedByRow = false,
  failureAlignedEdge = "right",
  className,
}: FavoriteStarProps) {
  const router = useRouter();
  const [isFavorite, setIsFavorite] = useState(isFavoriteAsRendered);
  // A re-render of the server part (after any star of this Folder was
  // clicked) is the choice as it stands now.
  const [seenIsFavorite, setSeenIsFavorite] = useState(isFavoriteAsRendered);
  if (seenIsFavorite !== isFavoriteAsRendered) {
    setSeenIsFavorite(isFavoriteAsRendered);
    setIsFavorite(isFavoriteAsRendered);
  }
  const [isSavePending, setIsSavePending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleClick() {
    if (isSavePending) return;
    const wasFavorite = isFavorite;
    setFailure(null);
    setIsFavorite(!wasFavorite);
    setIsSavePending(true);
    try {
      const result = await setFolderFavorite({ path: folderPath, isFavorite: !wasFavorite });
      if (result.status === "success") {
        router.refresh();
      } else {
        setIsFavorite(wasFavorite);
        setFailure(result.error.type === "favoriteNotSaved" ? result.error.data.message : "The change was refused.");
      }
    } catch (cause) {
      setIsFavorite(wasFavorite);
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSavePending(false);
    }
  }

  return (
    <div className={cn("relative flex", className)}>
      <button
        type="button"
        onClick={handleClick}
        // Not `disabled`: that would throw a keyboard user's focus to <body>
        // mid-save, and with it the row's focus that keeps the star shown.
        aria-disabled={isSavePending}
        aria-pressed={isFavorite}
        aria-label={`Favorite ${folderLabel}`}
        title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-muted focus-visible:opacity-100",
          isFavorite ? "text-cost" : "text-muted-foreground hover:text-foreground",
          // A device that cannot hover always shows it: never an invisible target under a finger.
          isRevealedByRow &&
            !isFavorite &&
            "opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100",
        )}
      >
        <Star className={cn("size-3.5", isFavorite && "fill-current")} aria-hidden />
      </button>
      <ControlFailure
        text={FAILURE_TEXT}
        failure={failure}
        onDismiss={() => setFailure(null)}
        alignedEdge={failureAlignedEdge}
      />
    </div>
  );
}
