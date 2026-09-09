export const CLEANING_COLUMN_CHOICE_LIMIT = 80;
export const CLEANING_COLUMN_SEARCH_THRESHOLD = 12;

/** Search is display-only: every returned option is still an exact source name. */
export function cleaningColumnChoices(
  columns: readonly string[],
  labels: ReadonlyMap<string, string>,
  query: string,
  locale: string,
  selected: string,
) {
  const needle = query.trim().toLocaleLowerCase(locale);
  const exact: string[] = [];
  const partial: string[] = [];
  const capacity = CLEANING_COLUMN_CHOICE_LIMIT + 1;
  for (const column of columns) {
    if (!needle) {
      partial.push(column);
      if (partial.length === capacity) break;
      continue;
    }
    const name = column.toLocaleLowerCase(locale);
    const label = (labels.get(column) ?? column).toLocaleLowerCase(locale);
    // An exact name near the end must not disappear behind 80 substring hits.
    if (name === needle || label === needle) {
      if (exact.length < capacity) exact.push(column);
    } else if (partial.length < capacity && (name.includes(needle) || label.includes(needle))) {
      partial.push(column);
    }
  }
  const matches = [...exact, ...partial].slice(0, CLEANING_COLUMN_CHOICE_LIMIT);
  return {
    matches,
    truncated: exact.length + partial.length > CLEANING_COLUMN_CHOICE_LIMIT,
    // Searching must never silently move the selected cleaning target.
    pinned: columns.includes(selected) && !matches.includes(selected) ? selected : undefined,
  };
}
