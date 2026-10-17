import type { AutomataConfig } from "../config/configStore.js";
import {
  applyDiscovery,
  closeIssue,
  getStorySource,
  type OpenPrLinkMap,
  type StorySource,
} from "../github/ghWorkService.js";
import { describeChild, planStory, storyDoneComment, storyLines, type Discovery, type StoryChild, type StoryPlan } from "./story.js";
import { readStories, writeStories } from "./watchStore.js";
import { withoutWatched } from "./watchList.js";
import type { StoryCheck } from "./checkReport.js";

/** The I/O of a story: read it, act on it. The rules are in `story.ts`. */

export function discoveryOf(config: AutomataConfig): Discovery | null {
  const technique = config.issueDiscoveryTechnique;
  if (technique === undefined) return null;
  return { technique, value: (config.issueDiscoveryValue ?? "").trim() };
}

interface StoryRead {
  source: StorySource;
  children: StoryChild[];
  plan: StoryPlan;
}

/** Read a story the way a tick does. With no discovery setting, no child counts as started. */
export function readStory(id: number, discovery: Discovery | null, linkMap: () => OpenPrLinkMap): StoryRead {
  const source = getStorySource(id);
  const children: StoryChild[] = source.children.map((child) => ({
    ...child,
    openPrs: source.state === "open" ? (linkMap().byIssue.get(child.number) ?? []).map((pr) => pr.number) : [],
  }));
  return { source, children, plan: planStory(children, discovery ?? { technique: "label", value: "" }) };
}

/** Change the stories as they are on disk now, so a concurrent `add` is not overwritten. */
function updateStories(change: (current: number[]) => number[]): void {
  const current = readStories();
  const next = change(current);
  if (next.length !== current.length || next.some((id, i) => id !== current[i])) writeStories(next);
}

function drop(id: number, why: string): void {
  updateStories((current) => withoutWatched(current, id));
  process.stdout.write(`Conductor: dropped story #${String(id)} from the stories (${why}).\n`);
}

type StoryResult = "kept" | "dropped" | "failed";

function fail(id: number, err: unknown): StoryResult {
  process.stderr.write(`Error: story #${String(id)} could not be conducted: ${(err as Error).message}\n`);
  return "failed";
}

function conductStory(id: number, discovery: Discovery | null, linkMap: () => OpenPrLinkMap, dryRun: boolean): StoryResult {
  let read: StoryRead;
  try {
    read = readStory(id, discovery, linkMap);
  } catch (err) {
    // As for an item: an id that cannot be read stays, a network error must not empty the list.
    return fail(id, err);
  }
  const { source, children, plan } = read;
  const would = dryRun ? "a tick would " : "";
  if (source.state === "closed") {
    if (dryRun) process.stdout.write(`Conductor: story #${String(id)} is closed; a tick would drop it from the stories.\n`);
    else drop(id, "closed");
    return dryRun ? "kept" : "dropped";
  }
  const label = `story #${String(id)}`;
  try {
    switch (plan.action) {
      case "complete":
        if (dryRun) {
          process.stdout.write(`Conductor: ${label}: all children are closed; ${would}close it.\n`);
          return "kept";
        }
        closeIssue(id, storyDoneComment(children));
        drop(id, "all children closed, parent closed");
        return "dropped";
      case "start": {
        const current = plan.current as StoryChild;
        if (discovery === null || (discovery.technique !== "title-contains" && discovery.value.length === 0)) {
          throw new Error("No usable issue discovery setting. Run `automata config`.");
        }
        if (dryRun) {
          process.stdout.write(`Conductor: ${label}: ${would}start child #${String(current.number)}.\n`);
          return "kept";
        }
        applyDiscovery({ number: current.number, kind: "issue", state: "open", title: current.title, labels: current.labels }, discovery.technique, discovery.value);
        process.stdout.write(`Conductor: ${label}: started child #${String(current.number)}.\n`);
        return "kept";
      }
      case "empty":
      case "wait":
      case "blocked":
        process.stdout.write(`Conductor: ${label}: ${storyLines(plan, children)[0]}.\n`);
        return "kept";
    }
  } catch (err) {
    return fail(id, err);
  }
}

/** The stories part of a tick (or a dry run): `failed` counts the stories that could not be conducted, `open` those that remain. */
export function conductStories(config: AutomataConfig, linkMap: () => OpenPrLinkMap, dryRun: boolean): { failed: number; open: number } {
  const discovery = discoveryOf(config);
  const results = readStories().map((id) => conductStory(id, discovery, linkMap, dryRun));
  return {
    failed: results.filter((r) => r === "failed").length,
    open: results.filter((r) => r !== "dropped").length,
  };
}

/** Read-only: what `--check` reports for each story. */
export function checkStories(config: AutomataConfig, linkMap: () => OpenPrLinkMap): StoryCheck[] {
  const discovery = discoveryOf(config);
  return readStories().map((id): StoryCheck => {
    try {
      const { source, children, plan } = readStory(id, discovery, linkMap);
      if (source.state === "closed") return { id, title: source.title, state: "closed", lines: [] };
      return { id, title: source.title, state: "open", lines: storyLines(plan, children) };
    } catch (err) {
      return { id, unavailable: (err as Error).message };
    }
  });
}

/** `conductor list`: one block per story. */
export function listStoryLines(config: AutomataConfig, linkMap: () => OpenPrLinkMap): string[] {
  const discovery = discoveryOf(config);
  return readStories().flatMap((id) => {
    try {
      const { source, children, plan } = readStory(id, discovery, linkMap);
      const head = `story #${String(id)} (${source.state}, ${children.length} children via ${source.via}): ${source.title}`;
      return [head, ...children.map((child, i) => `  ${describeChild(child, plan.statuses[i])}`)];
    } catch (err) {
      return [`story #${String(id)}: unavailable (${(err as Error).message})`];
    }
  });
}
