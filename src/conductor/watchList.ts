/** Pure helpers for `conductor.watch`, the list of issue/PR numbers the conductor follows. */

/** Parse a CLI argument as an issue/PR number; null when it is not a positive integer. */
export function parseWatchId(raw: string): number | null {
  const text = raw.trim().replace(/^#/, "");
  if (!/^[1-9]\d*$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/** Hand-edited JSON: keep positive safe integers, first occurrence wins. */
export function normalizeWatch(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const entry of raw) {
    if (typeof entry === "number" && Number.isSafeInteger(entry) && entry > 0) seen.add(entry);
  }
  return [...seen];
}

export function withWatched(list: number[], ...ids: number[]): number[] {
  return normalizeWatch([...list, ...ids]);
}

export function withoutWatched(list: number[], id: number): number[] {
  return list.filter((entry) => entry !== id);
}
