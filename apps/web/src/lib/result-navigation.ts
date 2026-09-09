/** Local reading history, not the conversation list or browser history. */
export interface ResultNavigation { keys: string[]; index: number }
export const EMPTY_RESULT_NAVIGATION: ResultNavigation = { keys: [], index: -1 };
const MAX_RESULT_VISITS = 50;

export function visitResult(current: ResultNavigation, key: string): ResultNavigation {
  if (current.keys[current.index] === key) return current;
  const keys = [...current.keys.slice(0, current.index + 1), key].slice(-MAX_RESULT_VISITS);
  return { keys, index: keys.length - 1 };
}

export function resultNavigationTarget(current: ResultNavigation, direction: -1 | 1, available: ReadonlySet<string>): number | null {
  const selected = current.keys[current.index];
  for (let index = current.index + direction; index >= 0 && index < current.keys.length; index += direction) {
    const key = current.keys[index];
    if (key !== selected && available.has(key)) return index;
  }
  return null;
}
