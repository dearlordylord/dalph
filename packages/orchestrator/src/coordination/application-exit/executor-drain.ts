import {
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Data, Effect } from "effect"
import { Journal } from "../delivery/journal.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { ApplicationExitDrainFailure } from "./application-shell.js"
import { ApplicationExitDiagnostic, decideExecutorPosition } from "./lifecycle-decision.js"
import {
  latestPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { requestPlannedAttemptExecutorSuspensionWithoutReconciliation } from "../../workflow/protocols/planned-attempt-executor-work/guarded-protocol.js"

/** Whether Exit may issue the first suspension command or must preserve an earlier unresolved one. */
export type RunningAttemptForApplicationExit = Data.TaggedEnum<{
  ExecutorCommandAlreadyUnresolved: { readonly plannedAttempt: PlannedTaskAttempt }
  ReadyForSuspension: { readonly plannedAttempt: PlannedTaskAttempt }
}>

export const RunningAttemptForApplicationExit = Data.taggedEnum<RunningAttemptForApplicationExit>()

interface AttemptDrainResult {
  readonly correlations: ReadonlyArray<PlannedAttemptExecutorCorrelation>
  readonly diagnostics: ReadonlyArray<ApplicationExitDiagnostic>
}

/**
 * Finds exact unfinished responsibilities whose newest accepted executor
 * evidence is Running. It derives the set from Run history and allocates no
 * executor, operation, or replacement-attempt identity.
 */
export const runningAttemptsForApplicationExit = (state: {
  readonly records: ReadonlyArray<JournalRecord>
  readonly responsibilities: ReadonlyArray<WorkflowResponsibilityEntry>
}): ReadonlyArray<RunningAttemptForApplicationExit> =>
  state.responsibilities.flatMap((responsibility): ReadonlyArray<RunningAttemptForApplicationExit> => {
    if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") return []
    const plannedAttempt = responsibility.plannedAttempt
    if (latestUnsettledPlannedAttemptExecutorCommand(state.records, plannedAttempt) !== undefined) {
      return [RunningAttemptForApplicationExit.ExecutorCommandAlreadyUnresolved({ plannedAttempt })]
    }
    return latestPlannedAttemptExecutorEvidence(state.records, plannedAttempt)?.report._tag === "Running"
      ? [RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })]
      : []
  })

const diagnosticFor = (error: { readonly _tag?: string }): ApplicationExitDiagnostic =>
  ApplicationExitDiagnostic.make(
    `Executor suspension during application Exit failed: ${
      /* v8 ignore next -- every typed journal and executor failure carries an Effect tag. */
      error._tag ?? "UnknownExecutorSuspensionFailure"
    }`
  )

/**
 * Records the ordinary suspension intent, calls only requestSuspension, and
 * accepts only exact safe-or-terminal evidence. An unresolved intent or a
 * Running response deliberately remains pending until the shell's original
 * five-second deadline interrupts the drain.
 */
export const suspendRunningExecutorWorkForApplicationExit = Effect.fn(
  "ApplicationExitExecutorDrain.suspendRunningExecutorWork"
)(function* () {
  const journal = yield* Journal
  const state = yield* journal.state.get.pipe(
    Effect.mapError((error) => new ApplicationExitDrainFailure({ diagnostics: [diagnosticFor(error)] }))
  )
  const attempts = runningAttemptsForApplicationExit({
    records: state.records,
    responsibilities: state.reconstructed.responsibility.entries
  })
  return yield* suspendApplicationExitAttempts(attempts)
})

/** Executes the already-derived exact-attempt set through the ordinary journaled executor protocol. */
export const suspendApplicationExitAttempts = Effect.fn("ApplicationExitExecutorDrain.suspendAttempts")(function* (
  attempts: ReadonlyArray<RunningAttemptForApplicationExit>
) {
  const results = yield* Effect.forEach(
    attempts,
    (attempt) => {
      if (attempt._tag === "ExecutorCommandAlreadyUnresolved") return Effect.never
      const plannedAttempt = attempt.plannedAttempt
      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      return requestPlannedAttemptExecutorSuspensionWithoutReconciliation(plannedAttempt).pipe(
        Effect.flatMap((report) => {
          const position = decideExecutorPosition(correlation, report)
          return position._tag === "ReleasePosition" ? Effect.void : Effect.never
        }),
        Effect.catchTag("PlannedAttemptExecutorCommandReconciliationRequired", () => Effect.never),
        Effect.match({
          onFailure: (error): AttemptDrainResult => ({ correlations: [], diagnostics: [diagnosticFor(error)] }),
          onSuccess: (): AttemptDrainResult => ({ correlations: [correlation], diagnostics: [] })
        })
      )
    },
    { concurrency: Math.max(attempts.length, 1) }
  )
  const diagnostics = results.flatMap(({ diagnostics }) => diagnostics)
  const [first, ...remaining] = diagnostics
  if (first !== undefined) {
    return yield* new ApplicationExitDrainFailure({ diagnostics: [first, ...remaining] })
  }
  return results.flatMap(({ correlations }) => correlations)
})
