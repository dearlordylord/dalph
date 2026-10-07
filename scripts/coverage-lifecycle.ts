/* eslint-disable import/no-nodejs-modules -- Test diagnostics bypass Vitest's buffered console capture. */
import { writeSync } from "node:fs"
import { Clock, Effect } from "effect"

/** One bounded observation per lifecycle edge; no prompts, errors or event payloads. */
export interface CoverageLifecycleObservation {
  readonly phase:
    | "ModuleQueued"
    | "ModuleStarted"
    | "ModuleFinished"
    | "TestStarted"
    | "TestFinished"
    | "ScopeFinalizationStarted"
    | "ScopeFinalizationFinished"
    | "WaitStarted"
    | "WaitFinished"
    | "WaitTimedOut"
  readonly owner: string
  readonly testId?: string
  readonly file?: string
  readonly boundary?: string
  readonly timeoutMilliseconds?: number
  readonly outcome?: string
}

export const encodeCoverageLifecycle = (observation: CoverageLifecycleObservation): string => {
  const bounded = (value: string | undefined, limit: number) => value?.slice(0, limit)
  const fields: ReadonlyArray<readonly [string | undefined, number]> = [
    [observation.owner, 160],
    [observation.file, 256],
    [observation.testId, 64],
    [observation.boundary, 128],
    [observation.outcome, 32]
  ]
  const omittedCharacters = fields.reduce((sum, [value, limit]) => sum + Math.max(0, (value?.length ?? 0) - limit), 0)
  return JSON.stringify({
    _tag: "CoverageLifecycle",
    phase: observation.phase,
    observedAt: new Date(Effect.runSync(Clock.currentTimeMillis)).toISOString(),
    owner: bounded(observation.owner, 160),
    testId: bounded(observation.testId, 64),
    file: bounded(observation.file, 256),
    boundary: bounded(observation.boundary, 128),
    outcome: bounded(observation.outcome, 32),
    timeoutMilliseconds: observation.timeoutMilliseconds,
    omittedCharacters
  })
}

export const writeCoverageLifecycle = (observation: CoverageLifecycleObservation): void => {
  writeSync(2, `\n${encodeCoverageLifecycle(observation)}\n`)
}
