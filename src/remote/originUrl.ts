export interface GitHubOrigin {
  kind: "github";
  owner: string;
  repo: string;
}

export interface AzdoOrigin {
  kind: "azdo";
  organization: string;
  project: string;
  repo: string;
}

export type ParsedOrigin = GitHubOrigin | AzdoOrigin;

function strip(name: string): string {
  return decodeURIComponent(name).replace(/\.git$/, "");
}

/** Runs `parse`, treating malformed percent-encoding (a `URIError`) as "not recognised". */
function orNull<T>(parse: () => T | null): T | null {
  try {
    return parse();
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

function parseGitHub(url: string): GitHubOrigin | null {
  const match =
    /^(?:https?:\/\/(?:[^@/]+@)?(?:www\.)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(
      url,
    );
  return match ? { kind: "github", owner: match[1], repo: match[2] } : null;
}

function parseAzdo(url: string): AzdoOrigin | null {
  // https://dev.azure.com/{org}/{project}/_git/{repo}, optionally with `user@` before the host
  const dev = /^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)\/?$/.exec(url);
  if (dev) {
    return { kind: "azdo", organization: strip(dev[1]), project: strip(dev[2]), repo: strip(dev[3]) };
  }
  // https://{org}.visualstudio.com/[DefaultCollection/]{project}/_git/{repo}
  const vs = /^https?:\/\/(?:[^@/]+@)?([^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)\/?$/i.exec(
    url,
  );
  if (vs) {
    return { kind: "azdo", organization: strip(vs[1]), project: strip(vs[2]), repo: strip(vs[3]) };
  }
  // git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const ssh = /^(?:ssh:\/\/)?(?:[^@/]+@)?ssh\.dev\.azure\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/?#]+?)\/?$/.exec(url);
  if (ssh) {
    return { kind: "azdo", organization: strip(ssh[1]), project: strip(ssh[2]), repo: strip(ssh[3]) };
  }
  return null;
}

/** Recognises a GitHub or Azure DevOps remote URL; anything else is `null`. */
export function parseOrigin(rawUrl: string): ParsedOrigin | null {
  const url = rawUrl.trim();
  return orNull(() => parseAzdo(url) ?? parseGitHub(url));
}

export function parseAzdoOrigin(rawUrl: string): AzdoOrigin | null {
  const parsed = parseOrigin(rawUrl);
  return parsed?.kind === "azdo" ? parsed : null;
}
