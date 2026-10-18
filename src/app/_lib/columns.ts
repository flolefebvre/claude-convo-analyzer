// Single source of truth for the conversation table's column count, so the
// header, body cells, the expanded detail row's colSpan, and the footer's
// label colSpan never drift apart.
//
// The table has six columns: Date, Folder, Title, Model(s), Total, Cost. When
// every row in scope comes from one Project (a leaf Folder, or this folder) the
// Folder column is hidden — it would repeat that Project on every row — so the
// table shrinks to five columns. Below a container width the table also hides
// Folder and Model(s) (CSS only, so the DOM keeps every column); the footer then
// needs a narrower label span. Pure + React-free so it unit-tests in the node
// vitest environment.

/** Every column: Date, Folder, Title, Model(s), Total, Cost. */
const FULL_COLUMN_COUNT = 6;

/** Leading label columns the footer's summary cell spans with every column
 *  shown: Date, Folder, Title, Model(s) (Total + Cost keep their own footer cells). */
const FULL_FOOTER_LABEL_COLSPAN = 4;

/**
 * Total column count, one fewer when the Folder column is hidden.
 *
 * @example columnCount(isFolderColumnHidden) // 5
 */
export function columnCount(isFolderColumnHidden: boolean): number {
  return isFolderColumnHidden ? FULL_COLUMN_COUNT - 1 : FULL_COLUMN_COUNT;
}

/** Leading label columns left in the compact (narrow) layout, which hides
 *  Folder and Model(s): Date and Title. */
const COMPACT_FOOTER_LABEL_COLSPAN = 2;

/**
 * The footer summary cell's colSpan: one fewer when the Folder column is
 * hidden, and just Date + Title in the compact layout.
 *
 * @example footerLabelColSpan(isFolderColumnHidden, { compact: true }) // 2
 */
export function footerLabelColSpan(
  isFolderColumnHidden: boolean,
  { compact = false }: { compact?: boolean } = {},
): number {
  if (compact) return COMPACT_FOOTER_LABEL_COLSPAN;
  return isFolderColumnHidden ? FULL_FOOTER_LABEL_COLSPAN - 1 : FULL_FOOTER_LABEL_COLSPAN;
}
