/* eslint-disable import/no-nodejs-modules -- Test diagnostics bypass Vitest's buffered console capture. */
import { writeSync } from "node:fs"
import { availableParallelism, loadavg } from "node:os"
import process from "node:process"
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
  const lifecycle = encodeCoverageLifecycle(observation)
  if (process.env["DALPH_COVERAGE_RESOURCE_OBSERVATIONS"] !== "1") {
    writeSync(2, `\n${lifecycle}\n`)
    return
  }
  // Reporter edges describe its process; wait/scope edges describe the executing worker.
  // CPU values are cumulative for this PID, and load is a host-wide gauge, not attribution.
  const cpu = process.cpuUsage()
  const resources = JSON.stringify({
    _tag: "CoverageResources",
    observedAt: new Date(Effect.runSync(Clock.currentTimeMillis)).toISOString(),
    phase: observation.phase,
    owner: observation.owner.slice(0, 160),
    processId: process.pid,
    testId: observation.testId?.slice(0, 64),
    userCpuMicroseconds: cpu.user,
    systemCpuMicroseconds: cpu.system,
    residentBytes: process.memoryUsage.rss(),
    parallelism: availableParallelism(),
    loadAverageOneMinute: loadavg()[0]
  })
  // Write both rows together; PID and labels keep the resource observation scoped.
  writeSync(2, `\n${lifecycle}\n${resources}\n`)
}
