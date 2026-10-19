import type { CiCheck, PrSurface } from "../github/ghWorkService.js";
import { BLOCKED_LABEL } from "./loopSafety.js";

/**
 * The `conductor-ready` label tells a person that a pull request can be reviewed and closed. automata
 * applies it, not the model, and it posts no comment. The rule is pure: the caller reads the pull request.
 */

export const READY_LABEL = "conductor-ready";

export const READY_LABEL_DESCRIPTION = "The conductor found this pull request ready for a person to review and merge";

/** The conclusions of a finished check that mean the build is broken. */
const BROKEN_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED", "ERROR", "STARTUP_FAILURE"]);

/** Every check is finished and none is broken. No check at all is not proof of a green build. */
function checksAreGreen(checks: CiCheck[]): boolean {
  return (
    checks.length > 0 &&
    checks.every((check) => check.status === "COMPLETED" && check.conclusion !== null && !BROKEN_CONCLUSIONS.has(check.conclusion))
  );
}

/**
 * `itemLabels` are the labels of the watched item, which may be an issue. Open, not a draft, not in conflict, no unresolved review thread, green checks, and not blocked.
 * No approving review is needed.
 */
export function isReady(surface: PrSurface, checks: CiCheck[], itemLabels: string[] = []): boolean {
  const labels = [...(surface.pr.labels ?? []), ...itemLabels].map((label) => label.toLowerCase());
  return (
    surface.pr.state === "OPEN" &&
    !surface.pr.isDraft &&
    surface.pr.mergeable !== "CONFLICTING" &&
    surface.threads.length === 0 &&
    !labels.includes(BLOCKED_LABEL) &&
    checksAreGreen(checks)
  );
}

export type ReadyChange = "add" | "remove" | null;

/** The label change a pull request needs: add when ready and unlabelled, remove when not ready and labelled. */
export function readyLabelChange(surface: PrSurface, checks: CiCheck[], itemLabels: string[] = []): ReadyChange {
  const labelled = (surface.pr.labels ?? []).some((label) => label.toLowerCase() === READY_LABEL);
  const ready = isReady(surface, checks, itemLabels);
  if (ready && !labelled) return "add";
  if (!ready && labelled) return "remove";
  return null;
}
