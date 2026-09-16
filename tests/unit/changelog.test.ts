import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `CHANGELOG.md` read "0.1.0 - Initial Release" while eight versions shipped to
// npm. Nothing failed while it rotted, which is precisely why it rotted: the
// file is not imported, built or published, so only a deliberate check notices.
// These assertions are that check -- the format invariants `docs/maintenance.md`
// documents, plus the one thing that actually went wrong, a released tag with
// no section.

const CHANGELOG = fileURLToPath(new URL("../../CHANGELOG.md", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const UNRELEASED_HEADING = "## [Unreleased]";
const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;
const CATEGORY_HEADING = /^### (.+)$/;
// Keep a Changelog 1.1.0. A typo'd category ("Changes", "Bugfixes") renders as
// a heading either way, so the set is closed rather than merely suggested.
const CATEGORIES = new Set(["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"]);

interface Section {
  readonly version: string;
  readonly date: string;
  readonly line: number;
}

function changelogLines(): string[] {
  return readFileSync(CHANGELOG, "utf8").split("\n");
}

function versionSections(): Section[] {
  const sections: Section[] = [];
  changelogLines().forEach((line, index) => {
    const match = VERSION_HEADING.exec(line);
    if (match) {
      sections.push({ version: match[1], date: match[2], line: index + 1 });
    }
  });
  return sections;
}

function compareSemver(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) {
      return left[i] - right[i];
    }
  }
  return 0;
}

// Two tags exist per release: the bare `0.6.0` that `publish-release` puts on
// master, and the `v0.6.0` the GitHub release job creates. They are one
// version. Prereleases (`0.7.0-develop.12`) are npm dist-tags, never git tags,
// and are not releases.
function releasedVersions(): string[] | null {
  let raw: string;
  try {
    raw = execFileSync("git", ["tag"], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  const versions = new Set<string>();
  for (const tag of raw.split("\n")) {
    const trimmed = tag.trim().replace(/^v/, "");
    if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
      versions.add(trimmed);
    }
  }
  return versions.size > 0 ? [...versions] : null;
}

describe("CHANGELOG.md structure", () => {
  it("opens with an Unreleased section, above every released version", () => {
    const lines = changelogLines();
    const unreleased = lines.findIndex((line) => line.trim() === UNRELEASED_HEADING);
    expect(unreleased, `no "${UNRELEASED_HEADING}" heading`).toBeGreaterThan(-1);

    const firstVersion = lines.findIndex((line) => VERSION_HEADING.test(line));
    expect(firstVersion, "no released version section").toBeGreaterThan(-1);
    // A release renames this heading and opens a fresh one, so anything filed
    // under it after a version section would silently join the wrong release.
    expect(unreleased).toBeLessThan(firstVersion);
  });

  it("dates every version heading and rejects a malformed one", () => {
    const sections = versionSections();
    expect(sections.length, "no version headings matched `## [X.Y.Z] - YYYY-MM-DD`").toBeGreaterThan(0);

    // Catches the shape the file shipped with: `## [0.1.0] - Initial Release`.
    const malformed = changelogLines()
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => line.startsWith("## [") && line.trim() !== UNRELEASED_HEADING)
      .filter(({ line }) => !VERSION_HEADING.test(line));
    expect(malformed, "version headings must read `## [X.Y.Z] - YYYY-MM-DD`").toEqual([]);

    for (const section of sections) {
      expect(Number.isNaN(Date.parse(section.date)), `line ${section.line}: ${section.date}`).toBe(false);
    }
  });

  it("orders versions newest first, with dates that never move backwards", () => {
    const sections = versionSections();
    for (let i = 1; i < sections.length; i += 1) {
      const newer = sections[i - 1];
      const older = sections[i];
      expect(
        compareSemver(newer.version, older.version),
        `line ${older.line}: ${older.version} is not below ${newer.version}`,
      ).toBeGreaterThan(0);
      expect(
        Date.parse(newer.date) >= Date.parse(older.date),
        `line ${older.line}: ${older.version} (${older.date}) is dated after ${newer.version} (${newer.date})`,
      ).toBe(true);
    }
  });

  it("groups bullets under Keep a Changelog categories only", () => {
    const unknown = changelogLines()
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => CATEGORY_HEADING.test(line))
      .map(({ line, number }) => ({ category: (CATEGORY_HEADING.exec(line) as RegExpExecArray)[1], number }))
      .filter(({ category }) => !CATEGORIES.has(category));
    expect(unknown, `allowed categories: ${[...CATEGORIES].join(", ")}`).toEqual([]);
  });

  it("has a section for every released tag", () => {
    const released = releasedVersions();
    if (released === null) {
      // A shallow clone has no tags. Failing here would make the suite depend
      // on how the repository was fetched; CI checks out with fetch-depth: 0
      // and fetch-tags: true, so the assertion below does run where it counts.
      console.warn("changelog: no semver git tags available, skipping the tag-coverage check");
      return;
    }
    const documented = new Set(versionSections().map((section) => section.version));
    const missing = released.filter((version) => !documented.has(version)).sort(compareSemver);
    expect(missing, "released versions with no CHANGELOG.md section").toEqual([]);
  });
});
