import type { AttemptId, RunId } from "@dalph/contracts"
import {
  ApplicationExitShell,
  type ApplicationExitShellService,
  type DeliveryRelationInputBundle,
  type JournalRecord,
  RunReactivationOwner,
  type RunReactivationOwnerOptions,
  runReactivationOwnerLayer,
  type RunFinalityDecision
} from "@dalph/orchestrator"
import { Deferred, Effect, Layer, Ref } from "effect"
import { TestClock } from "effect/testing"
import type {
  Issue268Ds03BoundarySnapshot,
  Issue268Ds04Characterization
} from "./issue-268-controlled-characterization-types.js"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"
import { suspendCommandOrdinal } from "./issue-268-controlled-characterization-fixture.js"

const expectedSpecificationTaskIds = [scenario.taskIds.A, scenario.taskIds.B, scenario.taskIds.C]
const expectedClaimTaskIds = [scenario.taskIds.A, scenario.taskIds.C]
const expectedGitReads = ["A:ReadTaskWorktree", "A:ReadTargetLineage", "C:ReadTaskWorktree", "C:ReadTargetLineage"]
const expectedHeldAttemptIds = [scenario.attempts.A1, scenario.attempts.B1, scenario.attempts.C1].toSorted()

const hasExactMembers = (observed: ReadonlyArray<string>, expected: ReadonlyArray<string>) =>
  observed.length === expected.length &&
  new Set(observed).size === expected.length &&
  observed.every((item) => expected.includes(item))

export const isIssue268Ds04CheckpointPublication = (publication: DeliveryRelationInputBundle) =>
  publication.publication.graph._tag === "GraphEstablished" &&
  publication.publication.graph.observation.snapshot.revision === scenario.graphs.G1.revision &&
  publication.publication.exactEvidence.some(
    (evidence) =>
      evidence._tag === "ResponsibilityFacts" &&
      evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
      evidence.facts.responsibility.plannedAttempt.attemptId === scenario.attempts.B1 &&
      evidence.facts.disposition._tag === "PlannedAttemptExecutorSuspensionRequested"
  )

export const isIssue268Ds04CompleteCheckpoint = (
  publication: DeliveryRelationInputBundle,
  newRecords: ReadonlyArray<JournalRecord>,
  attemptId: AttemptId
) => {
  const specificationTaskIds = newRecords.flatMap(({ event }) =>
    event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
      ? [event.observation.factFamily.taskId]
      : []
  )
  const claimTaskIds = newRecords.flatMap(({ event }) =>
    event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskClaimFacts"
      ? [event.observation.coverage.taskId]
      : []
  )
  const gitReads = newRecords.flatMap(({ event }) =>
    event._tag === "GitReadIntentRecorded" ? [`${event.operation.plannedAttempt.taskId}:${event.operation._tag}`] : []
  )
  const heldAttemptIds = publication.actionInputs.runtimeFacts.taskWork.held
    .map(({ correlation }) => correlation.attemptId)
    .toSorted()
  const hasAuthorityGraphRead = newRecords.some(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.cause._tag === "ExecutingWorkAuthorityCheck"
  )
  const hasSuspendExecuting = newRecords.some(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
      event.plannedAttempt.attemptId === attemptId &&
      event.commandOrdinal === suspendCommandOrdinal &&
      event.report._tag === "ExecutorWorkExecuting"
  )
  return (
    isIssue268Ds04CheckpointPublication(publication) &&
    hasAuthorityGraphRead &&
    hasSuspendExecuting &&
    hasExactMembers(specificationTaskIds, expectedSpecificationTaskIds) &&
    hasExactMembers(claimTaskIds, expectedClaimTaskIds) &&
    hasExactMembers(gitReads, expectedGitReads) &&
    heldAttemptIds.join(",") === expectedHeldAttemptIds.join(",")
  )
}

// eslint-disable-next-line functional/no-mixed-types -- The controlled checkpoint groups immutable scenario facts with its test-only boundary controls.
export interface Issue268Ds04TimerCheckpointInput<E, R> {
  readonly activateActiveRefresh: (source: "TrackerNotification" | "Timer") => Effect.Effect<RunFinalityDecision, E, R>
  readonly applicationExit: ApplicationExitShellService
  readonly attemptId: AttemptId
  readonly beforeTimer: Issue268Ds03BoundarySnapshot
  readonly installObservers: RunReactivationOwnerOptions<E, R>["installAcceptedRunReactivationObservers"]
  readonly nextPublication: Effect.Effect<DeliveryRelationInputBundle, E, R>
  readonly readControl: RunReactivationOwnerOptions<E, R>["readControl"]
  readonly readRecords: Effect.Effect<ReadonlyArray<JournalRecord>, E, R>
  readonly releaseCheckpointPublication: Effect.Effect<void, never, R>
  readonly runId: RunId
  readonly snapshot: Effect.Effect<Issue268Ds03BoundarySnapshot, E, R>
  readonly startupDecision: RunFinalityDecision
}

interface Issue268Ds04LiveOwnerContinuation<A, E, R> {
  readonly awaitResult: Effect.Effect<A, E, R>
  readonly begin: Effect.Effect<void, never, R>
}

export interface Issue268Ds04TimerCheckpointResult<A> {
  readonly checkpoint: Issue268Ds04Characterization
  readonly continuation: A | undefined
}

/** Drives the real owner to the in-flight Suspend/Executing boundary; DS-05 owns its later settlement. */
export const runIssue268Ds04TimerCheckpoint = <
  A = never,
  E = never,
  R = never,
  EContinuation = never,
  RContinuation = never
>(
  input: Issue268Ds04TimerCheckpointInput<E, R>,
  continuation?: Issue268Ds04LiveOwnerContinuation<A, EContinuation, RContinuation>
) =>
  Effect.gen(function* () {
    const activeRefreshSources = yield* Ref.make<ReadonlyArray<"TrackerNotification" | "Timer">>([])
    const activeRefreshCount = yield* Ref.make(0)
    const ownerStartupSettled = yield* Deferred.make<void>()
    const ownerFailure = yield* Deferred.make<unknown>()
    const activeRefreshReturned = yield* Deferred.make<void>()
    const permitActiveRefreshFinalization = yield* Deferred.make<void>()
    const activeRefresh = (source: "TrackerNotification" | "Timer") =>
      Effect.gen(function* () {
        yield* Ref.update(activeRefreshSources, (current) => [...current, source])
        yield* Ref.update(activeRefreshCount, (count) => count + 1)
        const decision = yield* input.activateActiveRefresh(source)
        yield* Deferred.succeed(activeRefreshReturned, undefined)
        yield* Deferred.await(permitActiveRefreshFinalization)
        return decision
      })
    const ownerLayer = runReactivationOwnerLayer({
      activate: () => Effect.succeed(input.startupDecision),
      activateActiveWorkAuthorityRefresh: activeRefresh,
      activationInterval: "1 second",
      failureCooldown: "1 second",
      installAcceptedRunReactivationObservers: input.installObservers,
      isTerminationFailure: () => false,
      onActivationFinalizationStart: (kind) =>
        kind === "Ordinary" ? Deferred.succeed(ownerStartupSettled, undefined).pipe(Effect.asVoid) : Effect.void,
      onFailure: (failure) => Deferred.succeed(ownerFailure, failure).pipe(Effect.asVoid),
      readControl: input.readControl,
      runId: input.runId
    }).pipe(Layer.provide(Layer.succeed(ApplicationExitShell, input.applicationExit)))
    const awaitCompleteCheckpoint = (): Effect.Effect<void, E, R> =>
      input.nextPublication.pipe(
        Effect.raceFirst(
          Deferred.await(ownerFailure).pipe(
            Effect.flatMap((failure) => Effect.die(`DS-04 reactivation owner failed: ${String(failure)}`))
          )
        ),
        Effect.flatMap((publication) => input.readRecords.pipe(Effect.map((records) => ({ publication, records })))),
        Effect.flatMap(({ publication, records }) => {
          const newRecords = records.slice(input.beforeTimer.records.length)
          return isIssue268Ds04CompleteCheckpoint(publication, newRecords, input.attemptId)
            ? Effect.void
            : awaitCompleteCheckpoint()
        })
      )
    const result = yield* Effect.gen(function* () {
      yield* RunReactivationOwner
      yield* Deferred.await(ownerStartupSettled)
      yield* TestClock.adjust("1 second")
      yield* awaitCompleteCheckpoint()
      const after = yield* input.snapshot
      if ((yield* Deferred.poll(activeRefreshReturned))._tag === "Some") {
        return yield* Effect.die("DS-04 active refresh returned before its in-flight checkpoint")
      }
      if (continuation === undefined) return { after, continuation: undefined }
      yield* continuation.begin
      yield* Effect.all([
        input.releaseCheckpointPublication,
        Deferred.succeed(permitActiveRefreshFinalization, undefined)
      ])
      return {
        after,
        continuation: yield* continuation.awaitResult.pipe(
          Effect.raceFirst(
            Deferred.await(ownerFailure).pipe(
              Effect.flatMap((failure) => Effect.die(`DS-05 reactivation owner failed: ${String(failure)}`))
            )
          )
        )
      }
    }).pipe(
      Effect.provide(ownerLayer),
      Effect.ensuring(
        Effect.all([
          input.releaseCheckpointPublication,
          Deferred.succeed(permitActiveRefreshFinalization, undefined)
        ]).pipe(Effect.asVoid)
      )
    )
    return {
      checkpoint: {
        activeRefreshCount: yield* Ref.get(activeRefreshCount),
        activeRefreshSources: yield* Ref.get(activeRefreshSources),
        after: result.after,
        beforeTimer: input.beforeTimer
      },
      continuation: result.continuation
    } satisfies Issue268Ds04TimerCheckpointResult<A>
  })
