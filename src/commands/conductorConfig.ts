import {
  findSetting,
  formatValue,
  renderSettingsList,
  resolveSetting,
  unknownKeyMessage,
} from "../conductor/settings.js";
import { parseWatchId } from "../conductor/watchList.js";
import { readSettings, writeSetting } from "../conductor/watchStore.js";

const USAGE = "Usage: automata conductor config [<id>|#<id>] set <key> <value> | get <key> | unset <key> | list";

function fail(message: string): number {
  process.stderr.write(`Error: ${message}\n`);
  return 1;
}

/** `12` or `#12` is an item; anything else is the verb. */
function splitScope(words: string[]): { id: number | null; rest: string[] } | string {
  const first = words[0] ?? "";
  if (!/^#?\d/.test(first)) return { id: null, rest: words };
  const id = parseWatchId(first);
  if (id === null) return `"${first}" is not an issue or pull request number.`;
  return { id, rest: words.slice(1) };
}

function scopeLabel(id: number | null): string {
  return id === null ? "for all items" : `for #${String(id)}`;
}

function runSet(id: number | null, args: string[]): number {
  if (args.length !== 2) return fail(`set needs a key and a value. ${USAGE}`);
  const def = findSetting(args[0]);
  if (def === undefined) return fail(unknownKeyMessage(args[0]));
  const parsed = def.parse(args[1]);
  if (!parsed.ok) return fail(parsed.error);
  writeSetting(def.key, id, parsed.value);
  process.stdout.write(`Set ${def.key} to ${String(parsed.value)} ${scopeLabel(id)}.\n`);
  if (def.notSupported !== undefined) {
    process.stderr.write(`Warning: ${def.key} is ${def.notSupported}.\n`);
  }
  return 0;
}

function runGet(id: number | null, args: string[]): number {
  if (args.length !== 1) return fail(`get needs a key. ${USAGE}`);
  const def = findSetting(args[0]);
  if (def === undefined) return fail(unknownKeyMessage(args[0]));
  process.stdout.write(`${formatValue(resolveSetting(readSettings(), def, id === null ? [] : [id]).value)}\n`);
  return 0;
}

function runUnset(id: number | null, args: string[]): number {
  if (args.length !== 1) return fail(`unset needs a key. ${USAGE}`);
  const def = findSetting(args[0]);
  if (def === undefined) return fail(unknownKeyMessage(args[0]));
  const stored = id === null ? readSettings().global : readSettings().items[String(id)];
  if (stored?.[def.key] === undefined) {
    process.stdout.write(`${def.key} is not set ${scopeLabel(id)}.\n`);
    return 0;
  }
  writeSetting(def.key, id, null);
  process.stdout.write(`Removed ${def.key} ${scopeLabel(id)}.\n`);
  return 0;
}

/** `automata conductor config [<id>] <verb> ...`: the words after `config`, as typed. */
export function runConductorConfig(words: string[]): number {
  const scope = splitScope(words);
  if (typeof scope === "string") return fail(scope);
  const [verb, ...args] = scope.rest;
  switch (verb) {
    case "set":
      return runSet(scope.id, args);
    case "get":
      return runGet(scope.id, args);
    case "unset":
      return runUnset(scope.id, args);
    case "list":
      if (args.length > 0) return fail(`list takes no argument. ${USAGE}`);
      process.stdout.write(renderSettingsList(readSettings(), scope.id));
      return 0;
    default:
      return fail(USAGE);
  }
}

