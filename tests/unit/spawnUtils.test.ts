import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resolveCommand } from "../../src/cli/spawnUtils.js";

const originalPath = process.env["PATH"];
const dirs: string[] = [];

/** A PATH entry holding launchable executables: regular files with an execute bit. */
function pathDir(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "automata-path-"));
  dirs.push(dir);
  for (const name of names) writeFileSync(join(dir, name), "", { mode: 0o755 });
  return dir;
}

afterEach(() => {
  process.env["PATH"] = originalPath;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resolveCommand", () => {
  it("fully qualifies a command found on PATH", () => {
    const dir = pathDir("automata-fake-tool");
    process.env["PATH"] = dir;

    expect(resolveCommand("automata-fake-tool")).toBe(join(dir, "automata-fake-tool"));
  });

  it("takes the first PATH entry that has it, as the shell would", () => {
    const first = pathDir("automata-fake-tool");
    const second = pathDir("automata-fake-tool");
    process.env["PATH"] = [first, second].join(delimiter);

    expect(resolveCommand("automata-fake-tool")).toBe(join(first, "automata-fake-tool"));
  });

  it("returns the bare name when nothing on PATH matches", () => {
    // The callers depend on this: `do-work --check` reads "resolved === name"
    // as "not on PATH", and the spawners let the child fail with ENOENT.
    process.env["PATH"] = pathDir();

    expect(resolveCommand("automata-fake-tool")).toBe("automata-fake-tool");
  });

  it("returns the bare name when PATH is unset", () => {
    delete process.env["PATH"];

    expect(resolveCommand("automata-fake-tool")).toBe("automata-fake-tool");
  });

  it("skips a name on PATH that is not executable", () => {
    // A half-finished install leaves a mode-644 file behind. Reporting it as the
    // executor makes `--check` say the loop is fine and the tick die on EACCES.
    const dir = mkdtempSync(join(tmpdir(), "automata-path-"));
    dirs.push(dir);
    writeFileSync(join(dir, "automata-fake-tool"), "", { mode: 0o644 });
    process.env["PATH"] = dir;

    expect(resolveCommand("automata-fake-tool")).toBe("automata-fake-tool");
  });

  it("skips a directory that shares the command's name", () => {
    const dir = mkdtempSync(join(tmpdir(), "automata-path-"));
    dirs.push(dir);
    mkdirSync(join(dir, "automata-fake-tool"));
    const real = pathDir("automata-fake-tool");
    process.env["PATH"] = [dir, real].join(delimiter);

    expect(resolveCommand("automata-fake-tool")).toBe(join(real, "automata-fake-tool"));
  });
});
