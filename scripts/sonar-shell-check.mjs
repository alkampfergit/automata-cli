#!/usr/bin/env node
// Local approximation of the SonarCloud shell rules that fire on this repository.
// SonarCloud analyses the shell scripts too, but SonarJS (eslint.sonar.config.js) does not.
// Rules: S7688 ('[' instead of '[['), S131 (case without default), S1066 (mergeable if),
//        S1192 (repeated string literal), S7679 (positional parameter used directly).
// Usage: node scripts/sonar-shell-check.mjs [--json] [file...]   (default: every *.sh file in the repository)
// Exit code is 0 without findings, 1 otherwise.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage']);

/** Find every *.sh file under a directory, without the directories that hold no project code. */
function findShellFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : findShellFiles(path);
    return entry.name.endsWith('.sh') ? [path] : [];
  });
}

let files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) files = findShellFiles('.');

const MIN_LITERAL_LENGTH = 7;
const LITERAL_THRESHOLD = 7;
const COMMAND_START = /(?:^|[;&|]|\b(?:if|elif|while|until|then|do|else)|!)\s*\[ /g;
const DEFAULT_CASE_MESSAGE = 'Add a default case (*) to handle unexpected values.';

/** Remove quoted text so brackets inside strings are not tested. */
function withoutStrings(line) {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");
}

/** Track heredoc bodies. Returns true when the line belongs to one and must be skipped. */
function skipsHeredoc(state, raw, text) {
  if (state.heredoc !== null) {
    if (text === state.heredoc) state.heredoc = null;
    return true;
  }
  const here = /<<-?\s*['"]?(\w+)['"]?/.exec(raw);
  if (here && !text.startsWith('#')) state.heredoc = here[1];
  return false;
}

/** A line that opens an unbalanced double quote starts a multi-line string (for example python -c "..."). */
function updateMultiline(state, raw, n) {
  const quoteCount = (raw.replace(/\\./g, '').match(/"/g) ?? []).length;
  const was = state.multiline;
  if (quoteCount % 2 === 1 && (was || /-c\s+"/.test(raw))) state.multiline = !was;
  if (state.multiline && !was && /^\s*if\s/.test(raw)) state.multilineIfLine = n;
  return was;
}

function checkBrackets(code, n, add) {
  for (const _match of code.matchAll(COMMAND_START)) {
    add('shell:S7688', n, "Use '[[' instead of '[' for conditional tests.");
  }
}

function collectLiterals(state, raw, n) {
  for (const literal of raw.matchAll(/'([^'\s]{7,})'|"([A-Za-z][\w.-]{6,})"/g)) {
    const value = literal[1] ?? literal[2];
    if (value.length < MIN_LITERAL_LENGTH) continue;
    const list = state.literals.get(value) ?? [];
    list.push(n);
    state.literals.set(value, list);
  }
}

function checkPositionals(state, raw, n, add) {
  const oneLiner = /^\s*\w+\s*\(\)\s*\{.*\}\s*$/.test(raw);
  if (/^\s*\w+\s*\(\)\s*\{/.test(raw) || /^\s*function\s+\w+/.test(raw)) state.inFunction = !oneLiner;
  const assigned = /^\s*local\s+\w+=/.test(raw) || /^\s*\w+=["']?\$[1-9]/.test(raw);
  if ((state.inFunction || oneLiner) && !assigned) {
    for (const _match of raw.replace(/\becho\s+"[^"]*"/g, '').matchAll(/\$[1-9]/g)) {
      add('shell:S7679', n, 'Assign this positional parameter to a local variable.');
    }
  }
  if (raw.startsWith('}')) state.inFunction = false;
}

function checkCases(state, code, n, add) {
  if (/^\s*case\s.+\sin\s.*\besac\b/.test(code)) {
    if (!/(\sin|;;)\s*\*\)/.test(code)) add('shell:S131', n, DEFAULT_CASE_MESSAGE);
  } else if (/^\s*case\s.+\sin\s*$/.test(code)) {
    state.cases.push({ line: n, hasDefault: false });
  }
  if (state.cases.length > 0 && /^\s*\*\)/.test(code)) state.cases.at(-1).hasDefault = true;
  if (/^\s*esac\b/.test(code)) {
    const frame = state.cases.pop();
    if (frame && !frame.hasDefault) add('shell:S131', frame.line, DEFAULT_CASE_MESSAGE);
  }
}

function opensIf(code, nextLine, closesMultilineIf) {
  if (closesMultilineIf || /^\s*if\s.*;\s*then\s*$/.test(code)) return true;
  return /^\s*if\s/.test(code) && /^\s*then\s*$/.test(nextLine);
}

function closeIf(state, add) {
  const top = state.ifs.pop();
  const parent = state.ifs.at(-1);
  if (parent) parent.soleIfHasElse = top.hasElse;
  if (top.statements === 1 && top.soleIf !== null && !top.hasElse && !top.soleIfHasElse) {
    add('shell:S1066', top.soleIf, 'Merge this if statement with the enclosing one.');
  }
}

function trackIfBody(state, code, text, add) {
  const top = state.ifs.at(-1);
  if (/^\s*(else|elif)\b/.test(code)) {
    top.hasElse = true;
  } else if (/^\s*fi\b/.test(code)) {
    closeIf(state, add);
  } else if (text !== '' && text !== 'then') {
    top.statements += 1;
    top.soleIf = null;
  }
}

function checkIfs(state, ctx, add) {
  const { raw, code, text, n, nextLine, wasMultiline } = ctx;
  const closesMultilineIf = wasMultiline && !state.multiline && state.multilineIfLine !== null && /;\s*then\s*$/.test(raw);
  if (opensIf(code, nextLine, closesMultilineIf)) {
    const parent = state.ifs.at(-1);
    const ifLine = closesMultilineIf ? state.multilineIfLine : n;
    if (parent) {
      parent.statements += 1;
      parent.soleIf = parent.statements === 1 ? ifLine : null;
    }
    state.multilineIfLine = null;
    state.ifs.push({ line: ifLine, statements: 0, soleIf: null, hasElse: false, soleIfHasElse: false });
  } else if (state.ifs.length > 0 && state.multilineIfLine !== n) {
    trackIfBody(state, code, text, add);
  }
}

function checkLine(state, lines, index, add) {
  const raw = lines[index];
  const n = index + 1;
  const text = raw.trim();
  if (skipsHeredoc(state, raw, text) || text.startsWith('#')) return;
  const wasMultiline = updateMultiline(state, raw, n);
  if (wasMultiline && state.multiline) return;
  const code = withoutStrings(raw);
  checkBrackets(code, n, add);
  collectLiterals(state, raw, n);
  checkPositionals(state, raw, n, add);
  checkCases(state, code, n, add);
  checkIfs(state, { raw, code, text, n, nextLine: lines[index + 1] ?? '', wasMultiline }, add);
}

function checkFile(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const findings = [];
  const add = (rule, line, message) => findings.push({ file, rule, line, message });
  const state = { literals: new Map(), ifs: [], cases: [], heredoc: null, inFunction: false, multiline: false, multilineIfLine: null };
  for (let index = 0; index < lines.length; index++) checkLine(state, lines, index, add);
  for (const [value, where] of state.literals) {
    if (where.length >= LITERAL_THRESHOLD) {
      add('shell:S1192', where.at(-1), `Define a constant instead of using the literal '${value}' ${where.length} times.`);
    }
  }
  return findings;
}

const findings = files.flatMap(checkFile);
if (asJson) {
  console.log(JSON.stringify(findings));
} else {
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}  ${f.message}`);
  console.log(`\nShell check: ${findings.length} finding(s) in ${files.length} file(s)`);
}
process.exit(findings.length === 0 ? 0 : 1);
