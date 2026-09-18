import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resolveCommand } from "../../src/cli/spawnUtils.js";

const originalPath = process.env["PATH"];
const dirs: string[] = [];

function pathDir(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "automata-path-"));
  dirs.push(dir);
  for (const name of names) writeFileSync(join(dir, name), "");
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
});
