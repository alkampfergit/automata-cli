import { describe, it, expect } from "vitest";
import {
  TRUNK_CANDIDATES,
  describeTrunkSource,
  parseLsRemoteSymref,
  parseOriginHeadRef,
  unresolvedTrunkMessage,
} from "../../src/git/trunkDetection.js";

// ── Pure trunk-name parsing ──────────────────────────────────────────────────
//
// The sample outputs below were captured from real `git` runs against a full
// clone and a `git clone --single-branch --branch develop` clone.

describe("parseOriginHeadRef", () => {
  it("strips the remote-tracking prefix", () => {
    expect(parseOriginHeadRef("refs/remotes/origin/master\n")).toBe("master");
  });

  it("keeps a slash-bearing branch name intact", () => {
    expect(parseOriginHeadRef("refs/remotes/origin/release/next\n")).toBe("release/next");
  });

  it("returns null for the empty output a --single-branch clone produces", () => {
    expect(parseOriginHeadRef("")).toBeNull();
  });

  it("returns null when the ref is not a remote-tracking ref", () => {
    expect(parseOriginHeadRef("refs/heads/master\n")).toBeNull();
  });

  it("returns null when the prefix is present but the name is empty", () => {
    expect(parseOriginHeadRef("refs/remotes/origin/\n")).toBeNull();
  });
});

describe("parseLsRemoteSymref", () => {
  it("reads the branch out of the tab-separated symref line", () => {
    const stdout = "ref: refs/heads/master\tHEAD\n0f0dba2ba611de483fdccd0cbd843366c77f6a9e\tHEAD\n";
    expect(parseLsRemoteSymref(stdout)).toBe("master");
  });

  it("finds the symref line even when it is not first", () => {
    const stdout = "0f0dba2\tHEAD\nref: refs/heads/main\tHEAD\n";
    expect(parseLsRemoteSymref(stdout)).toBe("main");
  });

  it("returns null when the remote advertises no symref", () => {
    expect(parseLsRemoteSymref("0f0dba2\tHEAD\n")).toBeNull();
  });

  it("returns null on empty output", () => {
    expect(parseLsRemoteSymref("")).toBeNull();
  });
});

describe("TRUNK_CANDIDATES", () => {
  it("probes main before master", () => {
    expect(TRUNK_CANDIDATES).toEqual(["main", "master"]);
  });
});

describe("describeTrunkSource", () => {
  it("names the config key when the value was configured", () => {
    expect(describeTrunkSource("config", "trunk")).toContain("git.trunkBranch");
  });

  it("distinguishes the two remote-HEAD sources", () => {
    expect(describeTrunkSource("origin-head", "main")).toBe("from origin/HEAD");
    expect(describeTrunkSource("ls-remote", "main")).toBe("from the remote's advertised HEAD");
  });

  it("names the branch it probed", () => {
    expect(describeTrunkSource("probe", "master")).toBe("probed as origin/master");
  });
});

describe("unresolvedTrunkMessage", () => {
  it("lists every candidate tried and points at the config setter", () => {
    const message = unresolvedTrunkMessage(["origin/HEAD", "origin/main", "origin/master"]);
    expect(message).toContain("origin/HEAD");
    expect(message).toContain("origin/main");
    expect(message).toContain("origin/master");
    expect(message).toContain("automata config set git-trunk-branch");
  });
});
