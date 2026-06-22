// Single source of truth for the conversation table's column count, so the
// header, body cells, the expanded detail row's colSpan, and the footer's
// label colSpan never drift apart.
//
// The table has six columns: Date, Folder, Title, Model(s), Total, Cost. When
// scoped to a single Project (an active `?folder=`) the Folder column is hidden
// — every visible row shares that Project — so the table shrinks to five
// columns. Pure + React-free so it unit-tests in the node vitest environment.

/** Columns shown when unscoped: Date, Folder, Title, Model(s), Total, Cost. */
const UNSCOPED_COLUMN_COUNT = 6;

/** Leading label columns the footer's summary cell spans when unscoped:
 *  Date, Folder, Title, Model(s) (Total + Cost keep their own footer cells). */
const UNSCOPED_FOOTER_LABEL_COLSPAN = 4;

/** Total column count, one fewer when scoped (the Folder column is hidden). */
export function columnCount(scoped: boolean): number {
  return scoped ? UNSCOPED_COLUMN_COUNT - 1 : UNSCOPED_COLUMN_COUNT;
}

/** The footer summary cell's colSpan, one fewer when the Folder column is hidden. */
export function footerLabelColSpan(scoped: boolean): number {
  return scoped
    ? UNSCOPED_FOOTER_LABEL_COLSPAN - 1
    : UNSCOPED_FOOTER_LABEL_COLSPAN;
}
