import { describe, expect, it } from "vitest";
import {
  emptySettings,
  findSetting,
  normalizeSettings,
  renderSettingsList,
  resolveSetting,
  settingsHelp,
  unknownKeyMessage,
  withSetting,
} from "../../src/conductor/settings.js";

const rounds = findSetting("copilot-review-rounds")!;
const type = findSetting("copilot-review-type")!;

describe("settings registry", () => {
  it.each([["0", 0], ["3", 3], [" 12 ", 12]])("parses rounds %j", (raw, value) => {
    expect(rounds.parse(raw)).toEqual({ ok: true, value });
  });

  it.each(["-1", "1.5", "abc", "", "1e3"])("rejects rounds %j", (raw) => {
    expect(rounds.parse(raw).ok).toBe(false);
  });

  it("accepts balanced and lite only, and the error names both", () => {
    expect(type.parse("lite")).toEqual({ ok: true, value: "lite" });
    const bad = type.parse("fast");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/balanced, lite/);
  });

  it("names the supported keys for an unknown key", () => {
    expect(unknownKeyMessage("x")).toMatch(/copilot-review-type, copilot-review-rounds|copilot-review-rounds, copilot-review-type/);
  });
});

describe("resolveSetting", () => {
  const state = withSetting(withSetting(emptySettings(), "copilot-review-rounds", null, 3), "copilot-review-rounds", 7, 1);

  it("item beats global beats default", () => {
    expect(resolveSetting(state, rounds, [7])).toEqual({ value: 1, source: "item" });
    expect(resolveSetting(state, rounds, [8])).toEqual({ value: 3, source: "global" });
    expect(resolveSetting(emptySettings(), rounds, [8])).toEqual({ value: 0, source: "default" });
    expect(resolveSetting(emptySettings(), type)).toEqual({ value: null, source: "default" });
  });

  it("takes the first item that has a value, strongest first", () => {
    expect(resolveSetting(state, rounds, [8, 7])).toEqual({ value: 1, source: "item" });
  });

  it("removes a value and drops an empty scope", () => {
    const next = withSetting(state, "copilot-review-rounds", 7, null);
    expect(next.items).toEqual({});
    expect(state.items["7"]).toBeDefined();
  });
});

describe("normalizeSettings", () => {
  it("keeps valid values and drops unknown keys, bad values and bad ids", () => {
    const state = normalizeSettings({
      global: { "copilot-review-rounds": 2, "copilot-review-type": "huge", other: 1 },
      items: { "5": { "copilot-review-rounds": -1 }, "6": { "copilot-review-type": "lite" }, x: { "copilot-review-rounds": 1 } },
    });
    expect(state).toEqual({ global: { "copilot-review-rounds": 2 }, items: { "6": { "copilot-review-type": "lite" } } });
  });

  it.each([null, "x", [], 3])("gives empty settings for %j", (raw) => {
    expect(normalizeSettings(raw)).toEqual(emptySettings());
  });
});

describe("renderSettingsList", () => {
  it("lists every key with allowed values, default, value and source, and flags the unsupported key", () => {
    const text = renderSettingsList(withSetting(emptySettings(), "copilot-review-rounds", 5, 3), 5);
    expect(text.split("\n")[0]).toMatch(/^KEY\s+ALLOWED\s+DEFAULT\s+VALUE\s+SOURCE$/);
    expect(text).toMatch(/copilot-review-rounds\s+integer >= 0, 0 = off\s+0\s+3\s+item/);
    expect(text).toMatch(/copilot-review-type\s+balanced \| lite \(not supported yet: stored, not sent to GitHub\)\s+\(unset\)\s+\(unset\)\s+default/);
  });

  it("shows the global values without an id", () => {
    const text = renderSettingsList(withSetting(emptySettings(), "copilot-review-rounds", null, 2), null);
    expect(text).toMatch(/copilot-review-rounds\s+.*\s+2\s+global/);
  });

  it("the help text says the type is not supported yet", () => {
    expect(settingsHelp()).toMatch(/copilot-review-type.*NOT SUPPORTED YET/);
  });
});
