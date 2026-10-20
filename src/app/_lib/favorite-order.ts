// Reordering the Favorites section by hand (GLOSSARY.md, **Favorite**): where
// a moved row lands among the rows shown, and which favorite it then goes
// before — what the `moveFavorite` action saves, so the favorites the section
// hides keep their places.
//
// React-free + DOM-free, like its sibling `_lib` modules: the component
// measures the rows and passes their boxes in.

/** The shown favorites' order after a move, and the favorite the moved one now goes before (null: last). */
export type FavoriteMove = { order: string[]; before: string | null };

/**
 * The order of the shown favorites `shownPaths` once `movedPath` sits at
 * `toIndex`, kept within the list's ends, and the favorite it goes before.
 *
 * @example moveFavoriteToIndex(["/a", "/b", "/c"], "/a", 1) // { order: ["/b", "/a", "/c"], before: "/c" }
 */
export function moveFavoriteToIndex(shownPaths: string[], movedPath: string, toIndex: number): FavoriteMove {
  const others = shownPaths.filter((shownPath) => shownPath !== movedPath);
  const landingIndex = Math.min(Math.max(toIndex, 0), others.length);
  return { order: others.toSpliced(landingIndex, 0, movedPath), before: others[landingIndex] ?? null };
}

/** A row's vertical extent on screen, in CSS pixels, as `getBoundingClientRect()` gives it. */
export type RowBox = { top: number; height: number };

/**
 * The index a dragged row lands at with the pointer at `pointerY`: one past
 * every other row whose middle the pointer is below. `otherRowBoxes` are the
 * rows besides the dragged one, top to bottom.
 *
 * @example dropIndexForPointer([{ top: 100, height: 40 }, { top: 140, height: 40 }], 125) // 1
 */
export function dropIndexForPointer(otherRowBoxes: RowBox[], pointerY: number): number {
  return otherRowBoxes.filter((box) => pointerY > box.top + box.height / 2).length;
}
