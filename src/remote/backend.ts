import type { RemoteType } from "../config/configStore.js";

export type Backend = RemoteType;

export const AZDO_GAP_DOC = "docs/azdo-gap.md";

/**
 * The single place that turns `remoteType` into a backend. An absent key is GitHub, the historical default;
 * only an explicit `azdo` selects Azure DevOps.
 */
export function selectBackend(config: { remoteType?: RemoteType }): Backend {
  return config.remoteType === "azdo" ? "azdo" : "gh";
}

export function isAzdo(config: { remoteType?: RemoteType }): boolean {
  return selectBackend(config) === "azdo";
}

/** The standard "not supported in Azure DevOps mode" sentence, always linking the gap document. */
export function azdoUnsupportedMessage(feature: string, detail?: string): string {
  const extra = detail ? ` ${detail}` : "";
  return `${feature} is not supported for Azure DevOps.${extra} See ${AZDO_GAP_DOC} for details.`;
}

/**
 * True only when `remoteType` is explicitly `gh`. Commands whose whole behaviour is remote-specific
 * (`implement-next`, `do-work`) demand it rather than defaulting an absent key to GitHub.
 */
export function isExplicitGitHub(config: { remoteType?: RemoteType }): boolean {
  return config.remoteType === "gh";
}
