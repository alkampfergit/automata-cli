import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// `docs/maintenance.md` tells maintainers that a production advisory blocks the
// release. That promise is one `package.json` line — `prepublishOnly` — and
// nothing else in the suite touches it, so it is the kind of thing that can be
// dropped in an unrelated manifest edit and stay unnoticed until a vulnerable
// version has already been published.

const PACKAGE_JSON = fileURLToPath(new URL("../../package.json", import.meta.url));

const AUDIT_PROD = "npm audit --omit=dev";

function packageScripts(): Record<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  const scripts = (parsed as { scripts?: Record<string, string> }).scripts;
  expect(scripts, "package.json declares no scripts").toBeDefined();
  return scripts ?? {};
}

describe("audit scripts", () => {
  it("audits only what ships under audit:prod", () => {
    // `--omit=dev` is the distinction that makes a blocking gate tolerable: it
    // reports advisories against `dependencies`, which tsup bundles into
    // dist/, and ignores the toolchain that never leaves the repository.
    expect(packageScripts()["audit:prod"]).toBe(AUDIT_PROD);
  });

  it("audits the whole tree under audit:all", () => {
    expect(packageScripts()["audit:all"]).toBe("npm audit");
  });

  it("does not weaken either audit with an audit-level threshold", () => {
    // FR-002: advisories are resolved or recorded, never silenced.
    // `--audit-level` does not hide anything -- a lower-severity advisory is
    // still printed in full. What it changes is the severity threshold that
    // produces a nonzero exit, so a low or moderate advisory could let the
    // publish gate proceed.
    const scripts = packageScripts();
    expect(scripts["audit:prod"]).not.toContain("--audit-level");
    expect(scripts["audit:all"]).not.toContain("--audit-level");
  });
});

describe("release gate", () => {
  it("runs the production audit before publishing", () => {
    // npm runs `prepublishOnly` first in the publish lifecycle, so a failure
    // aborts before the tarball is packed or the registry is contacted. The CI
    // `publish` job calls `npm publish`, which is what gives this teeth.
    expect(packageScripts()["prepublishOnly"]).toBe("npm run audit:prod");
  });

  it("does not gate on the full tree, which would block releases on dev advisories", () => {
    // A vitest or eslint advisory ships to nobody and often has no fix for
    // days; blocking the release on it would stall unrelated work.
    expect(packageScripts()["prepublishOnly"]).not.toContain("audit:all");
  });

  it("keeps the audit out of install- and build-time scripts", () => {
    // `npm audit` needs the registry. Wiring it into `prepublish`, `prepare`,
    // `preinstall` or `build` would make an offline install or build fail on a
    // network hiccup rather than on a real defect — and `prepublish` in
    // particular still runs on plain `npm install`.
    const scripts = packageScripts();
    for (const hook of ["prepublish", "prepare", "preinstall", "postinstall", "build", "pretest"]) {
      expect(scripts[hook] ?? "", `${hook} must not run an audit`).not.toContain("audit");
    }
  });
});
