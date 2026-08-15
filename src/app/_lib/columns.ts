const UNSCOPED_COLUMN_COUNT = 6;

const UNSCOPED_FOOTER_LABEL_COLSPAN = 4;

export function columnCount(scoped: boolean): number {
  return scoped ? UNSCOPED_COLUMN_COUNT - 1 : UNSCOPED_COLUMN_COUNT;
}

export function footerLabelColSpan(scoped: boolean): number {
  return scoped ? UNSCOPED_FOOTER_LABEL_COLSPAN - 1 : UNSCOPED_FOOTER_LABEL_COLSPAN;
}
