import { describe, it, expect } from "vitest";
import { normalizeWatch, parseWatchId, withoutWatched, withWatched } from "../../src/conductor/watchList.js";

describe("watchList", () => {
  it.each([["12", 12], ["#7", 7], [" 3 ", 3]])("parses %j", (raw, expected) => {
    expect(parseWatchId(raw)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "abc", "", "9999999999999999999"])("rejects %j", (raw) => {
    expect(parseWatchId(raw)).toBeNull();
  });

  it("normalizes hand-edited input", () => {
    expect(normalizeWatch([114, "x", 114, 0, -2, 1.5, 120])).toEqual([114, 120]);
    expect(normalizeWatch(undefined)).toEqual([]);
    expect(normalizeWatch("5")).toEqual([]);
  });

  it("adds without duplicates and removes", () => {
    expect(withWatched([1, 2], 2, 3)).toEqual([1, 2, 3]);
    expect(withoutWatched([1, 2, 3], 2)).toEqual([1, 3]);
  });
});
