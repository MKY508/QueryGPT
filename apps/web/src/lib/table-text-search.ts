/** Search-only normalization; never use normalized text as a field identifier,
 * displayed value, export value, or an exact business-filter operand. */
export function tableTextMatcher(query: string, locale: string): (text: string) => boolean {
  const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase(locale).normalize("NFKC");
  const needle = normalize(query.trim());
  return needle ? (text) => normalize(text).includes(needle) : () => true;
}
