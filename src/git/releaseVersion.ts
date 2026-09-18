/**
 * Deciding which version a release publishes under.
 *
 * Kept apart from `gitService.ts` and free of `spawnSync`: the tag lookup
 * arrives as a thunk, so every branch here — a malformed explicit argument, a
 * trunk with no semver tag, the minor bump — is testable without a repository.
 * The thunk stays lazy because an explicit version must not cost a `git
 * describe`.
 */
import { bumpMinorVersion } from "./gitService.js";

const SEMVER_ARG_RE = /^\d+\.\d+\.\d+$/;

export type ReleaseVersionResolution =
  /** `notice` is the line to print when the version was inferred rather than given. */
  | { ok: true; version: string; notice: string | null }
  | { ok: false; message: string };

export function resolveReleaseVersion(
  requested: string | undefined,
  trunkRef: string,
  latestTag: () => string | null,
): ReleaseVersionResolution {
  if (requested !== undefined) {
    if (!SEMVER_ARG_RE.test(requested)) {
      return {
        ok: false,
        message: `Version '${requested}' is not valid semver. Use X.Y.Z format (e.g. 1.2.0).`,
      };
    }
    return { ok: true, version: requested, notice: null };
  }

  const latest = latestTag();
  if (latest === null) {
    return {
      ok: false,
      message:
        `No semver tag found on ${trunkRef}. ` +
        "Pass a version explicitly: automata git publish-release <X.Y.Z>",
    };
  }

  const version = bumpMinorVersion(latest);
  return { ok: true, version, notice: `Auto-detected version: ${latest} → ${version}` };
}
