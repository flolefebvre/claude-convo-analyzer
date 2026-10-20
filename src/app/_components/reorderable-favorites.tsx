"use client";

// The Favorites section's rows, reorderable by hand (GLOSSARY.md, **Favorite**).
// Each row carries a grip beside its star: drag it (mouse, pen or finger — one
// Pointer Events path), or press Alt+↑/Alt+↓ on it. The list follows the
// pointer at once, and a move is saved through the `moveFavorite` server
// action (ADR-0002: no core import from a client file) as "before this
// neighbour", so the favorites the section hides keep their places. Success
// re-renders the page, so the other rendering of the section (desktop sidebar
// or phone picker) follows; a failure puts the rows back and says why.

import { GripVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ControlFailure } from "@/app/_components/control-bubble";
import { FolderLinkWithStar } from "@/app/_components/favorite-star";
import { FolderRow } from "@/app/_components/folder-rows";
import { moveFavorite } from "@/app/actions";
import { dropIndexForPointer, type FavoriteMove, moveFavoriteToIndex } from "@/app/_lib/favorite-order";
import type { FavoriteFolder } from "@/app/_lib/favorites";
import { cn } from "@/lib/utils-cn";

/** The line shown when a move could not be saved; the failure's own message is its detail. */
const FAILURE_TEXT = "The new order could not be saved. Hover for the reason, then try again.";

/** How far, in CSS pixels, the pointer travels on a grip before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

/** A press on a grip, from `pointerdown` until it is released or cancelled. */
type GripPress = {
  movedPath: string;
  pointerId: number;
  startY: number;
  /** Whether the pointer has travelled past {@link DRAG_THRESHOLD_PX}: a tap moves nothing. */
  isDragging: boolean;
  /** The order when the press began: what a cancel restores, and what the move is saved against. */
  orderAtPress: string[];
};

/**
 * The favorites, in the user's order, each a Folder row with its star and its
 * reorder grip.
 *
 * @example <ReorderableFavorites favorites={favorites} totalCostUsd={totals.costUsd} labelledBy={headingId} />
 */
export function ReorderableFavorites({
  favorites,
  totalCostUsd,
  labelledBy,
}: {
  /** The Favorites section's rows, in the order the server part read. */
  favorites: FavoriteFolder[];
  /** The spend across every Project, which every bar is a share of. */
  totalCostUsd: number;
  /** The id of the heading naming the list. */
  labelledBy: string;
}) {
  const router = useRouter();
  const orderAsRendered = favorites.map((favorite) => favorite.path);
  const [order, setOrder] = useState(orderAsRendered);
  // A re-render of the server part (after a move here or in the other
  // rendering of the section, or a star click) is the order as it stands now.
  const orderKeyAsRendered = orderAsRendered.join("\n");
  const [seenOrderKey, setSeenOrderKey] = useState(orderKeyAsRendered);
  if (seenOrderKey !== orderKeyAsRendered) {
    setSeenOrderKey(orderKeyAsRendered);
    setOrder(orderAsRendered);
  }
  const [isSavePending, setIsSavePending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [draggedPath, setDraggedPath] = useState<string | null>(null);

  const listRef = useRef<HTMLUListElement>(null);
  const rowByPath = useRef(new Map<string, HTMLLIElement>());
  const gripByPath = useRef(new Map<string, HTMLButtonElement>());
  const gripPress = useRef<GripPress | null>(null);
  // The grip a keyboard move came from: React may move its row's node, which drops the focus.
  const pathToRefocus = useRef<string | null>(null);

  useLayoutEffect(() => {
    const grip = pathToRefocus.current === null ? undefined : gripByPath.current.get(pathToRefocus.current);
    pathToRefocus.current = null;
    if (grip && document.activeElement !== grip) grip.focus();
  }, [order]);

  const favoriteByPath = new Map(favorites.map((favorite) => [favorite.path, favorite]));
  const shownFavorites = order.flatMap((favoritePath) => favoriteByPath.get(favoritePath) ?? []);

  async function saveMove(movedPath: string, move: FavoriteMove, orderBefore: string[], isKeyboardMove: boolean) {
    const label = favoriteByPath.get(movedPath)?.label ?? movedPath;
    if (isKeyboardMove) pathToRefocus.current = movedPath;
    setOrder(move.order);
    setFailure(null);
    setAnnouncement(`${label} moved to position ${move.order.indexOf(movedPath) + 1} of ${move.order.length}`);
    setIsSavePending(true);
    let failureMessage: string | null = null;
    try {
      const result = await moveFavorite({ path: movedPath, before: move.before });
      if (result.status === "success") router.refresh();
      else
        failureMessage = result.error.type === "favoriteNotMoved" ? result.error.data.message : "The move was refused.";
    } catch (cause) {
      failureMessage = cause instanceof Error ? cause.message : String(cause);
    } finally {
      setIsSavePending(false);
    }
    if (failureMessage !== null) {
      if (isKeyboardMove) pathToRefocus.current = movedPath;
      setOrder(orderBefore);
      setAnnouncement("");
      setFailure(failureMessage);
    }
  }

  function handleGripKeyDown(event: React.KeyboardEvent, movedPath: string) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    if (isSavePending || gripPress.current !== null) return;
    const fromIndex = order.indexOf(movedPath);
    const toIndex = fromIndex + (event.key === "ArrowUp" ? -1 : 1);
    if (toIndex < 0 || toIndex >= order.length) return;
    void saveMove(movedPath, moveFavoriteToIndex(order, movedPath, toIndex), order, true);
  }

  function handleGripPointerDown(event: React.PointerEvent, movedPath: string) {
    if (isSavePending || gripPress.current !== null || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Captured by the list, not the grip: the list's node never moves while
    // its rows are reordered under the pointer, so the capture holds.
    listRef.current?.setPointerCapture(event.pointerId);
    gripPress.current = {
      movedPath,
      pointerId: event.pointerId,
      startY: event.clientY,
      isDragging: false,
      orderAtPress: order,
    };
  }

  function handleListPointerMove(event: React.PointerEvent) {
    const press = gripPress.current;
    if (press === null || event.pointerId !== press.pointerId) return;
    if (!press.isDragging) {
      if (Math.abs(event.clientY - press.startY) < DRAG_THRESHOLD_PX) return;
      press.isDragging = true;
      setDraggedPath(press.movedPath);
    }
    const otherRowBoxes = order
      .filter((favoritePath) => favoritePath !== press.movedPath)
      .flatMap((favoritePath) => rowByPath.current.get(favoritePath)?.getBoundingClientRect() ?? []);
    const toIndex = dropIndexForPointer(otherRowBoxes, event.clientY);
    if (order.indexOf(press.movedPath) !== toIndex)
      setOrder(moveFavoriteToIndex(order, press.movedPath, toIndex).order);
  }

  function handleListPointerUp(event: React.PointerEvent) {
    const press = gripPress.current;
    if (press === null || event.pointerId !== press.pointerId) return;
    endPress();
    const toIndex = order.indexOf(press.movedPath);
    if (!press.isDragging || press.orderAtPress.indexOf(press.movedPath) === toIndex) return;
    void saveMove(
      press.movedPath,
      moveFavoriteToIndex(press.orderAtPress, press.movedPath, toIndex),
      press.orderAtPress,
      false,
    );
  }

  /** Put the rows back where the press found them. */
  function cancelPress() {
    const press = gripPress.current;
    if (press === null) return;
    endPress();
    setOrder(press.orderAtPress);
  }

  function endPress() {
    const press = gripPress.current;
    gripPress.current = null;
    setDraggedPath(null);
    if (press && listRef.current?.hasPointerCapture(press.pointerId)) {
      listRef.current.releasePointerCapture(press.pointerId);
    }
  }

  // Escape cancels a drag wherever the focus is: a press does not focus the grip on every platform.
  const isDragging = draggedPath !== null;
  useEffect(() => {
    if (!isDragging) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelPress();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div className="relative">
      <ul
        ref={listRef}
        aria-labelledby={labelledBy}
        className={cn("flex flex-col gap-1", isDragging && "cursor-grabbing select-none")}
        onPointerMove={handleListPointerMove}
        onPointerUp={handleListPointerUp}
        onPointerCancel={cancelPress}
        onLostPointerCapture={cancelPress}
      >
        {shownFavorites.map((favorite) => (
          <li
            key={favorite.path}
            ref={(row) => {
              if (row) rowByPath.current.set(favorite.path, row);
              else rowByPath.current.delete(favorite.path);
            }}
            className={cn(
              "rounded-md transition-shadow",
              draggedPath === favorite.path && "bg-muted/60 shadow-sm ring-1 ring-border",
            )}
          >
            <FolderLinkWithStar
              folderPath={favorite.path}
              folderLabel={favorite.label}
              isFavorite
              grip={
                <button
                  type="button"
                  ref={(grip) => {
                    if (grip) gripByPath.current.set(favorite.path, grip);
                    else gripByPath.current.delete(favorite.path);
                  }}
                  onKeyDown={(event) => handleGripKeyDown(event, favorite.path)}
                  onPointerDown={(event) => handleGripPointerDown(event, favorite.path)}
                  // Not `disabled`: that would throw a keyboard user's focus to <body> mid-save.
                  aria-disabled={isSavePending}
                  aria-label={`Reorder ${favorite.label}`}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  title="Drag to reorder, or press Alt+↑ / Alt+↓"
                  className={cn(
                    "grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:opacity-100",
                    // A device that cannot hover always shows it: never an invisible target under a finger.
                    draggedPath === favorite.path
                      ? "cursor-grabbing text-foreground"
                      : "opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100",
                  )}
                >
                  <GripVertical className="size-3.5" aria-hidden />
                </button>
              }
            >
              <FolderRow label={favorite.label} totals={favorite} totalCostUsd={totalCostUsd} />
            </FolderLinkWithStar>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <ControlFailure text={FAILURE_TEXT} failure={failure} onDismiss={() => setFailure(null)} alignedEdge="left" />
    </div>
  );
}
