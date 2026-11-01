/**
 * Conductor settings: a small registry of keys that one command (`conductor config`) sets for the whole
 * conductor or for one item. The registry drives validation, `list`, the error messages and the docs.
 * Everything here is pure; the state file is read and written in `watchStore.ts`.
 */

export type SettingValue = string | number;

export type ParsedSetting = { ok: true; value: SettingValue } | { ok: false; error: string };

export interface SettingDef {
  key: string;
  description: string;
  /** The allowed values as a person reads them in `list`. */
  allowed: string;
  /** Null when the key has no default. */
  defaultValue: SettingValue | null;
  /** Set when the value is stored but has no effect yet. */
  notSupported?: string;
  /** Parse the text of a command line. */
  parse(raw: string): ParsedSetting;
  /** Check a value read from a hand-edited file. */
  isValid(value: unknown): value is SettingValue;
}

export const COPILOT_REVIEW_TYPES = ["balanced", "lite"] as const;

export const NOT_SENT_NOTE = "not supported yet: stored, not sent to GitHub";

const COPILOT_REVIEW_ROUNDS: SettingDef = {
  key: "copilot-review-rounds",
  description: "How many Copilot review rounds a pull request gets before it counts as ready; 0 is off",
  allowed: "integer >= 0, 0 = off",
  defaultValue: 0,
  parse(raw) {
    const text = raw.trim();
    const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value)) {
      return { ok: false, error: `copilot-review-rounds must be an integer >= 0 (0 = off), got "${raw}".` };
    }
    return { ok: true, value };
  },
  isValid: (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
};

const COPILOT_REVIEW_TYPE: SettingDef = {
  key: "copilot-review-type",
  description: "The Copilot review mode",
  allowed: COPILOT_REVIEW_TYPES.join(" | "),
  defaultValue: null,
  notSupported: NOT_SENT_NOTE,
  parse(raw) {
    const text = raw.trim();
    if (!(COPILOT_REVIEW_TYPES as readonly string[]).includes(text)) {
      return { ok: false, error: `copilot-review-type must be one of ${COPILOT_REVIEW_TYPES.join(", ")}, got "${raw}".` };
    }
    return { ok: true, value: text };
  },
  isValid: (value): value is string => typeof value === "string" && (COPILOT_REVIEW_TYPES as readonly string[]).includes(value),
};

/** Add a key here and `set`, `get`, `unset` and `list` know it. */
export const SETTING_DEFS: readonly SettingDef[] = [COPILOT_REVIEW_ROUNDS, COPILOT_REVIEW_TYPE];

export const COPILOT_ROUNDS_KEY = COPILOT_REVIEW_ROUNDS.key;

export function findSetting(key: string): SettingDef | undefined {
  return SETTING_DEFS.find((def) => def.key === key);
}

/** The error for a key that is not in the registry; it names the supported keys. */
export function unknownKeyMessage(key: string): string {
  return `Unknown setting "${key}". Supported keys: ${SETTING_DEFS.map((def) => def.key).join(", ")}.`;
}

/** The values of one scope, by key. */
export type SettingValues = Record<string, SettingValue>;

export interface SettingsState {
  global: SettingValues;
  items: Record<string, SettingValues>;
}

export function emptySettings(): SettingsState {
  return { global: {}, items: {} };
}

function normalizeValues(raw: unknown): SettingValues {
  const values: SettingValues = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return values;
  for (const [key, value] of Object.entries(raw)) {
    const def = findSetting(key);
    if (def?.isValid(value) === true) values[key] = value;
  }
  return values;
}

/** Hand-edited JSON: keep the known keys with a valid value, drop the rest. */
export function normalizeSettings(raw: unknown): SettingsState {
  const state = emptySettings();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return state;
  const source = raw as { global?: unknown; items?: unknown };
  state.global = normalizeValues(source.global);
  if (typeof source.items === "object" && source.items !== null && !Array.isArray(source.items)) {
    for (const [id, values] of Object.entries(source.items)) {
      const kept = normalizeValues(values);
      if (/^[1-9]\d*$/.test(id) && Object.keys(kept).length > 0) state.items[id] = kept;
    }
  }
  return state;
}

export function isEmptySettings(state: SettingsState): boolean {
  return Object.keys(state.global).length === 0 && Object.keys(state.items).length === 0;
}

export type SettingSource = "item" | "global" | "default";

export interface EffectiveSetting {
  value: SettingValue | null;
  source: SettingSource;
}

/**
 * The effective value. `ids` are the items to look at, the strongest first: for a pull request, the pull request,
 * then the issue that links it. After them come the global value and the default.
 */
export function resolveSetting(state: SettingsState, def: SettingDef, ids: readonly number[] = []): EffectiveSetting {
  for (const id of ids) {
    const value = state.items[String(id)]?.[def.key];
    if (value !== undefined) return { value, source: "item" };
  }
  const global = state.global[def.key];
  if (global !== undefined) return { value: global, source: "global" };
  return { value: def.defaultValue, source: "default" };
}

/** Return a copy with one value set (`value` given) or removed (`value` null). A scope left empty is dropped. */
export function withSetting(state: SettingsState, key: string, id: number | null, value: SettingValue | null): SettingsState {
  const next: SettingsState = { global: { ...state.global }, items: { ...state.items } };
  const scope = id === null ? next.global : { ...next.items[String(id)] };
  if (value === null) delete scope[key];
  else scope[key] = value;
  if (id !== null) {
    if (Object.keys(scope).length === 0) delete next.items[String(id)];
    else next.items[String(id)] = scope;
  }
  return next;
}

/** The value as `list` and `get` print it. */
export function formatValue(value: SettingValue | null): string {
  return value === null ? "(unset)" : String(value);
}

function allowedText(def: SettingDef): string {
  return def.notSupported === undefined ? def.allowed : `${def.allowed} (${def.notSupported})`;
}

/** The `list` table: every key of the registry, whether it is set or not. */
export function renderSettingsList(state: SettingsState, id: number | null): string {
  const rows = SETTING_DEFS.map((def) => {
    const effective = resolveSetting(state, def, id === null ? [] : [id]);
    return [def.key, allowedText(def), formatValue(def.defaultValue), formatValue(effective.value), effective.source];
  });
  const header = ["KEY", "ALLOWED", "DEFAULT", "VALUE", "SOURCE"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells: string[]): string =>
    cells.map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column]))).join("  ");
  return [line(header), ...rows.map(line)].join("\n") + "\n";
}

/** The text of `conductor config --help`: one line for each key. */
export function settingsHelp(): string {
  const lines = SETTING_DEFS.map((def) => {
    const note = def.notSupported === undefined ? "" : ` NOT SUPPORTED YET (${def.notSupported}).`;
    return `  ${def.key}  ${def.description}. Allowed: ${def.allowed}.${note}`;
  });
  return `\nKeys:\n${lines.join("\n")}\n`;
}
