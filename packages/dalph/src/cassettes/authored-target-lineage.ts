import { Effect, Ref } from "effect"
import type { AttemptId, IntegrationTarget } from "@dalph/contracts"
import {
  GitTargetLineage,
  GitTargetLineageReadFailure,
  RemoteBaselineFailure,
  RemoteBaselineObservation,
  type TargetLineageObservation
} from "@dalph/orchestrator"

/** Controlled Git reads retain response order within an exact attempt, never across independent attempts. */
export const makeAuthoredAttemptTargetLineage = Effect.fn("AuthoredCassette.makeAttemptTargetLineage")(function* (
  entries: ReadonlyArray<{
    readonly attemptId: AttemptId
    readonly observations: ReadonlyArray<TargetLineageObservation>
  }>
) {
  const grouped = new Map(entries.map(({ attemptId, observations }) => [attemptId, observations] as const))
  if (grouped.size !== entries.length) return yield* Effect.die("authored lineage repeats an exact attempt identity")
  const remaining = yield* Ref.make<ReadonlyMap<AttemptId, ReadonlyArray<TargetLineageObservation>>>(grouped)
  const forAttempt = (attemptId: AttemptId): typeof GitTargetLineage.Service =>
    GitTargetLineage.of({
      read: (plannedBaseSha, target) =>
        Effect.gen(function* () {
          const next = yield* Ref.modify(remaining, (current) => {
            const responses = current.get(attemptId) ?? []
            const response = responses[0]
            return [
              response,
              response === undefined || response.plannedBaseSha !== plannedBaseSha
                ? current
                : new Map(current).set(attemptId, responses.slice(1))
            ] as const
          })
          if (next === undefined || next.plannedBaseSha !== plannedBaseSha)
            return yield* new GitTargetLineageReadFailure({
              detail:
                next === undefined
                  ? `no authored target-lineage response remains for ${attemptId}`
                  : `authored target-lineage response for ${attemptId} names a different planned Base SHA`,
              plannedBaseSha,
              target
            })
          return next
        })
    })
  const assertExhausted = Ref.get(remaining).pipe(
    Effect.flatMap((current) => {
      const incomplete = [...current].filter(([, responses]) => responses.length > 0)
      return incomplete.length === 0
        ? Effect.void
        : Effect.die(`unconsumed authored target-lineage responses for ${incomplete.map(([id]) => id).join(", ")}`)
    })
  )
  return { assertExhausted, forAttempt }
})

/** The controlled baseline needs the local ref head, read through the fixture's pinned Git observation Base. */
export const observeAuthoredRemoteBaseline = Effect.fn("AuthoredCassette.observeRemoteBaseline")(
  (
    lineage: Parameters<typeof GitTargetLineage.of>[0],
    observationBase: TargetLineageObservation["plannedBaseSha"],
    target: IntegrationTarget
  ) =>
    lineage.read(observationBase, target).pipe(
      Effect.map(({ targetHeadSha }) =>
        RemoteBaselineObservation.cases.Aligned.make({ localHead: targetHeadSha, remoteHead: targetHeadSha })
      ),
      Effect.mapError(() => new RemoteBaselineFailure({ reason: "TargetUnreadable" }))
    )
)
