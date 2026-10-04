import type { AutomataConductorConfig, Executor } from "../config/configStore.js";

/** What the conductor runs: the CLI, and the model and effort that CLI is given. */
export interface ConductorExecution {
  executor: Executor;
  model?: string;
  effort?: string;
}

const EXECUTORS: readonly string[] = ["claude", "codex"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containerProblem(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return `conductor.${name} must be an object, got ${JSON.stringify(value)}.`;
  for (const [key, entry] of Object.entries(value)) {
    if (!EXECUTORS.includes(key)) {
      return `conductor.${name}.${key} is not a recognised setting; expected one of: ${EXECUTORS.join(", ")}.`;
    }
    if (entry !== undefined && typeof entry !== "string") {
      return `conductor.${name}.${key} must be a string, got ${JSON.stringify(entry)}.`;
    }
  }
  return null;
}

/** Hand-edited JSON: the reason the executor settings are unusable, or null. */
export function conductorExecutionProblem(conductor: AutomataConductorConfig | undefined): string | null {
  const executor: unknown = conductor?.executor;
  if (executor !== undefined && executor !== null && (typeof executor !== "string" || !EXECUTORS.includes(executor))) {
    return `conductor.executor must be one of: ${EXECUTORS.join(", ")}; got ${JSON.stringify(executor)}.`;
  }
  return containerProblem(conductor?.models, "models") ?? containerProblem(conductor?.effort, "effort");
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/**
 * The executor is `conductor.executor`, else Claude. The model and effort are
 * the ones configured for that executor: a value valid for one CLI is not for
 * the other, so they are never shared.
 */
export function resolveConductorExecution(conductor: AutomataConductorConfig | undefined): ConductorExecution {
  const executor = conductor?.executor ?? "claude";
  return {
    executor,
    model: clean(conductor?.models?.[executor]),
    effort: clean(conductor?.effort?.[executor]),
  };
}

export function describeConductorExecution(execution: ConductorExecution): string {
  const model = execution.model === undefined ? " (no model override)" : ` · model ${execution.model}`;
  const effort = execution.effort === undefined ? "" : ` · effort ${execution.effort}`;
  return `${execution.executor}${model}${effort}`;
}
