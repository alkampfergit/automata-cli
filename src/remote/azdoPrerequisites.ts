import { spawnSync } from "node:child_process";

export const MIN_AZDO_VERSION = "0.20.0";

/** Keeps the update banner out of any output we parse. */
export const AZDO_NO_UPDATE_CHECK = "--no-update-check";

export type AzdoPrerequisite =
  | { ok: true; version: string; identity: string }
  | { ok: false; reason: "missing" | "too-old" | "unauthenticated"; message: string };

type Runner = (args: string[]) => { stdout: string; stderr: string; status: number; missing?: boolean };

function defaultRunner(args: string[]): ReturnType<Runner> {
  // Resolving `azdo` through PATH is the point of the "on PATH" prerequisite.
  const result = spawnSync("azdo", args, { encoding: "utf8" }); // NOSONAR
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
    missing: code === "ENOENT",
  };
}

export interface ParsedVersion {
  parts: number[];
  /** SemVer prerelease tag (`beta.1` in `0.20.0-beta.1`), or `null` for a stable release. */
  prerelease: string | null;
}

export function parseVersion(text: string): ParsedVersion | null {
  // Bounded quantifiers keep the match linear on hostile input.
  const match = /(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,64}))?/.exec(text);
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ?? null };
}

/** SemVer precedence: a prerelease sorts below the stable release with the same numbers. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] < b.parts[i] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

function formatVersion(v: ParsedVersion): string {
  return v.parts.join(".") + (v.prerelease ? `-${v.prerelease}` : "");
}

function extractIdentity(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { identity?: unknown };
    const id = parsed.identity;
    if (typeof id === "string" && id) return id;
    if (id && typeof id === "object") {
      const o = id as Record<string, unknown>;
      for (const key of ["displayName", "uniqueName", "providerDisplayName", "id"]) {
        if (typeof o[key] === "string" && o[key]) return o[key] as string;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/** `azdo` on PATH, at least 0.20.0, and authenticated. The first failing check wins. */
export function checkAzdoPrerequisites(run: Runner = defaultRunner): AzdoPrerequisite {
  const v = run(["--version", AZDO_NO_UPDATE_CHECK]);
  if (v.missing) {
    return { ok: false, reason: "missing", message: "`azdo` CLI is not installed or not on PATH." };
  }
  const version = v.status === 0 ? parseVersion(v.stdout) : null;
  if (!version) {
    return { ok: false, reason: "missing", message: "Could not determine the `azdo` CLI version (`azdo --version`)." };
  }
  const min = parseVersion(MIN_AZDO_VERSION) as ParsedVersion;
  if (compareVersions(version, min) < 0) {
    return {
      ok: false,
      reason: "too-old",
      message: `azdo-cli ${formatVersion(version)} is too old; ${MIN_AZDO_VERSION} or newer is required.`,
    };
  }
  const auth = run(["auth", "diagnose", "--json", AZDO_NO_UPDATE_CHECK]);
  const identity = auth.status === 0 ? extractIdentity(auth.stdout) : null;
  if (!identity) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: "`azdo` is not authenticated. Run `azdo auth login` and check `azdo auth diagnose`.",
    };
  }
  return { ok: true, version: formatVersion(version), identity };
}
