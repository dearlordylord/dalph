import { it } from "@effect/vitest"
import { appendAcceptedSafeExecutorHistory } from "../../../../test/support/planned-attempt-executor-history.js"
import { taskTrackerGraphFactsObserved } from "../../../../test/task-tracker-facts.js"
import { acceptedResultFixture } from "../../../../test/support/evidence.js"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Effect, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
import { GitWorktreeReadFailure, PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { GitTargetLineageReadFailure, TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import {
  FixtureReadError,
  TrackerAdapterReadError,
  TrackerReadError
} from "../../../authorities/task-tracker/graph-reader.js"
import { GraphProjectionError, projectTrackerSnapshot } from "../../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import {
  reduceWorkflowJournalHistory,
  replacementFollowsIntegrationCutoff,
  replacementProofIsAcceptedSafe,
  replacementResourceConflict
} from "../../../coordination/reconstruction/history.js"
import {
  deriveJournalResponsibilityFacts,
  gitReadIntentHasOutcome,
  hasUnfinishedRunResponsibility,
  makeRunRecoveryProjection,
  recordBeforePause,
  restartReplacementDisposition
} from "../../../coordination/run/recovery-activation.js"
import { causalPredecessorOperationIds } from "../../causal-history.js"
import { authorizedClaimForAttempt, causalClaimForAttempt } from "../../claim-authority-history.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { journaledWorkflowInterpreterLayer } from "../../../workflow-journal/journaled-interpreter.js"
import {
  attemptPlanRecordKey,
  attemptChoiceAppliedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  taskClaimReacquisitionDirectedRecordKey
} from "../../../workflow-journal/record-key.js"
import {
  InRunJournal,
  JournalStorageUnavailable,
  JournalStore,
  type JournalRecord
} from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTargetLineageObserved,
  AuthoritativeTaskClaimObserved,
  TaskClaimObservationUnreadable,
  WorkflowInterpreter
} from "../../interpretation/interpreter.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { currentRestartQuiescence, terminalRestartQuiescence } from "./restart-authority.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../registry/operation.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent
} from "../planned-attempt-executor-work/events.js"
import { resumePlannedAttemptExecutorWork } from "../planned-attempt-executor-work/guarded-protocol.js"
import { plannedAttemptProtocolControllerLayer } from "../planned-attempt-executor-work/protocol-controller.js"
import { AttemptWorktreeLost } from "../planned-attempt-worktree-observation/protocol.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../task-attempt-planning/plan.js"
import { AttemptChoiceControl, attemptChoiceControlLayer } from "./control.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId } from "./events.js"
import { advanceAttemptRestart } from "./restart.js"
import {
  TaskClaimReacquisitionDirectedEvent,
  TaskClaimReacquisitionRequestId
} from "../task-claim-reacquisition/events.js"
import { taskClaimReacquisitionOperationId } from "../task-claim-reacquisition/plan.js"

const runId = RunId.make("attempt-restart-run")
const taskId = TaskId.make("attempt-restart-A")
const independentTaskId = TaskId.make("attempt-restart-C")
const target = FixtureTarget.make("attempt-restart-target")
const baseSha = GitCommitSha.make("1".repeat(40))
const oldHeadSha = GitCommitSha.make("2".repeat(40))
const targetHeadSha = GitCommitSha.make("3".repeat(40))
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/attempt-restart.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const plannedSpecification = makeTaskWorkSpecification({ body: "F1", taskId, title: "F1" })
const changedSpecification = makeTaskWorkSpecification({ body: "F2", taskId, title: "F2" })
const thirdSpecification = makeTaskWorkSpecification({ body: "F3", taskId, title: "F3" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-restart-P1"),
  baseSha,
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-restart-P1"),
  executor: TaskExecutorLocator.make("executor:attempt-restart"),
  runId,
  taskId,
  taskRevision: plannedSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/attempt-restart-P1")
})
const successorAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-restart-P2"),
  baseSha: targetHeadSha,
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-restart-P2"),
  executor: plannedAttempt.executor,
  runId,
  taskId,
  taskRevision: changedSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/attempt-restart-P2")
})
const independentAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-restart-C-P1"),
  baseSha,
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-restart-C-P1"),
  executor: plannedAttempt.executor,
  runId,
  taskId: independentTaskId,
  taskRevision: plannedSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/attempt-restart-C-P1")
})
const exactClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("attempt-restart-claim"),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("attempt-restart-token")
})
const foreignClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("attempt-restart-foreign-claim"),
  owner: ClaimOwner.make("foreign"),
  taskId,
  token: ClaimToken.make("attempt-restart-foreign-token")
})
const reacquisitionRequestId = TaskClaimReacquisitionRequestId.make("attempt-restart-post-choice-reacquisition")
const reacquiredClaim = ActiveTaskClaim.make({
  operationId: taskClaimReacquisitionOperationId(reacquisitionRequestId),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("attempt-restart-reacquired-token")
})
const claimOperation = makeTaskClaimAcquisitionOperation({ acquisition: exactClaim, predecessorOperationIds: [] })
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("attempt-restart-plan-P1"),
  plannedAttempt,
  predecessorOperationIds: [exactClaim.operationId]
})
const requestId = AttemptChoiceRequestId.make({ nonce: "attempt-restart-D1", runId })
const subject = { observedTaskRevision: changedSpecification.fingerprint, plannedAttempt }
const correlation = { attemptId: plannedAttempt.attemptId, runId }
const graphProjection = projectTrackerSnapshot({
  revision: TrackerRevision.make("attempt-restart-current-graph"),
  tasks: [
    { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] },
    { id: independentTaskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
  ]
})
const graph = Option.getOrThrow(
  graphProjection._tag === "Valid" ? Option.some(graphProjection.snapshot) : Option.none()
)
const independentOnlyGraphProjection = projectTrackerSnapshot({
  revision: TrackerRevision.make("attempt-restart-independent-only-graph"),
  tasks: [
    { id: independentTaskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
  ]
})
const independentOnlyGraph = Option.getOrThrow(
  independentOnlyGraphProjection._tag === "Valid" ? Option.some(independentOnlyGraphProjection.snapshot) : Option.none()
)

const appendExposedRestart = Effect.gen(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  yield* journal.append(
    runId,
    intentRecordKey(exactClaim.operationId),
    TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(exactClaim.operationId),
    TaskClaimAcquiredEvent.make({ claim: exactClaim, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
  )
  yield* appendAcceptedSafeExecutorHistory(plannedAttempt)
  const originalSpecificationRead = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("attempt-restart-original-F1"),
    target,
    taskId
  )
  yield* journal.append(
    runId,
    intentRecordKey(originalSpecificationRead.operationId),
    taskTrackerReadIntent(originalSpecificationRead)
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(originalSpecificationRead.operationId),
    taskTrackerFactsObservedEvent(
      originalSpecificationRead.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(originalSpecificationRead, plannedSpecification)
    )
  )
  const specificationRead = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("attempt-restart-choice-F2"),
    target,
    taskId
  )
  yield* journal.append(runId, intentRecordKey(specificationRead.operationId), taskTrackerReadIntent(specificationRead))
  yield* journal.append(
    runId,
    outcomeRecordKey(specificationRead.operationId),
    taskTrackerFactsObservedEvent(
      specificationRead.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationRead, changedSpecification)
    )
  )
  yield* (yield* AttemptChoiceControl).apply({ choice: "RestartTaskImplementation", requestId, subject })
})

const unused = () => Effect.die("replacement must not cross this boundary")

interface RestartHarnessOptions {
  readonly additionalRecordedAttempt?: boolean
  readonly ambiguousReplacementAppend?: boolean
  readonly claim?: "Absent" | "Exact" | "Foreign" | "Unreadable"
  readonly executor?: "Completed" | "Failed"
  readonly factsChangeDuringTargetRead?: boolean
  readonly foreignSpecificationAfterChoice?: boolean
  readonly planner?: "Exact" | "Wrong"
  readonly postChoiceClaimReacquired?: boolean
  readonly specification?: "F2" | "F3" | "F3ThenF2"
  readonly target?: "Readable" | "Unreadable"
  readonly taskEligible?: boolean
  readonly taskFacts?: "Readable" | "Unreadable"
  readonly taskFactsFailure?: "Adapter" | "Projection" | "Read"
  readonly specificationFailure?: "Adapter" | "Fixture" | "Read"
  readonly pendingQuiescence?: boolean
  readonly retryAfterPending?: boolean
  readonly restartAttempts?: number
  readonly worktree?: "NotReady" | "Ready" | "Unreadable"
}

const exerciseRestart = (options: RestartHarnessOptions) =>
  Effect.gen(function* () {
    yield* appendExposedRestart
    const exposedRecords = yield* (yield* JournalStore).read(runId)
    expect(
      restartReplacementDisposition(exposedRecords, plannedAttempt, Option.none(), Option.some(integrationTarget))
    ).toMatchObject({ _tag: "AttemptRestartRequired", requestId, subject })
    expect(restartReplacementDisposition(exposedRecords, plannedAttempt, Option.none(), Option.none())).toMatchObject({
      _tag: "AttemptRestartWait",
      reason: "IntegrationTargetUnavailable"
    })
    if (options.pendingQuiescence === true) {
      const pendingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
      yield* (yield* JournalStore).append(
        runId,
        plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
        PlannedAttemptExecutorStateObservedEvent.make({
          observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: pendingReport }),
          occurrenceClassification: "NonActionOccurrence",
          ordinal: observationOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
    }
    if (options.foreignSpecificationAfterChoice === true) {
      const foreignOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("attempt-restart-foreign-target-F3"),
        FixtureTarget.make("attempt-restart-foreign-target"),
        taskId
      )
      const foreignSpecification = makeTaskWorkSpecification({
        body: "foreign target F3",
        taskId,
        title: "foreign target F3"
      })
      const journal = yield* JournalStore
      yield* journal.append(
        runId,
        intentRecordKey(foreignOperation.operationId),
        taskTrackerReadIntent(foreignOperation)
      )
      yield* journal.append(
        runId,
        outcomeRecordKey(foreignOperation.operationId),
        taskTrackerFactsObservedEvent(
          foreignOperation.operationId,
          makeFocusedTaskWorkSpecificationFactsObserved(foreignOperation, foreignSpecification)
        )
      )
    }
    if (options.postChoiceClaimReacquired === true) {
      const journal = yield* JournalStore
      const lossRead = makeTaskClaimObservationOperation(
        OperationId.make("attempt-restart-post-choice-claim-loss"),
        target,
        taskId,
        [exactClaim.operationId]
      )
      yield* journal.append(runId, intentRecordKey(lossRead.operationId), taskTrackerReadIntent(lossRead))
      yield* journal.append(
        runId,
        outcomeRecordKey(lossRead.operationId),
        taskTrackerFactsObservedEvent(
          lossRead.operationId,
          makeFocusedTaskClaimFactsObserved(lossRead, UnclaimedTask.make({ taskId }))
        )
      )
      yield* journal.append(
        runId,
        taskClaimReacquisitionDirectedRecordKey(reacquisitionRequestId),
        TaskClaimReacquisitionDirectedEvent.make({
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: reacquisitionRequestId,
          subject: { runId, taskId },
          version: workflowJournalEventVersion
        })
      )
      const reacquisition = makeTaskClaimAcquisitionOperation({
        acquisition: reacquiredClaim,
        authority: { _tag: "ExplicitTaskClaimReacquisitionAuthority", requestId: reacquisitionRequestId },
        predecessorOperationIds: [exactClaim.operationId, lossRead.operationId]
      })
      yield* journal.append(
        runId,
        intentRecordKey(reacquiredClaim.operationId),
        TaskClaimAcquisitionIntendedEvent.make({ operation: reacquisition, version: workflowJournalEventVersion })
      )
      yield* journal.append(
        runId,
        outcomeRecordKey(reacquiredClaim.operationId),
        TaskClaimAcquiredEvent.make({ claim: reacquiredClaim, version: workflowJournalEventVersion })
      )
    }
    if (options.additionalRecordedAttempt === true) {
      const additionalPlan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("attempt-restart-plan-C-P1"),
        plannedAttempt: independentAttempt,
        predecessorOperationIds: []
      })
      yield* (yield* JournalStore).append(
        runId,
        attemptPlanRecordKey(independentAttempt.attemptId),
        TaskAttemptPlannedEvent.make({ operation: additionalPlan, version: workflowJournalEventVersion })
      )
    }
    const plannerCalls = yield* Ref.make(0)
    const plannerOrdinals = yield* Ref.make<ReadonlyArray<number>>([])
    const specificationReads = yield* Ref.make(0)
    const executorReport =
      options.executor === "Completed"
        ? PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Completed" } })
        : PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Failed" } })
    const executor = PlannedAttemptExecutor.of({
      observe: unused,
      requestSuspension: unused,
      begin: () => Effect.die("Restart must not begin already safely suspended executor work"),
      resume: unused
    })
    if (options.executor !== undefined) {
      const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
      const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(3)
      const journal = yield* JournalStore
      yield* journal.append(
        runId,
        plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
        PlannedAttemptExecutorStateObservedEvent.make({
          observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
            report: executorReport
          }),
          occurrenceClassification: "NonActionOccurrence",
          ordinal: observationOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      yield* journal.append(
        runId,
        plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
        PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: reportOrdinal,
          report: executorReport,
          version: workflowJournalEventVersion
        })
      )
    }
    const durableJournal = yield* JournalStore
    const base = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () =>
          options.claim === "Unreadable"
            ? Effect.succeed(TaskClaimObservationUnreadable.make({ attempts: 3, taskId }))
            : Effect.succeed(
                AuthoritativeTaskClaimObserved.make({
                  observation:
                    options.postChoiceClaimReacquired === true
                      ? reacquiredClaim
                      : options.claim === "Absent"
                        ? { _tag: "UnclaimedTask" as const, taskId }
                        : options.claim === "Foreign"
                          ? foreignClaim
                          : exactClaim
                })
              ),
        readTaskWorktree: () =>
          options.worktree === "Unreadable"
            ? Effect.fail(new GitWorktreeReadFailure({ detail: "W1 unreadable", worktree: plannedAttempt.worktree }))
            : Effect.succeed(
                AuthoritativePlannedAttemptWorktreeObserved.make({
                  observation:
                    options.worktree === "NotReady"
                      ? AttemptWorktreeLost.make({ plannedAttempt })
                      : PlannedWorktreeReady.make({
                          baseSha,
                          branch: plannedAttempt.branch,
                          headSha: oldHeadSha,
                          worktree: plannedAttempt.worktree
                        })
                })
              ),
        readTargetLineage: () =>
          options.target === "Unreadable"
            ? Effect.fail(
                new GitTargetLineageReadFailure({
                  detail: "target head unreadable",
                  plannedBaseSha: baseSha,
                  target: integrationTarget
                })
              )
            : Effect.gen(function* () {
                if (options.factsChangeDuringTargetRead === true) {
                  const changedAgainRead = makeTaskWorkSpecificationObservationOperation(
                    OperationId.make("attempt-restart-F3-during-target-read"),
                    target,
                    taskId
                  )
                  yield* durableJournal.append(
                    runId,
                    intentRecordKey(changedAgainRead.operationId),
                    taskTrackerReadIntent(changedAgainRead)
                  )
                  yield* durableJournal.append(
                    runId,
                    outcomeRecordKey(changedAgainRead.operationId),
                    taskTrackerFactsObservedEvent(
                      changedAgainRead.operationId,
                      makeFocusedTaskWorkSpecificationFactsObserved(changedAgainRead, thirdSpecification)
                    )
                  )
                }
                return AuthoritativeTargetLineageObserved.make({
                  observation: TargetLineageObservation.make({
                    plannedBaseIsAncestorOfTargetHead: true,
                    plannedBaseSha: baseSha,
                    targetHeadSha
                  })
                })
              }),
        readTrackerGraph: () => {
          if (options.taskFactsFailure === "Projection") {
            return Effect.fail(
              new GraphProjectionError({ issues: [{ _tag: "BoundaryDecodeFailed", detail: "invalid graph" }] })
            )
          }
          if (options.taskFactsFailure === "Adapter") {
            return Effect.fail(
              new TrackerAdapterReadError({
                context: { _tag: "Fixture", operation: "TrackerGraphReader.selectAdapter" },
                detail: "adapter unavailable",
                reason: { _tag: "Transport" }
              })
            )
          }
          if (options.taskFactsFailure === "Read") {
            return Effect.fail(
              new TrackerReadError({ detail: "tracker read failed", operation: "TrackerGraphReader.parse" })
            )
          }
          return options.taskFacts === "Unreadable"
            ? Effect.fail(new FixtureReadError({ detail: "task facts unreadable", target }))
            : Effect.succeed(options.taskEligible === false ? independentOnlyGraph : graph)
        },
        readTaskWorkSpecification: () => {
          if (options.specificationFailure === "Fixture") {
            return Effect.fail(new FixtureReadError({ detail: "specification unavailable", target }))
          }
          if (options.specificationFailure === "Adapter") {
            return Effect.fail(
              new TrackerAdapterReadError({
                context: { _tag: "Fixture", operation: "TrackerGraphReader.selectAdapter" },
                detail: "specification adapter unavailable",
                reason: { _tag: "Transport" }
              })
            )
          }
          if (options.specificationFailure === "Read") {
            return Effect.fail(
              new TrackerReadError({ detail: "specification read failed", operation: "TrackerGraphReader.parse" })
            )
          }
          return Ref.getAndUpdate(specificationReads, (count) => count + 1).pipe(
            Effect.map((count) =>
              options.specification === "F3" || (options.specification === "F3ThenF2" && count === 0)
                ? thirdSpecification
                : changedSpecification
            )
          )
        },
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    )
    let loseReplacementAppendResponse = options.ambiguousReplacementAppend === true
    const inRunJournal = InRunJournal.of({
      append: (eventRunId, key, event) =>
        durableJournal.append(eventRunId, key, event).pipe(
          Effect.flatMap((record) => {
            if (!loseReplacementAppendResponse || event._tag !== "PlannedAttemptReplaced") {
              return Effect.succeed(record)
            }
            loseReplacementAppendResponse = false
            return Effect.fail(
              new JournalStorageUnavailable({
                detail: "replacement append was durable but its acknowledgement was lost",
                operation: "JournalStore.append"
              })
            )
          })
        ),
      read: (eventRunId) => durableJournal.read(eventRunId)
    })
    const restart = advanceAttemptRestart(requestId, subject, integrationTarget).pipe(
      Effect.provide(journaledWorkflowInterpreterLayer(runId, base)),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({
          plan: (planningRequest) =>
            planningRequest._tag === "Fresh"
              ? Effect.die("Restart must request one exact replacement plan")
              : Ref.update(plannerCalls, (count) => count + 1).pipe(
                  Effect.andThen(
                    Ref.update(plannerOrdinals, (ordinals) => [...ordinals, Number(planningRequest.ordinal)])
                  ),
                  Effect.as(
                    PlannedTaskAttempt.make({
                      ...(options.planner === "Wrong" ? plannedAttempt : successorAttempt),
                      baseSha: planningRequest.baseSha
                    })
                  )
                )
        })
      ),
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("attempt-restart-plan-P2")) })
      ),
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.provideService(InRunJournal, inRunJournal)
    )
    const ambiguousFailure = options.ambiguousReplacementAppend ? yield* Effect.flip(restart) : undefined
    const restartAttempts = options.restartAttempts ?? (options.retryAfterPending === true ? 2 : 1)
    let result = yield* restart
    for (let attempt = 1; attempt < restartAttempts; attempt += 1) {
      result = yield* restart
    }
    return {
      ambiguousFailure,
      plannerCalls: yield* Ref.get(plannerCalls),
      plannerOrdinals: yield* Ref.get(plannerOrdinals),
      records: yield* (yield* JournalStore).read(runId),
      result
    }
  })

it.effect("keeps target-A restart advancement valid after a later foreign-target specification", () =>
  Effect.gen(function* () {
    const result = yield* exerciseRestart({ foreignSpecificationAfterChoice: true })

    expect(result.result._tag).toBe("PlannedAttemptReplacementRecorded")
    expect(result.plannerCalls).toBe(1)
    expect(reduceWorkflowJournalHistory(runId, result.records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("keeps restart pending while the current executor projection awaits acceptance", () =>
  Effect.gen(function* () {
    const result = yield* exerciseRestart({ pendingQuiescence: true })

    expect(result.result).toEqual({ _tag: "AttemptRestartPending", reason: "ExecutorLifecycleAcceptancePending" })
    expect(result.plannerCalls).toBe(0)
    expect(result.records.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it("accepts only the latest accepted safe suspension as replacement quiescence", () => {
  const proof = (report: PlannedAttemptExecutorReport, observedAt: number) => ({
    observedAt: JournalPosition.make(observedAt),
    report,
    source: { _tag: "AcceptedReport" as const, ordinal: PlannedAttemptExecutorReportOrdinal.make(2) }
  })
  const acceptedResult = acceptedResultFixture(targetHeadSha)
  expect(
    replacementProofIsAcceptedSafe(
      proof(PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }), 9)
    )
  ).toBe(true)
  expect(
    replacementProofIsAcceptedSafe(
      proof(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }), 11)
    )
  ).toBe(false)
  expect(
    replacementProofIsAcceptedSafe(
      proof(
        PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation,
          result: { _tag: "Accepted", acceptedResult }
        }),
        11
      )
    )
  ).toBe(false)
  expect(
    replacementProofIsAcceptedSafe(
      proof(
        PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation,
          result: { _tag: "Accepted", acceptedResult }
        }),
        9
      )
    )
  ).toBe(false)
  expect(
    replacementProofIsAcceptedSafe(
      proof(
        PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Completed" } }),
        11
      )
    )
  ).toBe(false)
})

it("rejects every terminal replacement-quiescence result", () => {
  const evidence = (report: PlannedAttemptExecutorReport, observedAt: number) =>
    ({ observedAt: JournalPosition.make(observedAt), report }) as Parameters<typeof terminalRestartQuiescence>[0]
  const accepted = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation,
    result: { _tag: "Accepted", acceptedResult: acceptedResultFixture(targetHeadSha) }
  })
  expect(
    terminalRestartQuiescence(
      evidence(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }), 11)
    )
  ).toEqual({ _tag: "Unproved" })
  expect(
    terminalRestartQuiescence(
      evidence(
        PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Completed" } }),
        11
      )
    )
  ).toMatchObject({ _tag: "Rejected", reason: "CompletedDoesNotAuthorizeReplacement" })
  expect(
    terminalRestartQuiescence(
      evidence(
        PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Failed" } }),
        11
      )
    )
  ).toMatchObject({ _tag: "Rejected", reason: "FailedDoesNotAuthorizeReplacement" })
  expect(terminalRestartQuiescence(evidence(accepted, 11))).toMatchObject({
    _tag: "Rejected",
    reason: "AcceptedDoesNotAuthorizeReplacement"
  })
  expect(terminalRestartQuiescence(evidence(accepted, 9))).toMatchObject({
    _tag: "Rejected",
    reason: "AcceptedDoesNotAuthorizeReplacement"
  })
})

it.effect("keeps replacement pending or rejects it when executor authority is not a current safe proof", () =>
  Effect.gen(function* () {
    expect(yield* currentRestartQuiescence([], subject)).toEqual({ _tag: "Pending", reason: "ExecutorUnavailable" })

    const pendingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const pendingObservationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
    const pendingObservation: JournalRecord = {
      event: PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: pendingReport }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: pendingObservationOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, pendingObservationOrdinal),
      position: JournalPosition.make(1),
      runId
    }
    expect(yield* currentRestartQuiescence([pendingObservation], subject)).toEqual({
      _tag: "Pending",
      reason: "ExecutorLifecycleAcceptancePending"
    })

    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const executingRecord: JournalRecord = {
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: executing,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkReportedRecordKey(
        plannedAttempt.attemptId,
        PlannedAttemptExecutorReportOrdinal.make(1)
      ),
      position: JournalPosition.make(1),
      runId
    }
    expect(yield* currentRestartQuiescence([executingRecord], subject)).toEqual({
      _tag: "Rejected",
      reason: "ExecutingDoesNotAuthorizeReplacement"
    })

    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const safeOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    const laterCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    const safeRecord: JournalRecord = {
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: safeOrdinal,
        report: safe,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, safeOrdinal),
      position: JournalPosition.make(1),
      runId
    }
    const laterCommand: JournalRecord = {
      event: PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Resume",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: laterCommandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, laterCommandOrdinal),
      position: JournalPosition.make(2),
      runId
    }
    expect(yield* currentRestartQuiescence([safeRecord, laterCommand], subject)).toEqual({
      _tag: "Rejected",
      reason: "LaterExecutorCommandInvalidatedChoice"
    })
  })
)

it("classifies every resource event that would invalidate a planned-attempt replacement", () => {
  type ResourceEvent = Parameters<typeof replacementResourceConflict>[0]
  const witness = { expectedClaim: exactClaim } as Parameters<typeof replacementResourceConflict>[2]
  const conflict = (event: unknown) => replacementResourceConflict(event as ResourceEvent, plannedAttempt, witness)

  expect(conflict({ _tag: "WorkflowRunBegan" })).toBe(false)
  expect(conflict({ _tag: "TaskClaimReacquisitionDirected", subject: { runId, taskId } })).toBe(true)
  expect(conflict({ _tag: "TaskClaimReacquisitionDirected", subject: { runId, taskId: independentTaskId } })).toBe(
    false
  )
  expect(conflict({ _tag: "TaskClaimAcquisitionIntended", operation: { acquisition: exactClaim } })).toBe(true)
  expect(
    conflict({
      _tag: "TaskClaimAcquisitionIntended",
      operation: { acquisition: { ...exactClaim, taskId: independentTaskId } }
    })
  ).toBe(false)
  expect(conflict({ _tag: "TaskClaimReleaseIntended", operation: { release: { claim: exactClaim } } })).toBe(true)
  expect(conflict({ _tag: "TaskClaimReleased", release: { claim: exactClaim } })).toBe(true)
  expect(conflict({ _tag: "TaskWorktreeReconciliationIntended", operation: { plannedAttempt } })).toBe(true)
  expect(
    conflict({ _tag: "TaskWorktreeReconciliationIntended", operation: { plannedAttempt: independentAttempt } })
  ).toBe(false)
})

it("recognizes only the exact attempt's integration-start cutoff", () => {
  type HistoryRecord = Parameters<typeof replacementFollowsIntegrationCutoff>[0][number]
  const record = (event: unknown) => ({ event }) as HistoryRecord
  expect(replacementFollowsIntegrationCutoff([record({ _tag: "WorkflowRunBegan" })], plannedAttempt)).toBe(false)
  expect(
    replacementFollowsIntegrationCutoff(
      [record({ _tag: "IntegrationStarted", plannedAttempt: independentAttempt })],
      plannedAttempt
    )
  ).toBe(false)
  expect(
    replacementFollowsIntegrationCutoff([record({ _tag: "IntegrationStarted", plannedAttempt })], plannedAttempt)
  ).toBe(true)
})

it("recognizes every terminal outcome for a pending Git read intent", () => {
  type HistoryRecord = Parameters<typeof gitReadIntentHasOutcome>[0][number]
  const operationId = OperationId.make("pending-git-read")
  const record = (event: unknown) => ({ event }) as HistoryRecord
  const hasOutcome = (event: unknown) => gitReadIntentHasOutcome([record(event)], operationId)

  expect(hasOutcome({ _tag: "WorkflowRunBegan" })).toBe(false)
  expect(hasOutcome({ _tag: "PlannedAttemptWorktreeObserved", operationId })).toBe(true)
  expect(hasOutcome({ _tag: "TargetLineageObserved", operationId })).toBe(true)
  expect(
    hasOutcome({
      _tag: "AttemptRestartAuthorityReadFailed",
      failure: { _tag: "AttemptRestartGitReadFailure" },
      operationId
    })
  ).toBe(true)
  expect(
    hasOutcome({
      _tag: "AttemptRestartAuthorityReadFailed",
      failure: { _tag: "AttemptRestartTaskFactsReadFailure" },
      operationId
    })
  ).toBe(false)
  expect(hasOutcome({ _tag: "TargetLineageObserved", operationId: OperationId.make("another-read") })).toBe(false)
})

it.effect("rejects a replacement when the planner returns a non-distinct successor", () =>
  Effect.flip(exerciseRestart({ planner: "Wrong" })).pipe(
    Effect.tap((failure) =>
      Effect.sync(() =>
        expect(failure).toMatchObject({
          _tag: "AttemptRestartAuthorityContradiction",
          detail: "successor planner did not return a distinct exact F2/H2 attempt",
          requestId,
          subject
        })
      )
    ),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("atomically supersedes exact P1 with clean P2 from fresh F2 K1 W1 and H2 facts", () =>
  Effect.gen(function* () {
    yield* appendExposedRestart
    const trackerReads = yield* Ref.make(0)
    const gitReads = yield* Ref.make(0)
    const plannerCalls = yield* Ref.make(0)
    const base = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.succeed({ _tag: "AuthoritativeTaskClaimObserved", observation: exactClaim }),
        readTaskWorktree: () =>
          Ref.update(gitReads, (count) => count + 1).pipe(
            Effect.as({
              _tag: "AuthoritativePlannedAttemptWorktreeObserved" as const,
              observation: PlannedWorktreeReady.make({
                baseSha,
                branch: plannedAttempt.branch,
                headSha: oldHeadSha,
                worktree: plannedAttempt.worktree
              })
            })
          ),
        readTargetLineage: () =>
          Ref.update(gitReads, (count) => count + 1).pipe(
            Effect.as({
              _tag: "AuthoritativeTargetLineageObserved" as const,
              observation: TargetLineageObservation.make({
                plannedBaseIsAncestorOfTargetHead: true,
                plannedBaseSha: baseSha,
                targetHeadSha
              })
            })
          ),
        readTrackerGraph: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(graph)),
        readTaskWorkSpecification: () =>
          Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(changedSpecification)),
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    )
    const planner = PlannedTaskAttemptPlanner.of({
      plan: (planningRequest) =>
        planningRequest._tag === "Fresh"
          ? Effect.die("Restart must request one exact replacement plan")
          : Ref.update(plannerCalls, (count) => count + 1).pipe(
              Effect.as(PlannedTaskAttempt.make({ ...successorAttempt, baseSha: planningRequest.baseSha }))
            )
    })
    const allocator = OperationIdAllocator.of({
      allocate: () => Effect.succeed(OperationId.make("attempt-restart-plan-P2"))
    })
    const executor = PlannedAttemptExecutor.of({
      observe: unused,
      requestSuspension: unused,
      begin: unused,
      resume: unused
    })

    const [first, redelivery] = yield* Effect.all(
      [
        advanceAttemptRestart(requestId, subject, integrationTarget),
        advanceAttemptRestart(requestId, subject, integrationTarget)
      ],
      { concurrency: 1 }
    ).pipe(
      Effect.provide(journaledWorkflowInterpreterLayer(runId, base)),
      Effect.provideService(PlannedTaskAttemptPlanner, planner),
      Effect.provideService(OperationIdAllocator, allocator),
      Effect.provideService(PlannedAttemptExecutor, executor)
    )

    expect(first._tag).toBe("PlannedAttemptReplacementRecorded")
    expect(redelivery._tag).toBe("PlannedAttemptReplacementRecorded")
    const contradictoryRequestId = AttemptChoiceRequestId.make({ nonce: "attempt-restart-other-D1", runId })
    const contradiction = yield* advanceAttemptRestart(contradictoryRequestId, subject, integrationTarget).pipe(
      Effect.provide(journaledWorkflowInterpreterLayer(runId, base)),
      Effect.provideService(PlannedTaskAttemptPlanner, planner),
      Effect.provideService(OperationIdAllocator, allocator),
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.flip
    )
    expect(contradiction).toMatchObject({
      _tag: "AttemptRestartChoiceContradiction",
      requestId: contradictoryRequestId,
      subject
    })
    const records = yield* (yield* JournalStore).read(runId)
    const replacements = records.filter(({ event }) => event._tag === "PlannedAttemptReplaced")
    expect(replacements).toHaveLength(1)
    expect(replacements[0]?.event).toMatchObject({
      successorPlan: { plannedAttempt: successorAttempt },
      witness: { expectedClaim: exactClaim, oldWorktreeProof: { headSha: oldHeadSha }, targetHeadSha }
    })
    expect(yield* Ref.get(plannerCalls)).toBe(1)
    expect(yield* Ref.get(trackerReads)).toBe(2)
    expect(yield* Ref.get(gitReads)).toBe(2)
    expect(records.some(({ event }) => event._tag === "TaskClaimReleaseIntended")).toBe(false)
    expect(records.some(({ event }) => event._tag === "TaskWorktreeReconciliationIntended")).toBe(false)
    expect(authorizedClaimForAttempt(records, successorAttempt)?.claim).toEqual(exactClaim)
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
    const replacementPosition = replacements[0]?.position
    if (replacementPosition === undefined) return expect.fail("expected replacement position")
    expect(recordBeforePause(records, replacementPosition, ({ event }) => event._tag === "WorkflowRunBegan")).toBe(true)
    expect(recordBeforePause(records, JournalPosition.make(1), () => true)).toBe(false)
    expect(recordBeforePause(records, replacementPosition, () => false)).toBe(false)
    expect(
      restartReplacementDisposition(records, plannedAttempt, Option.none(), Option.some(integrationTarget))
    ).toBeUndefined()
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("exposes the same exact attempt choice for a replacement-recorded successor", () =>
  Effect.gen(function* () {
    yield* exerciseRestart({})
    const journal = yield* JournalStore
    yield* appendAcceptedSafeExecutorHistory(successorAttempt)
    const specificationRead = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("attempt-restart-successor-F3"),
      target,
      taskId
    )
    yield* journal.append(
      runId,
      intentRecordKey(specificationRead.operationId),
      taskTrackerReadIntent(specificationRead)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(specificationRead.operationId),
      taskTrackerFactsObservedEvent(
        specificationRead.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationRead, thirdSpecification)
      )
    )
    const result = yield* (yield* AttemptChoiceControl).apply({
      choice: "RestartTaskImplementation",
      requestId: AttemptChoiceRequestId.make({ nonce: "attempt-restart-D2", runId }),
      subject: { observedTaskRevision: thirdSpecification.fingerprint, plannedAttempt: successorAttempt }
    })

    expect(result._tag).toBe("RestartApplied")
    expect(reduceWorkflowJournalHistory(runId, yield* journal.read(runId))._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("fails closed when claim chronology is absent or late", () =>
  Effect.gen(function* () {
    expect(authorizedClaimForAttempt([], plannedAttempt)).toBeUndefined()

    yield* appendExposedRestart
    const journal = yield* JournalStore
    const records = yield* journal.read(runId)
    const plan = records.find(({ event }) => event._tag === "TaskAttemptPlanned")
    if (plan === undefined) return expect.fail("expected original plan")
    const lateClaim = records.map((record) =>
      record.event._tag === "TaskClaimAcquired"
        ? { ...record, position: JournalPosition.make(Number(plan.position) + 1) }
        : record
    )
    expect(causalClaimForAttempt(lateClaim, plannedAttempt.attemptId)).toBeUndefined()
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("falls back to the original causal claim when reacquisition direction is absent", () =>
  Effect.gen(function* () {
    yield* exerciseRestart({ postChoiceClaimReacquired: true })
    const journal = yield* JournalStore
    const withReacquisition = yield* journal.read(runId)
    const withoutDirection = withReacquisition.filter(({ event }) => event._tag !== "TaskClaimReacquisitionDirected")
    expect(authorizedClaimForAttempt(withoutDirection, plannedAttempt)?.claim).toEqual(exactClaim)
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("removes every new attempt-choice capability from superseded P1", () =>
  Effect.gen(function* () {
    yield* exerciseRestart({})
    const journal = yield* JournalStore
    const laterSpecification = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("attempt-restart-superseded-P1-F3"),
      target,
      taskId
    )
    yield* journal.append(
      runId,
      intentRecordKey(laterSpecification.operationId),
      taskTrackerReadIntent(laterSpecification)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(laterSpecification.operationId),
      taskTrackerFactsObservedEvent(
        laterSpecification.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(laterSpecification, thirdSpecification)
      )
    )
    const laterRequestId = AttemptChoiceRequestId.make({ nonce: "attempt-restart-superseded-P1-D2", runId })
    const laterSubject = { observedTaskRevision: thirdSpecification.fingerprint, plannedAttempt }
    const rejected = yield* (yield* AttemptChoiceControl)
      .apply({ choice: "RestartTaskImplementation", requestId: laterRequestId, subject: laterSubject })
      .pipe(Effect.flip)
    expect(rejected).toMatchObject({ _tag: "AttemptChoiceNotAvailable", reason: "AttemptSuperseded" })

    yield* journal.append(
      runId,
      attemptChoiceAppliedRecordKey(laterRequestId),
      AttemptChoiceAppliedEvent.make({
        choice: "RestartTaskImplementation",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId: laterRequestId,
        subject: laterSubject,
        version: workflowJournalEventVersion
      })
    )
    const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
    expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduction._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduction.issues).toContainEqual(
      expect.objectContaining({
        detail: `attempt-choice request ${laterRequestId.nonce} follows the atomic replacement of the same attempt`
      })
    )
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("keeps P2's atomic plan in the durable causal operation graph", () =>
  exerciseRestart({}).pipe(
    Effect.tap(({ records }) =>
      Effect.sync(() => {
        const replacement = records.find(({ event }) => event._tag === "PlannedAttemptReplaced")?.event
        if (replacement?._tag !== "PlannedAttemptReplaced") return expect.fail("expected replacement")
        const successorRead = makeTaskWorktreeObservationOperation({
          operationId: OperationId.make("attempt-restart-P2-causal-read"),
          plannedAttempt: replacement.successorPlan.plannedAttempt,
          predecessorOperationIds: [replacement.successorPlan.operationId]
        })

        expect(causalPredecessorOperationIds(records, successorRead)).toContain(exactClaim.operationId)
      })
    ),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("allocates P2 in A's next task-local slot regardless of independent C", () =>
  exerciseRestart({ additionalRecordedAttempt: true }).pipe(
    Effect.tap(({ plannerOrdinals, result }) =>
      Effect.sync(() => {
        expect(result._tag).toBe("PlannedAttemptReplacementRecorded")
        expect(plannerOrdinals).toEqual([1])
      })
    ),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("keeps P1 worktree authority independent from a later task C worktree observation", () =>
  Effect.gen(function* () {
    yield* appendExposedRestart
    const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget)
    const journal = yield* JournalStore
    const appendWorktreeObservation = Effect.fn("AttemptRestartTest.appendWorktreeObservation")(function* (
      observedAttempt: PlannedTaskAttempt,
      observation: AttemptWorktreeLost | PlannedWorktreeReady,
      nonce: string
    ) {
      const operation = makeTaskWorktreeObservationOperation({
        operationId: OperationId.make(`attempt-restart-worktree-${nonce}`),
        plannedAttempt: observedAttempt,
        predecessorOperationIds: []
      })
      yield* journal.append(
        runId,
        intentRecordKey(operation.operationId),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation,
          version: workflowJournalEventVersion
        })
      )
      yield* journal.append(
        runId,
        outcomeRecordKey(operation.operationId),
        PlannedAttemptWorktreeObservedEvent.make({
          observation,
          occurrenceClassification: "NonActionOccurrence",
          operationId: operation.operationId,
          version: workflowJournalEventVersion
        })
      )
    })

    yield* appendWorktreeObservation(plannedAttempt, AttemptWorktreeLost.make({ plannedAttempt }), "P1-not-ready")
    yield* appendWorktreeObservation(
      independentAttempt,
      PlannedWorktreeReady.make({
        baseSha: independentAttempt.baseSha,
        branch: independentAttempt.branch,
        headSha: independentAttempt.baseSha,
        worktree: independentAttempt.worktree
      }),
      "C-ready"
    )

    const frontier = (yield* recovery.readDeliveryProjection).frontier
    expect(frontier.explanations).toContainEqual({
      _tag: "AttemptRestartWait",
      correlation,
      reason: "OldWorktreeNotReady",
      taskId,
      wakeCondition: "ProcessRestartedOrAcceptedFactsChanged"
    })
    expect(frontier.transitions.some(({ _tag }) => _tag === "AdvanceAttemptRestart")).toBe(false)
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("keeps P1 restart eligibility independent from a later task C graph read", () =>
  Effect.gen(function* () {
    yield* appendExposedRestart
    const journal = yield* JournalStore
    const cGraph = makeTrackerGraphObservationOperation(
      OperationId.make("attempt-restart-independent-C-graph"),
      target,
      [],
      [independentTaskId]
    )
    yield* journal.append(runId, intentRecordKey(cGraph.operationId), taskTrackerReadIntent(cGraph))
    yield* journal.append(
      runId,
      outcomeRecordKey(cGraph.operationId),
      taskTrackerGraphFactsObserved(cGraph, {
        revision: TrackerRevision.make("attempt-restart-independent-C-current"),
        taskIds: [independentTaskId]
      })
    )

    const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget)
    const frontier = (yield* recovery.readDeliveryProjection).frontier
    expect(frontier.transitions).toContainEqual(
      expect.objectContaining({ _tag: "AdvanceAttemptRestart", requestId, subject })
    )
    expect(frontier.explanations).not.toContainEqual(
      expect.objectContaining({ _tag: "AttemptRestartWait", reason: "TaskNotEligible", taskId })
    )
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects a new F3 Continue after the earlier F2 Restart choice", () =>
  Effect.gen(function* () {
    yield* appendExposedRestart
    const journal = yield* JournalStore
    const laterSpecification = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("attempt-restart-new-choice-F3"),
      target,
      taskId
    )
    yield* journal.append(
      runId,
      intentRecordKey(laterSpecification.operationId),
      taskTrackerReadIntent(laterSpecification)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(laterSpecification.operationId),
      taskTrackerFactsObservedEvent(
        laterSpecification.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(laterSpecification, thirdSpecification)
      )
    )
    const continueRequestId = AttemptChoiceRequestId.make({ nonce: "attempt-restart-new-choice-D2", runId })
    const rejected = yield* (yield* AttemptChoiceControl)
      .apply({
        choice: "ContinueExistingAttempt",
        requestId: continueRequestId,
        subject: { observedTaskRevision: thirdSpecification.fingerprint, plannedAttempt }
      })
      .pipe(Effect.flip)
    expect(rejected).toMatchObject({ _tag: "AttemptChoiceNotAvailable", reason: "TerminalChoiceAlreadyApplied" })

    const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget)
    const frontier = (yield* recovery.readDeliveryProjection).frontier

    expect(frontier.explanations).toContainEqual(
      expect.objectContaining({ _tag: "AttemptRestartRejected", reason: "NewFingerprintChoiceRequired", taskId })
    )
    expect(frontier.transitions).not.toContainEqual(
      expect.objectContaining({ _tag: "ObservePlannedAttemptContinuationGraph", plannedAttempt })
    )
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects replacement authority whose boundary intent predates the applied Restart choice", () =>
  exerciseRestart({}).pipe(
    Effect.tap(({ records }) =>
      Effect.sync(() => {
        const replacement = records.find(({ event }) => event._tag === "PlannedAttemptReplaced")?.event
        const applicationIndex = records.findIndex(
          ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
        )
        if (replacement?._tag !== "PlannedAttemptReplaced" || applicationIndex < 0) {
          return expect.fail("expected applied Restart and replacement")
        }
        const graphIntentIndex = records.findIndex(
          ({ event }) =>
            event._tag === "TaskTrackerReadIntentRecorded" &&
            event.operation.operationId === replacement.witness.graphObservationOperationId
        )
        if (graphIntentIndex < 0) return expect.fail("expected replacement graph read intent")
        const graphIntent = records[graphIntentIndex]
        if (graphIntent === undefined) return expect.fail("expected replacement graph read intent")
        const withoutGraphIntent = records.filter((_, index) => index !== graphIntentIndex)
        const reorderedApplicationIndex = withoutGraphIntent.findIndex(
          ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
        )
        const forged = [
          ...withoutGraphIntent.slice(0, reorderedApplicationIndex),
          graphIntent,
          ...withoutGraphIntent.slice(reorderedApplicationIndex)
        ].map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))

        const reduction = reduceWorkflowJournalHistory(runId, forged)
        expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
        if (reduction._tag !== "InvalidWorkflowJournalHistory") return
        expect(reduction.issues).toContainEqual(
          expect.objectContaining({ detail: "PlannedAttemptReplaced lacks exact fresh F2, K1, W1, or H2 authority" })
        )
      })
    ),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects every missing or superseding replacement authority fact", () =>
  exerciseRestart({}).pipe(
    Effect.tap(({ records }) =>
      Effect.sync(() => {
        const replacement = records.find(({ event }) => event._tag === "PlannedAttemptReplaced")?.event
        if (replacement?._tag !== "PlannedAttemptReplaced") return expect.fail("expected replacement")
        const operationIds = [
          replacement.witness.graphObservationOperationId,
          replacement.witness.specificationObservationOperationId,
          replacement.witness.claimObservationOperationId,
          replacement.witness.oldWorktreeObservationOperationId,
          replacement.witness.targetLineageObservationOperationId
        ]
        const applicationIndex = records.findIndex(
          ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
        )
        if (applicationIndex < 0) return expect.fail("expected applied Restart")
        const reindex = (candidate: typeof records) =>
          candidate.map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
        const assertAuthorityFailure = (candidate: typeof records) => {
          const reduction = reduceWorkflowJournalHistory(runId, reindex(candidate))
          expect(reduction).toMatchObject({
            _tag: "InvalidWorkflowJournalHistory",
            issues: expect.arrayContaining([
              expect.objectContaining({
                detail: "PlannedAttemptReplaced lacks exact fresh F2, K1, W1, or H2 authority"
              })
            ])
          })
        }

        for (const operationId of operationIds) {
          const withoutOutcome = records.filter(
            ({ event }) => !("operationId" in event && event.operationId === operationId)
          )
          assertAuthorityFailure(withoutOutcome)

          const intentIndex = records.findIndex(
            ({ event }) =>
              (event._tag === "TaskTrackerReadIntentRecorded" || event._tag === "GitReadIntentRecorded") &&
              event.operation.operationId === operationId
          )
          const outcomeIndex = records.findIndex(
            ({ event }) => "operationId" in event && event.operationId === operationId
          )
          if (intentIndex < 0 || outcomeIndex < 0) return expect.fail(`expected authority records for ${operationId}`)
          const intent = records[intentIndex]
          const outcome = records[outcomeIndex]
          if (intent === undefined) return expect.fail(`expected authority intent for ${operationId}`)
          if (outcome === undefined) return expect.fail(`expected authority outcome for ${operationId}`)
          assertAuthorityFailure(records.filter((_, index) => index !== intentIndex))

          const withoutOutcomeRecord = records.filter((_, index) => index !== outcomeIndex)
          const shiftedApplicationIndex = withoutOutcomeRecord.findIndex(
            ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
          )
          assertAuthorityFailure([
            ...withoutOutcomeRecord.slice(0, shiftedApplicationIndex),
            outcome,
            ...withoutOutcomeRecord.slice(shiftedApplicationIndex)
          ])

          const withoutIntent = records.filter((_, index) => index !== intentIndex)
          const shiftedOutcomeIndex = withoutIntent.findIndex(
            ({ event }) => "operationId" in event && event.operationId === operationId
          )
          const intentAfterOutcome = [
            ...withoutIntent.slice(0, shiftedOutcomeIndex + 1),
            intent,
            ...withoutIntent.slice(shiftedOutcomeIndex + 1)
          ]
          assertAuthorityFailure(intentAfterOutcome)
        }

        const claimIntent = records.find(
          ({ event }) =>
            event._tag === "TaskTrackerReadIntentRecorded" &&
            event.operation.operationId === replacement.witness.claimObservationOperationId
        )
        if (
          claimIntent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
          claimIntent.event.operation._tag !== "ReadTaskClaim"
        ) {
          return expect.fail("expected replacement claim intent")
        }
        const claimOperation = claimIntent.event.operation
        assertAuthorityFailure(
          records.map((record) =>
            "operationId" in record.event &&
            record.event.operationId === replacement.witness.claimObservationOperationId
              ? {
                  ...record,
                  event: taskTrackerFactsObservedEvent(
                    replacement.witness.claimObservationOperationId,
                    makeFocusedTaskClaimFactsObserved(
                      claimOperation,
                      UnclaimedTask.make({ taskId: plannedAttempt.taskId })
                    )
                  )
                }
              : record
          )
        )

        assertAuthorityFailure(
          records.map((record) =>
            record.event._tag === "PlannedAttemptWorktreeObserved" &&
            record.event.operationId === replacement.witness.oldWorktreeObservationOperationId
              ? {
                  ...record,
                  event: PlannedAttemptWorktreeObservedEvent.make({
                    observation: AttemptWorktreeLost.make({ plannedAttempt }),
                    occurrenceClassification: "NonActionOccurrence",
                    operationId: replacement.witness.oldWorktreeObservationOperationId,
                    version: workflowJournalEventVersion
                  })
                }
              : record
          )
        )

        assertAuthorityFailure(records.filter(({ event }) => event._tag !== "TaskClaimAcquired"))

        const claimIntentIndex = records.findIndex(({ event }) => event._tag === "TaskClaimAcquisitionIntended")
        const replacementIndex = records.findIndex(({ event }) => event._tag === "PlannedAttemptReplaced")
        const claimAcquisitionIntent = records[claimIntentIndex]
        if (claimIntentIndex < 0 || replacementIndex < 0 || claimAcquisitionIntent === undefined) {
          return expect.fail("expected claim acquisition and replacement records")
        }
        const withoutClaimAcquisitionIntent = records.filter((_, index) => index !== claimIntentIndex)
        const shiftedReplacementIndex = withoutClaimAcquisitionIntent.findIndex(
          ({ event }) => event._tag === "PlannedAttemptReplaced"
        )
        assertAuthorityFailure([
          ...withoutClaimAcquisitionIntent.slice(0, shiftedReplacementIndex),
          claimAcquisitionIntent,
          ...withoutClaimAcquisitionIntent.slice(shiftedReplacementIndex)
        ])

        const replacementRecord = records[replacementIndex]
        if (replacementRecord === undefined) return expect.fail("expected replacement record")
        expect(
          reduceWorkflowJournalHistory(
            runId,
            reindex([...records.slice(0, replacementIndex), replacementRecord, ...records.slice(replacementIndex)])
          )._tag
        ).toBe("InvalidWorkflowJournalHistory")
      })
    ),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects replacement when a later task read supersedes the named F2 authority", () =>
  Effect.gen(function* () {
    yield* exerciseRestart({})
    const journal = yield* JournalStore
    const laterRead = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("attempt-restart-later-F3"),
      target,
      taskId
    )
    yield* journal.append(runId, intentRecordKey(laterRead.operationId), taskTrackerReadIntent(laterRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(laterRead.operationId),
      taskTrackerFactsObservedEvent(
        laterRead.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(laterRead, thirdSpecification)
      )
    )
    const augmented = yield* journal.read(runId)
    const replacementIndex = augmented.findIndex(({ event }) => event._tag === "PlannedAttemptReplaced")
    const laterIntentIndex = augmented.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === laterRead.operationId
    )
    const laterOutcomeIndex = augmented.findIndex(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === laterRead.operationId
    )
    const replacement = augmented[replacementIndex]
    const laterIntent = augmented[laterIntentIndex]
    const laterOutcome = augmented[laterOutcomeIndex]
    if (replacement === undefined || laterIntent === undefined || laterOutcome === undefined) {
      return expect.fail("expected replacement and later F3 read")
    }
    const withoutMoved = augmented.filter((_, index) => index !== laterIntentIndex && index !== laterOutcomeIndex)
    const shiftedReplacementIndex = withoutMoved.findIndex(({ event }) => event._tag === "PlannedAttemptReplaced")
    const forged = [
      ...withoutMoved.slice(0, shiftedReplacementIndex),
      laterIntent,
      laterOutcome,
      ...withoutMoved.slice(shiftedReplacementIndex)
    ].map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))

    const reduction = reduceWorkflowJournalHistory(runId, forged)
    expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduction._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduction.issues).toContainEqual(
      expect.objectContaining({ detail: "PlannedAttemptReplaced lacks exact fresh F2, K1, W1, or H2 authority" })
    )
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

const nonAuthorizingCases = [
  {
    name: "requires a new choice when fresh task facts changed again",
    options: { specification: "F3" },
    reason: "NewFingerprintChoiceRequired",
    tag: "AttemptRestartRejected"
  },
  {
    name: "requires a new choice when F3 arrives during the final target-head read",
    options: { factsChangeDuringTargetRead: true },
    reason: "NewFingerprintChoiceRequired",
    tag: "AttemptRestartRejected"
  },
  {
    name: "waits when the exact claim is absent",
    options: { claim: "Absent" },
    reason: "ClaimAbsent",
    tag: "AttemptRestartPending"
  },
  {
    name: "waits when a foreign owner holds the claim",
    options: { claim: "Foreign" },
    reason: "ClaimForeign",
    tag: "AttemptRestartPending"
  },
  {
    name: "does not substitute a claim reacquired after Restart for exact K1",
    options: { postChoiceClaimReacquired: true },
    reason: "ClaimForeign",
    tag: "AttemptRestartPending"
  },
  {
    name: "waits when the claim remains unreadable",
    options: { claim: "Unreadable" },
    reason: "ClaimUnreadable",
    tag: "AttemptRestartPending"
  },
  {
    name: "waits when W1 is not ready",
    options: { worktree: "NotReady" },
    reason: "OldWorktreeNotReady",
    tag: "AttemptRestartPending"
  },
  {
    name: "waits when fresh task facts are unreadable",
    options: { taskFacts: "Unreadable" },
    reason: "TaskFactsUnreadable",
    tag: "AttemptRestartPending"
  },
  ...(["Adapter", "Projection", "Read"] as const).map((taskFactsFailure) => ({
    name: `waits when the graph read fails through ${taskFactsFailure}`,
    options: { taskFactsFailure },
    reason: "TaskFactsUnreadable" as const,
    tag: "AttemptRestartPending" as const
  })),
  ...(["Adapter", "Fixture", "Read"] as const).map((specificationFailure) => ({
    name: `waits when the specification read fails through ${specificationFailure}`,
    options: { specificationFailure },
    reason: "TaskFactsUnreadable" as const,
    tag: "AttemptRestartPending" as const
  })),
  {
    name: "waits when the changed task is not currently eligible",
    options: { taskEligible: false },
    reason: "TaskNotEligible",
    tag: "AttemptRestartPending"
  },
  {
    name: "waits when W1 is unreadable",
    options: { worktree: "Unreadable" },
    reason: "OldWorktreeUnreadable",
    tag: "AttemptRestartPending"
  },
  {
    name: "waits when H2 is unreadable",
    options: { target: "Unreadable" },
    reason: "TargetHeadUnreadable",
    tag: "AttemptRestartPending"
  },
  {
    name: "rejects replacement after a Completed terminal",
    options: { executor: "Completed" },
    reason: "CompletedDoesNotAuthorizeReplacement",
    tag: "AttemptRestartRejected"
  },
  {
    name: "rejects replacement after a Failed terminal",
    options: { executor: "Failed" },
    reason: "FailedDoesNotAuthorizeReplacement",
    tag: "AttemptRestartRejected"
  }
] as const

for (const fixture of nonAuthorizingCases) {
  it.effect(fixture.name, () =>
    exerciseRestart(fixture.options).pipe(
      Effect.tap(({ plannerCalls, records, result }) =>
        Effect.sync(() => {
          expect(result).toMatchObject({ _tag: fixture.tag, reason: fixture.reason })
          expect(plannerCalls).toBe(0)
          expect(records.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
          expect(records.some(({ event }) => event._tag === "TaskClaimReleaseIntended")).toBe(false)
          expect(records.some(({ event }) => event._tag === "TaskWorktreeReconciliationIntended")).toBe(false)
          if (
            fixture.reason === "TaskFactsUnreadable" ||
            fixture.reason === "OldWorktreeUnreadable" ||
            fixture.reason === "TargetHeadUnreadable"
          ) {
            expect(records.filter(({ event }) => event._tag === "AttemptRestartAuthorityReadFailed")).toHaveLength(1)
            const failure = records.find(({ event }) => event._tag === "AttemptRestartAuthorityReadFailed")?.event
            if (failure?._tag !== "AttemptRestartAuthorityReadFailed") {
              return expect.fail("expected Restart authority read failure")
            }
            const withoutIntent = records.filter(
              ({ event }) =>
                !(
                  (event._tag === "TaskTrackerReadIntentRecorded" || event._tag === "GitReadIntentRecorded") &&
                  event.operation.operationId === failure.operationId
                )
            )
            expect(reduceWorkflowJournalHistory(runId, withoutIntent)._tag).toBe("InvalidWorkflowJournalHistory")
            const withoutApplication = records.filter(
              ({ event }) =>
                !(
                  event._tag === "AttemptChoiceApplied" &&
                  event.choice === "RestartTaskImplementation" &&
                  event.requestId.nonce === failure.requestId.nonce
                )
            )
            expect(reduceWorkflowJournalHistory(runId, withoutApplication)._tag).toBe("InvalidWorkflowJournalHistory")
          }
          const reduction = reduceWorkflowJournalHistory(runId, records)
          expect(reduction._tag).toBe("ValidWorkflowJournalHistory")
          if (
            reduction._tag === "ValidWorkflowJournalHistory" &&
            (fixture.reason === "CompletedDoesNotAuthorizeReplacement" ||
              fixture.reason === "FailedDoesNotAuthorizeReplacement")
          ) {
            expect(deriveJournalResponsibilityFacts(reduction.runState)).toContainEqual(
              expect.objectContaining({
                disposition: expect.objectContaining({ _tag: "PlannedAttemptExecutorWorkTerminal" })
              })
            )
            expect(hasUnfinishedRunResponsibility(reduction.runState)).toBe(false)
          }
          const disposition = restartReplacementDisposition(
            records,
            plannedAttempt,
            Option.none(),
            Option.some(integrationTarget)
          )
          expect(disposition).toMatchObject({
            _tag: fixture.tag === "AttemptRestartPending" ? "AttemptRestartWait" : fixture.tag,
            reason: fixture.reason
          })
        })
      ),
      Effect.provide(attemptChoiceControlLayer),
      Effect.provide(plannedAttemptProtocolControllerLayer),
      Effect.provide(memoryJournalTestLayer)
    )
  )
}

it.effect("rejects Resume after applied Restart before recording intent or contacting the executor", () =>
  Effect.gen(function* () {
    yield* appendExposedRestart
    const resumeCalls = yield* Ref.make(0)
    const rejected = yield* resumePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          begin: unused,
          observe: unused,
          requestSuspension: unused,
          resume: () =>
            Ref.update(resumeCalls, (count) => count + 1).pipe(
              Effect.as(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
            )
        })
      ),
      Effect.flip
    )
    const records = yield* (yield* JournalStore).read(runId)
    expect(rejected).toMatchObject({
      _tag: "PlannedAttemptExecutorResumeInvalidatedByTerminalChoice",
      choice: "RestartTaskImplementation",
      correlation
    })
    expect(yield* Ref.get(resumeCalls)).toBe(0)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(2)
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("records a later identified read after a durable Restart authority failure", () =>
  exerciseRestart({ retryAfterPending: true, taskFacts: "Unreadable" }).pipe(
    Effect.tap(({ records, result }) =>
      Effect.sync(() => {
        expect(result).toMatchObject({ _tag: "AttemptRestartPending", reason: "TaskFactsUnreadable" })
        const failureOperationIds = records.flatMap(({ event }) =>
          event._tag === "AttemptRestartAuthorityReadFailed" ? [event.operationId] : []
        )
        expect(failureOperationIds).toHaveLength(2)
        expect(new Set(failureOperationIds).size).toBe(2)
      })
    ),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("keeps D1 permanently stale after F3 even when a later read returns F2 again", () =>
  exerciseRestart({ retryAfterPending: true, specification: "F3ThenF2" }).pipe(
    Effect.tap(({ plannerCalls, records, result }) =>
      Effect.sync(() => {
        expect(result).toMatchObject({ _tag: "AttemptRestartRejected", reason: "NewFingerprintChoiceRequired" })
        expect(plannerCalls).toBe(0)
        expect(records.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
      })
    ),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects a Restart authority failure whose read intent predates the applied choice", () =>
  exerciseRestart({ taskFacts: "Unreadable" }).pipe(
    Effect.tap(({ records }) =>
      Effect.sync(() => {
        const failure = records.find(({ event }) => event._tag === "AttemptRestartAuthorityReadFailed")?.event
        if (failure?._tag !== "AttemptRestartAuthorityReadFailed") return expect.fail("expected read failure")
        const intentIndex = records.findIndex(
          ({ event }) =>
            event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === failure.operationId
        )
        const applicationIndex = records.findIndex(
          ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
        )
        const intent = records[intentIndex]
        if (intent === undefined || intentIndex < 0 || applicationIndex < 0) {
          return expect.fail("expected applied Restart and matching read intent")
        }
        const withoutIntent = records.filter((_, index) => index !== intentIndex)
        const shiftedApplicationIndex = withoutIntent.findIndex(
          ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
        )
        const forged = [
          ...withoutIntent.slice(0, shiftedApplicationIndex),
          intent,
          ...withoutIntent.slice(shiftedApplicationIndex)
        ].map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))

        const reduction = reduceWorkflowJournalHistory(runId, forged)
        expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
        if (reduction._tag !== "InvalidWorkflowJournalHistory") return
        expect(reduction.issues).toContainEqual(
          expect.objectContaining({
            detail: `Restart authority read failure ${failure.operationId} requires its exact prior task or Git read intent`
          })
        )
      })
    ),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("recovers an ambiguously acknowledged replacement append as exact P2 without allocating P3", () =>
  exerciseRestart({ ambiguousReplacementAppend: true }).pipe(
    Effect.tap(({ ambiguousFailure, plannerCalls, records, result }) =>
      Effect.sync(() => {
        expect(ambiguousFailure?._tag).toBe("JournalStorageUnavailable")
        expect(result._tag).toBe("PlannedAttemptReplacementRecorded")
        expect(plannerCalls).toBe(1)
        const replacements = records.filter(({ event }) => event._tag === "PlannedAttemptReplaced")
        expect(replacements).toHaveLength(1)
        expect(replacements[0]?.event).toMatchObject({ successorPlan: { plannedAttempt: successorAttempt }, subject })
        expect(
          records.filter(
            ({ event }) =>
              (event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.taskId === taskId) ||
              (event._tag === "PlannedAttemptReplaced" && event.successorPlan.plannedAttempt.taskId === taskId)
          )
        ).toHaveLength(2)
        expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
      })
    ),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)
