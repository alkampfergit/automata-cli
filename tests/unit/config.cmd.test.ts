import { describe, it, expect, afterEach } from "vitest";
import { execSync, ExecSyncOptions } from "node:child_process";
import { rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const AUTOMATA_DIR = join(process.cwd(), ".automata");

function run(args: string, opts?: ExecSyncOptions): string {
  return execSync(`node dist/index.js ${args}`, {
    encoding: "utf8",
    ...opts,
  });
}

afterEach(() => {
  rmSync(AUTOMATA_DIR, { recursive: true, force: true });
});

describe("automata config set type", () => {
  it("sets remote type to gh and prints confirmation", () => {
    const output = run("config set type gh");
    expect(output.trim()).toBe("Remote type set to: gh");
    const config = JSON.parse(readFileSync(join(AUTOMATA_DIR, "config.json"), "utf8"));
    expect(config.remoteType).toBe("gh");
  });

  it("sets remote type to azdo and prints confirmation", () => {
    const output = run("config set type azdo");
    expect(output.trim()).toBe("Remote type set to: azdo");
    const config = JSON.parse(readFileSync(join(AUTOMATA_DIR, "config.json"), "utf8"));
    expect(config.remoteType).toBe("azdo");
  });

  it("exits with code 1 and prints error for invalid type", () => {
    let errorOutput = "";
    try {
      run("config set type invalid");
    } catch (err: unknown) {
      const execError = err as { status?: number; stderr?: Buffer };
      expect(execError.status).toBe(1);
      errorOutput = execError.stderr?.toString() ?? "";
    }
    expect(errorOutput).toContain("invalid type");
    expect(existsSync(AUTOMATA_DIR)).toBe(false);
  });
});
