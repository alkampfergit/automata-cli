import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkChangelogSection, readChangelog } from "../../src/git/changelogGate.js";

// The gate exists so that `publish-release` refuses a release `CHANGELOG.md`
// does not document -- the omission that shipped tag 0.8.0 with no section and
// turned every branch red. These tests pin the two halves separately: what
// counts as a section, and what happens when the file cannot be read at all.

function changelog(body: string): string {
  return ["# Changelog", "", body, ""].join("\n");
}

describe("checkChangelogSection", () => {
  it("accepts a correctly formed heading for the version", () => {
    const result = checkChangelogSection("0.9.0", changelog("## [Unreleased]\n\n## [0.9.0] - 2026-10-01\n"));
    expect(result.ok).toBe(true);
  });

  it("accepts the heading wherever it sits in the file", () => {
    const body = ["## [Unreleased]", "", "## [1.0.0] - 2026-11-01", "", "## [0.9.0] - 2026-10-01"].join("\n");
    expect(checkChangelogSection("0.9.0", changelog(body)).ok).toBe(true);
  });

  it.each([
    // Nothing but the still-unrolled `## [Unreleased]` heading and the previous
    // release -- the exact shape of the file that let tag 0.8.0 through.
    ["the newest released section is an older version", "## [Unreleased]\n\n## [0.8.0] - 2026-09-18\n"],
    // The structural test in `changelog.test.ts` fails on an undated heading, so
    // accepting one here would let the release through into the same red build.
    ["the heading carries no date", "## [0.9.0]\n"],
    ["the date is a word", "## [0.9.0] - soon\n"],
    ["the date is not YYYY-MM-DD", "## [0.9.0] - 01/10/2026\n"],
    ["the version is named only in a bullet", "## [Unreleased]\n\n### Added\n\n- Lands in ## [0.9.0] - 2026-10-01.\n"],
    // Keep a Changelog files often end in a block of these; a substring search
    // for the version would treat one as a section.
    ["the version appears only in a link-reference footer", "[0.9.0]: https://example.test/compare/0.8.0...0.9.0\n"],
    ["the heading is one level too deep", "### [0.9.0] - 2026-10-01\n"],
    ["the heading is one level too shallow", "# [0.9.0] - 2026-10-01\n"],
    // `0.9.0` must not be satisfied by `10.9.0` or `0.9.01`, which a loose
    // pattern would match as substrings of the bracketed version.
    ["a longer version contains the requested one", "## [10.9.0] - 2026-10-01\n"],
    ["the requested version is a prefix of the documented one", "## [0.9.01] - 2026-10-02\n"],
  ])("rejects a changelog where %s", (_case, body) => {
    expect(checkChangelogSection("0.9.0", changelog(body)).ok).toBe(false);
  });

  it("names the expected heading and the roll procedure in the refusal", () => {
    const result = checkChangelogSection("0.9.0", changelog("## [Unreleased]\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("## [0.9.0] - YYYY-MM-DD");
    expect(result.message).toContain("[Unreleased]");
    expect(result.message).toContain("docs/maintenance.md");
  });

  it("passes when there is no changelog to check", () => {
    expect(checkChangelogSection("0.9.0", null).ok).toBe(true);
  });
});

describe("readChangelog", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "changelog-gate-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the file's contents when it is present", () => {
    writeFileSync(join(dir, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n");
    expect(readChangelog(dir)).toContain("## [Unreleased]");
  });

  it("returns null when the directory has no CHANGELOG.md", () => {
    expect(readChangelog(dir)).toBeNull();
  });

  // A repository with no changelog must be able to release; so must one where
  // the path is unreadable for any reason. Neither may throw out of the gate.
  it("returns null rather than throwing when the path cannot be read", () => {
    mkdirSync(join(dir, "CHANGELOG.md"));
    expect(readChangelog(dir)).toBeNull();
  });
});
