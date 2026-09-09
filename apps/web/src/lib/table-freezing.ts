/** Freeze a leading visible prefix while leaving room to read the moving
 * columns. Measured widths include the independent row-number/selection gutter. */
export function tableFrozenOffsets(requested: number, viewport: number, gutter: number, widths: readonly number[]): number[] {
  if (!Number.isFinite(requested) || requested <= 0 || !Number.isFinite(viewport) || viewport <= 0 || !Number.isFinite(gutter) || gutter <= 0) return [];
  const allFit = requested >= widths.length && widths.every((width) => Number.isFinite(width) && width > 0)
    && gutter + widths.reduce((sum, width) => sum + width, 0) <= viewport;
  const budget = allFit ? viewport : viewport - Math.max(120, viewport * 0.35);
  const offsets: number[] = [];
  let left = gutter;
  for (const width of widths.slice(0, Math.floor(requested))) {
    if (!Number.isFinite(width) || width <= 0 || left + width > budget) break;
    offsets.push(left);
    left += width;
  }
  return offsets;
}
