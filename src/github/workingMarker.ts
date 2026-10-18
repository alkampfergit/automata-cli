/**
 * The text of the marker comment that `do-work` posts before each model run. The
 * conductor must recognise it, so both use this one constant.
 */
export const WORKING_MARKER = "automata do-work: working…";

/** True when a comment body is the in-flight marker (a later explanation replaces the text, so it no longer matches). */
export function isWorkingMarker(body: string): boolean {
  return body.trimStart().startsWith(WORKING_MARKER);
}
