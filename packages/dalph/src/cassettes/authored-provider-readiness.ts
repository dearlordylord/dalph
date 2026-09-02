import { Deferred, Effect, Option, Schema } from "effect"
import type { AttemptId, GitCommitSha, IntegrationTarget, PlannedAttemptExecutorReport, TaskId } from "@dalph/contracts"
import { IntegratorSessionCorrelation, type IntegratorCandidateText } from "@dalph/orchestrator"
import type { AuthoredScenarioCassette } from "./authored-domain.js"

type ReadinessRelation = NonNullable<AuthoredScenarioCassette["controlledProviderReadiness"]>[number]
type ReadinessTarget = { readonly attemptId: AttemptId; readonly taskId: TaskId }
type ExecutorReadinessRelation = NonNullable<AuthoredScenarioCassette["controlledExecutorReadiness"]>[number]
type IntegratorReadinessRelation = NonNullable<AuthoredScenarioCassette["controlledIntegratorReadiness"]>[number]
type IntegratorReadinessSource = IntegratorReadinessRelation["source"]
type ExecutorReadinessSource = {
  readonly candidateCommit: GitCommitSha
  readonly expectedTargetHead: GitCommitSha
  readonly integrationTarget: IntegrationTarget
}

const correlationEquivalence = Schema.toEquivalence(IntegratorSessionCorrelation)
const targetMatches = (left: ReadinessTarget, right: ReadinessTarget) =>
  left.attemptId === right.attemptId && left.taskId === right.taskId

/** One decoded cassette's controlled external-provider readiness gates. */
type AuthoredProviderReadiness = {
  readonly awaitTarget: (target: ReadinessTarget) => Effect.Effect<void>
  readonly awaitIntegratorTarget: (correlation: IntegratorSessionCorrelation) => Effect.Effect<void>
  readonly assertAllReleased: () => Effect.Effect<void>
  readonly pollIntegratorTarget: (correlation: IntegratorSessionCorrelation) => Effect.Effect<Option.Option<void>>
  readonly pollTarget: (target: ReadinessTarget) => Effect.Effect<Option.Option<void>>
  readonly releaseIntegratorSource: (source: IntegratorReadinessSource) => Effect.Effect<boolean>
  readonly releaseSource: (
    correlation: IntegratorSessionCorrelation,
    candidateText: IntegratorCandidateText
  ) => Effect.Effect<boolean>
}

/** One decoded cassette's exact successful-promotion to initial-Begin gates. */
type AuthoredExecutorReadiness = {
  readonly assertAllReleased: () => Effect.Effect<void>
  readonly awaitTarget: (target: ReadinessTarget) => Effect.Effect<void>
  readonly pollTarget: (target: ReadinessTarget) => Effect.Effect<Option.Option<void>>
  readonly releaseSource: (source: ExecutorReadinessSource) => Effect.Effect<boolean>
}

/** Runs one controlled executor call only after its exact authored readiness source has settled. */
export const afterAuthoredExecutorReadiness = <A, E, R>(
  readiness: AuthoredExecutorReadiness,
  target: ReadinessTarget,
  call: Effect.Effect<A, E, R>
) => readiness.awaitTarget(target).pipe(Effect.andThen(call))

/** Releases Integrator readiness only after the ordinary journal accepted this exact work report. */
export const releaseAuthoredIntegratorReadinessFromAcceptedWorkReport = (
  readiness: AuthoredProviderReadiness,
  report: PlannedAttemptExecutorReport
): Effect.Effect<boolean> =>
  report._tag === "ExecutorWorkTerminal" && report.result._tag === "Accepted"
    ? readiness.releaseIntegratorSource({
        acceptedCommit: report.result.acceptedResult.commit,
        attemptId: report.correlation.attemptId
      })
    : Effect.succeed(false)

/** Allocates test-only Deferreds; it never changes the production workflow or its dependency graph. */
export const makeAuthoredProviderReadiness = Effect.fn("AuthoredCassette.makeProviderReadiness")(function* (
  relations: ReadonlyArray<ReadinessRelation>,
  integratorRelations: ReadonlyArray<IntegratorReadinessRelation> = []
): Effect.fn.Return<AuthoredProviderReadiness> {
  const entries = yield* Effect.forEach(relations, (relation) =>
    Effect.gen(function* () {
      return { gate: yield* Deferred.make<void>(), relation }
    })
  )
  const entryForTarget = (target: ReadinessTarget) =>
    entries.find(({ relation }) => targetMatches(relation.target, target))
  const integratorEntries = yield* Effect.forEach(integratorRelations, (relation) =>
    Effect.gen(function* () {
      return { gate: yield* Deferred.make<void>(), relation }
    })
  )
  const entryForIntegratorTarget = (correlation: IntegratorSessionCorrelation) =>
    integratorEntries.find(({ relation }) => correlationEquivalence(relation.target.correlation, correlation))

  return {
    awaitTarget: (target) => {
      const entry = entryForTarget(target)
      return entry === undefined ? Effect.void : Deferred.await(entry.gate)
    },
    assertAllReleased: () =>
      Effect.forEach(
        [
          ...entries.map(({ gate, relation }) => ({
            detail: `${relation.target.taskId}/${relation.target.attemptId}`,
            gate
          })),
          ...integratorEntries.map(({ gate, relation }) => ({
            detail: `Integrator ${relation.target.correlation.plannedAttempt.taskId}/${relation.target.correlation.plannedAttempt.attemptId}`,
            gate
          }))
        ],
        ({ detail, gate }) =>
          Deferred.poll(gate).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.die(`controlled provider readiness was not released for ${detail}`),
                onSome: () => Effect.void
              })
            )
          ),
        { discard: true }
      ),
    awaitIntegratorTarget: (correlation) => {
      const entry = entryForIntegratorTarget(correlation)
      return entry === undefined ? Effect.void : Deferred.await(entry.gate)
    },
    pollIntegratorTarget: (correlation) => {
      const entry = entryForIntegratorTarget(correlation)
      return entry === undefined
        ? Effect.succeed(Option.none())
        : Deferred.poll(entry.gate).pipe(Effect.map(Option.map(() => undefined)))
    },
    pollTarget: (target) => {
      const entry = entryForTarget(target)
      return entry === undefined
        ? Effect.succeed(Option.none())
        : Deferred.poll(entry.gate).pipe(Effect.map(Option.map(() => undefined)))
    },
    releaseSource: (correlation, candidateText) => {
      const entry = entries.find(
        ({ relation }) =>
          relation.source.candidateText === candidateText &&
          correlationEquivalence(relation.source.correlation, correlation)
      )
      return entry === undefined ? Effect.succeed(false) : Deferred.succeed(entry.gate, undefined)
    },
    releaseIntegratorSource: (source) => {
      const entry = integratorEntries.find(
        ({ relation }) =>
          relation.source.attemptId === source.attemptId && relation.source.acceptedCommit === source.acceptedCommit
      )
      return entry === undefined ? Effect.succeed(false) : Deferred.succeed(entry.gate, undefined)
    }
  }
})

const executorSourceMatches = (left: ExecutorReadinessSource, right: ExecutorReadinessSource) =>
  left.candidateCommit === right.candidateCommit &&
  left.expectedTargetHead === right.expectedTargetHead &&
  left.integrationTarget.repository === right.integrationTarget.repository &&
  left.integrationTarget.ref === right.integrationTarget.ref

/** Allocates a distinct gate at the executor boundary; worktree readiness remains independently controlled. */
export const makeAuthoredExecutorReadiness = Effect.fn("AuthoredCassette.makeExecutorReadiness")(function* (
  relations: ReadonlyArray<ExecutorReadinessRelation>
): Effect.fn.Return<AuthoredExecutorReadiness> {
  const entries = yield* Effect.forEach(relations, (relation) =>
    Effect.gen(function* () {
      return { gate: yield* Deferred.make<void>(), relation }
    })
  )
  const entryForTarget = (target: ReadinessTarget) =>
    entries.find(({ relation }) => targetMatches(relation.target, target))

  return {
    assertAllReleased: () =>
      Effect.forEach(
        entries,
        ({ gate, relation }) =>
          Deferred.poll(gate).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.die(
                    `controlled executor readiness was not released for ${relation.target.taskId}/${relation.target.attemptId}`
                  ),
                onSome: () => Effect.void
              })
            )
          ),
        { discard: true }
      ),
    awaitTarget: (target) => {
      const entry = entryForTarget(target)
      return entry === undefined ? Effect.void : Deferred.await(entry.gate)
    },
    pollTarget: (target) => {
      const entry = entryForTarget(target)
      return entry === undefined
        ? Effect.succeed(Option.none())
        : Deferred.poll(entry.gate).pipe(Effect.map(Option.map(() => undefined)))
    },
    releaseSource: (source) => {
      const entry = entries.find(({ relation }) => executorSourceMatches(relation.source, source))
      return entry === undefined ? Effect.succeed(false) : Deferred.succeed(entry.gate, undefined)
    }
  }
})
