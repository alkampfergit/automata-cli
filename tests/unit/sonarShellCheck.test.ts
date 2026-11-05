import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts', 'sonar-shell-check.mjs');
let dir = '';

function check(content: string): { status: number | null; stdout: string } {
  dir = mkdtempSync(join(tmpdir(), 'shell-check-'));
  const file = join(dir, 'sample.sh');
  writeFileSync(file, content);
  const result = spawnSync('node', [script, file], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout };
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('sonar-shell-check', () => {
  it('accepts a clean script', () => {
    const result = check('#!/usr/bin/env bash\nif [[ -f x ]]; then\n  echo ok\nfi\n');
    expect(result.status).toBe(0);
  });

  it('reports a single-bracket test', () => {
    const result = check('if [ -f x ]; then\n  echo ok\nfi\n');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('shell:S7688');
  });

  it('reports a case without a default branch', () => {
    const result = check('case "$a" in\n  x) echo x ;;\nesac\n');
    expect(result.stdout).toContain('shell:S131');
  });

  it('reports an if statement that only wraps another if statement', () => {
    const result = check('if [[ -f a ]]; then\n  if [[ -f b ]]; then\n    echo ok\n  fi\nfi\n');
    expect(result.stdout).toContain('shell:S1066');
  });

  it('reports a positional parameter used in a function', () => {
    const result = check('f() {\n  [[ -f "$1" ]] && return 0\n}\n');
    expect(result.stdout).toContain('shell:S7679');
  });
});
