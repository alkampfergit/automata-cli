#!/usr/bin/env node
// Local approximation of the SonarCloud shell rules that fire on this repository.
// SonarCloud analyses the shell scripts too, but SonarJS (eslint.sonar.config.js) does not.
// Rules: S7688 ('[' instead of '[['), S131 (case without default), S1066 (mergeable if),
//        S1192 (repeated string literal), S7679 (positional parameter used directly).
// Usage: node scripts/sonar-shell-check.mjs [--json] [file...]   (default: every tracked *.sh)
// Exit code is 0 without findings, 1 otherwise.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
let files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  files = spawnSync('git', ['ls-files', '*.sh'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
}

const MIN_LITERAL_LENGTH = 7;
const LITERAL_THRESHOLD = 7;
const COMMAND_START = /(^\s*|\s*(?:if|elif|while|until|then|do|else|!)\s+|&&\s*|\|\|\s*|;\s*)\[ /g;

/** Remove quoted text so brackets inside strings are not tested. */
function withoutStrings(line) {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");
}

function checkFile(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const findings = [];
  const add = (rule, line, message) => findings.push({ file, rule, line, message });
  const literals = new Map();
  const ifStack = [];
  let heredoc = null;
  let inCase = [];
  let inFunction = false;
  let multiline = false;
  let multilineIfLine = null;

  lines.forEach((raw, index) => {
    const n = index + 1;
    const text = raw.trim();
    if (heredoc !== null) {
      if (text === heredoc) heredoc = null;
      return;
    }
    const here = /<<-?\s*['"]?(\w+)['"]?/.exec(raw);
    if (here && !text.startsWith('#')) heredoc = here[1];
    if (text.startsWith('#')) return;

    // A line that opens an unbalanced double quote starts a multi-line string (for example python -c "...").
    const quoteCount = (raw.replace(/\\./g, '').match(/"/g) ?? []).length;
    const wasMultiline = multiline;
    if (quoteCount % 2 === 1 && (multiline || /-c\s+"/.test(raw))) multiline = !multiline;
    if (multiline && !wasMultiline && /^\s*if\s/.test(raw)) multilineIfLine = n;
    if (wasMultiline && multiline) return;

    const code = withoutStrings(raw);

    for (const match of code.matchAll(COMMAND_START)) {
      void match;
      add('shell:S7688', n, "Use '[[' instead of '[' for conditional tests.");
    }

    for (const literal of raw.matchAll(/'([^'\s]{7,})'|"([A-Za-z][\w.-]{6,})"/g)) {
      const value = literal[1] ?? literal[2];
      if (value.length >= MIN_LITERAL_LENGTH) {
        const list = literals.get(value) ?? [];
        list.push(n);
        literals.set(value, list);
      }
    }

    const oneLiner = /^\s*\w+\s*\(\)\s*\{.*\}\s*$/.test(raw);
    if (/^\s*\w+\s*\(\)\s*\{/.test(raw) || /^\s*function\s+\w+/.test(raw)) inFunction = !oneLiner;
    if ((inFunction || oneLiner) && !/^\s*local\s+\w+=/.test(raw) && !/^\s*\w+=["']?\$[1-9]/.test(raw)) {
      for (const _ of raw.replace(/\becho\s+"[^"]*"/g, '').matchAll(/\$[1-9]/g)) {
        void _;
        add('shell:S7679', n, 'Assign this positional parameter to a local variable.');
      }
    }
    if (/^\}/.test(raw)) inFunction = false;

    if (/^\s*case\s.+\sin\s.*\besac\b/.test(code)) {
      if (!/(\sin|;;)\s*\*\)/.test(code)) add('shell:S131', n, 'Add a default case (*) to handle unexpected values.');
    } else if (/^\s*case\s.+\sin\s*$/.test(code)) inCase.push({ line: n, hasDefault: false });
    if (inCase.length > 0 && /^\s*\*\)/.test(code)) inCase[inCase.length - 1].hasDefault = true;
    if (/^\s*esac\b/.test(code)) {
      const frame = inCase.pop();
      if (frame && !frame.hasDefault) add('shell:S131', frame.line, 'Add a default case (*) to handle unexpected values.');
    }

    const closesMultilineIf = wasMultiline && !multiline && multilineIfLine !== null && /;\s*then\s*$/.test(raw);
    const opensIf = closesMultilineIf || /^\s*if\s.*;\s*then\s*$/.test(code) || (/^\s*if\s/.test(code) && /^\s*then\s*$/.test(lines[index + 1] ?? ''));
    if (opensIf) {
      const parent = ifStack[ifStack.length - 1];
      const ifLine = closesMultilineIf ? multilineIfLine : n;
      if (parent) {
        parent.statements += 1;
        parent.soleIf = parent.statements === 1 ? ifLine : null;
      }
      multilineIfLine = null;
      ifStack.push({ line: ifLine, statements: 0, soleIf: null, hasElse: false, soleIfHasElse: false });
    } else if (ifStack.length > 0 && multilineIfLine !== n) {
      const top = ifStack[ifStack.length - 1];
      if (/^\s*(else|elif)\b/.test(code)) {
        top.hasElse = true;
      } else if (/^\s*fi\b/.test(code)) {
        ifStack.pop();
        const parent = ifStack[ifStack.length - 1];
        if (parent) parent.soleIfHasElse = top.hasElse;
        if (top.statements === 1 && top.soleIf !== null && !top.hasElse && !top.soleIfHasElse) {
          add('shell:S1066', top.soleIf, 'Merge this if statement with the enclosing one.');
        }
      } else if (text !== '' && text !== 'then') {
        top.statements += 1;
        top.soleIf = null;
      }
    }
  });

  for (const [value, where] of literals) {
    if (where.length >= LITERAL_THRESHOLD) {
      add('shell:S1192', where[where.length - 1], `Define a constant instead of using the literal '${value}' ${where.length} times.`);
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
