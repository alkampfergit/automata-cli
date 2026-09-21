/**
 * Refusing to release a version `CHANGELOG.md` does not document.
 *
 * Tag `0.8.0` was pushed with its entry still sitting under `## [Unreleased]`.
 * Nothing refused the release; `tests/unit/changelog.test.ts` noticed afterwards
 * and, because git tags are repository-wide, failed every branch at once — and
 * since CI's `build` gates `publish`, the release itself never shipped. This
 * module is what turns that into a refusal before the tag exists.
 *
 * Shaped like `releaseVersion.ts`: the decision is pure and free of `spawnSync`,
 * so every branch is testable without a repository, and the one function that
 * touches the filesystem is a silent `try`/`catch` taking the directory as a
 * defaulted parameter.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHANGELOG_FILE = "CHANGELOG.md";

/**
 * Keep a Changelog 1.1.0, matched per line, capturing the version so it can be
 * compared rather than interpolated — a pattern built from the argument would
 * have to escape it, and there is nothing to gain from that here.
 *
 * Deliberately the same shape as the pattern in `tests/unit/changelog.test.ts`:
 * this gate exists to keep that test green, so anything it accepts that the test
 * rejects would let a release through into the red build it is meant to prevent.
 * The two copies are not shared on purpose — a test that imports the code it
 * validates stops being an independent check.
 */
const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/;

export type ChangelogGateResult = { ok: true } | { ok: false; message: string };

/**
 * `changelog` is `null` when the repository keeps none, which passes: `automata`
 * is published for use against arbitrary repositories and must not invent a
 * changelog requirement for them.
 */
export function checkChangelogSection(version: string, changelog: string | null): ChangelogGateResult {
  if (changelog === null) {
    return { ok: true };
  }

  const documented = changelog
    .split("\n")
    .map((line) => VERSION_HEADING.exec(line.trimEnd()))
    .some((match) => match !== null && match[1] === version);
  if (documented) {
    return { ok: true };
  }

  return {
    ok: false,
    message:
      `${CHANGELOG_FILE} has no section for ${version}. ` +
      `Add a '## [${version}] - YYYY-MM-DD' heading — rename the current '## [Unreleased]' heading to it and open a ` +
      "fresh, empty '## [Unreleased]' above — then commit and re-run. " +
      "See docs/maintenance.md#what-a-release-does-to-it.",
  };
}

/** `null` for an absent or unreadable file; the gate treats both as "no changelog". */
export function readChangelog(dir: string = process.cwd()): string | null {
  try {
    return readFileSync(join(dir, CHANGELOG_FILE), "utf8");
  } catch {
    return null;
  }
}
