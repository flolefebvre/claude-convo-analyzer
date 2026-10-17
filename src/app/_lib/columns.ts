// Single source of truth for the conversation table's column count, so the
// header, body cells, the expanded detail row's colSpan, and the footer's
// label colSpan never drift apart.
//
// The table has six columns: Date, Folder, Title, Model(s), Total, Cost. When
// scoped to a single Project (an active `?folder=`) the Folder column is hidden
// — every visible row shares that Project — so the table shrinks to five
// columns. Below a container width the table also hides Folder and Model(s)
// (CSS only, so the DOM keeps every column); the footer then needs a narrower
// label span. Pure + React-free so it unit-tests in the node vitest environment.

/** Columns shown when unscoped: Date, Folder, Title, Model(s), Total, Cost. */
const UNSCOPED_COLUMN_COUNT = 6;

/** Leading label columns the footer's summary cell spans when unscoped:
 *  Date, Folder, Title, Model(s) (Total + Cost keep their own footer cells). */
const UNSCOPED_FOOTER_LABEL_COLSPAN = 4;

/** Total column count, one fewer when scoped (the Folder column is hidden). */
export function columnCount(scoped: boolean): number {
  return scoped ? UNSCOPED_COLUMN_COUNT - 1 : UNSCOPED_COLUMN_COUNT;
}

/** Leading label columns left in the compact (narrow) layout, which hides
 *  Folder and Model(s): Date and Title. */
const COMPACT_FOOTER_LABEL_COLSPAN = 2;

/**
 * The footer summary cell's colSpan: one fewer when the Folder column is
 * hidden, and just Date + Title in the compact layout.
 *
 * @example footerLabelColSpan(isScoped, { compact: true }) // 2
 */
export function footerLabelColSpan(scoped: boolean, { compact = false }: { compact?: boolean } = {}): number {
  if (compact) return COMPACT_FOOTER_LABEL_COLSPAN;
  return scoped ? UNSCOPED_FOOTER_LABEL_COLSPAN - 1 : UNSCOPED_FOOTER_LABEL_COLSPAN;
}
