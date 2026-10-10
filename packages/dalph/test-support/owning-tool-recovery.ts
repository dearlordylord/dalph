// @effect-diagnostics multipleEffectProvide:off
import {
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  plannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt,
  type TaskWorkSpecification,
  IntegrationTarget,
  IntegrationTargetRef,
  GitRepositoryLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  OperationId,
  AcceptedJournalReader,
  InRunJournal,
  liveJournalTestLayer,
  plannedAttemptProtocolControllerLayer,
  PlannedAttemptProtocolController,
  controlDirectionApplicationLayer,
  ControlDirectionApplication,
  requestPlannedAttemptExecutorSuspension,
  resumePlannedAttemptExecutorWork,
  makePassivePlannedAttemptObserver,
  WorkflowInterpreter,
  WorkflowTrace,
  journaledWorkflowInterpreterLayer,
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTargetLineageObserved,
  PlannedWorktreeReady,
  authorizePlannedAttemptContinuation
} from "@dalph/orchestrator"
import { Effect, Layer, Stream } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../../orchestrator/test/task-dag.js"
import { makeExecutingAttemptHistory } from "../../orchestrator/test/support/executing-attempt-history.js"
import { makeRunRecoveryProjection } from "../../orchestrator/src/coordination/run/recovery-activation.js"
import { publishPlannedAttemptExecutorProjectionResultWithPermit } from "../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.js"
import { AuthoritativeTaskClaimObserved } from "../../orchestrator/src/workflow/interpretation/interpreter.js"

const maximumContinuationSteps = 12

/** Composes native executor custody with the ordinary owning Pause/Unpause planner. */
export const recoverThroughOwningWorkflow = Effect.fn("NativeRecovery.owningWorkflow")(function* (
  attempt: PlannedTaskAttempt,
  specification: TaskWorkSpecification
) {
  const lifecycle = yield* PlannedAttemptExecutorLifecycleObservation
  const claim = ActiveTaskClaim.make({
    operationId: OperationId.make("native-owner-claim"),
    owner: ClaimOwner.make("native-owner"),
    token: ClaimToken.make("native-owner-token"),
    taskId: attempt.taskId
  })
  const target = FixtureTarget.make("native-owner-tracker")
  const history = makeExecutingAttemptHistory({
    activeClaim: claim,
    plannedAttempt: attempt,
    runId: attempt.runId,
    taskSpecification: specification,
    trackerTarget: target
  })
  const reads: Array<string> = []
  const provider = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      readTaskAttemptBase: () => Effect.die("retained recovery never chooses another Base"),
      acquireTaskClaim: () => Effect.die("retained recovery never claims again"),
      recordTaskAttemptPlan: () => Effect.die("retained recovery never plans again"),
      reconcileTaskWorktree: () => Effect.die("retained recovery never recreates its worktree"),
      releaseTaskClaim: () => Effect.die("Pause does not release the claim"),
      readTrackerGraph: () =>
        Effect.sync(() => {
          reads.push("tracker graph")
          return validSnapshot({
            revision: "native-owner-fresh",
            tasks: [{ id: attempt.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
          })
        }),
      readTaskWorkSpecification: () =>
        Effect.sync(() => {
          reads.push("tracker specification")
          return specification
        }),
      readTaskClaim: () =>
        Effect.sync(() => {
          reads.push("tracker claim")
          return AuthoritativeTaskClaimObserved.make({ observation: claim })
        }),
      readTaskWorktree: () =>
        Effect.sync(() => {
          reads.push("Git worktree")
          return AuthoritativePlannedAttemptWorktreeObserved.make({
            observation: PlannedWorktreeReady.make({
              baseSha: attempt.baseSha,
              headSha: attempt.baseSha,
              branch: attempt.branch,
              worktree: attempt.worktree
            })
          })
        }),
      readTargetLineage: () =>
        Effect.sync(() => {
          reads.push("Git lineage")
          return AuthoritativeTargetLineageObserved.make({
            observation: {
              plannedBaseSha: attempt.baseSha,
              targetHeadSha: attempt.baseSha,
              plannedBaseIsAncestorOfTargetHead: true
            }
          })
        })
    })
  )
  yield* Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const acceptedJournal = yield* AcceptedJournalReader
      const control = yield* ControlDirectionApplication
      const protocol = yield* PlannedAttemptProtocolController
      const interpreter = yield* WorkflowInterpreter
      const projection = yield* makeRunRecoveryProjection(
        attempt.runId,
        IntegrationTarget.make({
          ref: IntegrationTargetRef.make("refs/heads/main"),
          repository: GitRepositoryLocator.make(attempt.worktree)
        })
      )
      const observer = yield* makePassivePlannedAttemptObserver()
      const observe = (owner: typeof observer) =>
        protocol.withPermit(plannedAttemptExecutorCorrelation(attempt), (permit) =>
          owner.attach({
            plannedAttempt: attempt,
            publishCurrent: (current) =>
              publishPlannedAttemptExecutorProjectionResultWithPermit(permit, attempt, current).pipe(
                Effect.provideService(InRunJournal, journal),
                Effect.provideService(AcceptedJournalReader, acceptedJournal)
              ),
            publishChange: () => Effect.die("controlled recovery reads current stopped custody only")
          })
        )
      expect((yield* observe(observer).pipe(Effect.result))._tag).toBe("Failure")
      yield* control.apply({ direction: "Pause", subject: { _tag: "Run", runId: attempt.runId } })
      expect((yield* projection.readDeliveryProjection).frontier.transitions).toContainEqual({
        _tag: "SuspendPlannedAttemptExecutorWork",
        plannedAttempt: attempt
      })
      expect(yield* requestPlannedAttemptExecutorSuspension(attempt)).toMatchObject({
        _tag: "ExecutorWorkSafelySuspended"
      })
      yield* control.apply({ direction: "Pause", subject: { _tag: "Run", runId: attempt.runId } })
      expect(
        (yield* projection.readDeliveryProjection).frontier.transitions.some(
          ({ _tag }) => _tag === "SuspendPlannedAttemptExecutorWork"
        )
      ).toBe(false)
      let closes = 0
      const unavailableObserver = yield* makePassivePlannedAttemptObserver().pipe(
        Effect.provideService(PlannedAttemptExecutorLifecycleObservation, {
          attach: () =>
            Effect.succeed({
              current: PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({
                correlation: plannedAttemptExecutorCorrelation(attempt)
              }),
              changes: Stream.never,
              close: Effect.sync(() => {
                closes += 1
              })
            })
        })
      )
      expect((yield* observe(unavailableObserver).pipe(Effect.result))._tag).toBe("Failure")
      expect(closes).toBe(1)
      yield* control.apply({ direction: "Unpause", subject: { _tag: "Run", runId: attempt.runId } })
      expect((yield* projection.readDeliveryProjection).frontier.transitions).toContainEqual(
        expect.objectContaining({ _tag: "ObservePlannedAttemptExecutorWork", plannedAttempt: attempt })
      )
      // The actual native lifecycle owner must freshly prove Safe; stale Safe is
      // never sufficient after the unavailable publication.
      yield* observe(observer)
      let resumed = false
      for (let step = 0; step < maximumContinuationSteps && !resumed; step += 1) {
        const current = yield* projection.readDeliveryProjection
        const transition = current.frontier.transitions.find(
          (candidate) =>
            candidate._tag === "ObservePlannedAttemptContinuationGraph" ||
            candidate._tag === "ObservePlannedAttemptContinuationSpecification" ||
            candidate._tag === "ObservePlannedAttemptContinuationClaim" ||
            candidate._tag === "ObservePlannedAttemptContinuationWorktree" ||
            candidate._tag === "ObservePlannedAttemptContinuationTargetLineage" ||
            candidate._tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
        )
        if (transition === undefined)
          return yield* Effect.die(`continuation must expose its next boundary: ${JSON.stringify(current.frontier)}`)
        switch (transition._tag) {
          case "ObservePlannedAttemptContinuationGraph":
            yield* interpreter.readTrackerGraph(transition.operation)
            break
          case "ObservePlannedAttemptContinuationSpecification":
            yield* interpreter.readTaskWorkSpecification(transition.operation)
            break
          case "ObservePlannedAttemptContinuationClaim":
            yield* interpreter.readTaskClaim(transition.operation)
            break
          case "ObservePlannedAttemptContinuationWorktree":
            yield* interpreter.readTaskWorktree(transition.operation)
            break
          case "ObservePlannedAttemptContinuationTargetLineage":
            yield* interpreter.readTargetLineage(transition.operation)
            break
          case "ResumePlannedAttemptExecutorWorkAfterCurrentFacts":
            expect(reads).toEqual([
              "tracker graph",
              "tracker specification",
              "tracker claim",
              "Git worktree",
              "Git lineage"
            ])
            yield* authorizePlannedAttemptContinuation(attempt, transition.witness)
            expect(yield* resumePlannedAttemptExecutorWork(attempt)).toMatchObject({
              _tag: "ExecutorWorkExecuting",
              correlation: plannedAttemptExecutorCorrelation(attempt)
            })
            resumed = true
            break
          default:
            return yield* Effect.die("unexpected retained continuation operation")
        }
      }
      expect(resumed).toBe(true)
      const records = yield* journal.read(attempt.runId)
      expect(
        records.flatMap(({ event }) => (event._tag === "PlannedAttemptExecutorCommandIntended" ? [event.command] : []))
      ).toEqual(["Begin", "Suspend", "Resume"])
      expect(records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
      expect(records.every(({ event }) => event._tag !== "RunCancellationApplied")).toBe(true)
      expect(
        (yield* projection.readDeliveryProjection).frontier.transitions.some(
          ({ _tag }) => _tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
        )
      ).toBe(false)
    }).pipe(
      Effect.provide(journaledWorkflowInterpreterLayer(attempt.runId, provider)),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provide(controlDirectionApplicationLayer),
      Effect.provide(plannedAttemptProtocolControllerLayer),
      Effect.provide(liveJournalTestLayer({ records: history.records, runId: attempt.runId, target })),
      Effect.provideService(PlannedAttemptExecutorLifecycleObservation, lifecycle)
    )
  )
})
