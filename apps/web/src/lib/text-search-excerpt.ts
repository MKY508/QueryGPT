export interface TextSearchExcerpt { before: string; match: string; after: string }

/** Literal alternatives; preserve original graphemes even when NFKC changes length. */
export function textSearchExcerpt(terms: readonly string[], context = { before: 40, after: 90 }) {
  const needles = terms.map(term => term.normalize("NFKC")).filter(Boolean);
  const expression = needles.length ? new RegExp(needles.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "iu") : null;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return (text: string): TextSearchExcerpt | null => {
    if (!expression || !expression.test(text.normalize("NFKC"))) return null;
    const starts: number[] = [], ends: number[] = [], parts: string[] = [];
    for (const { segment, index: offset } of segmenter.segment(text)) {
      const normalized = segment.normalize("NFKC");
      parts.push(normalized);
      for (let unit = 0; unit < normalized.length; unit++) {
        starts.push(offset); ends.push(offset + segment.length);
      }
    }
    const found = expression.exec(parts.join(""));
    if (!found) return null;
    const last = found.index + found[0].length - 1;
    const matchStart = starts[found.index], matchEnd = ends[last];
    const start = starts[Math.max(0, found.index - context.before)], end = ends[Math.min(ends.length - 1, last + context.after)];
    return {
      before: (start ? "…" : "") + text.slice(start, matchStart), match: text.slice(matchStart, matchEnd),
      after: text.slice(matchEnd, end) + (end < text.length ? "…" : ""),
    };
  };
}
