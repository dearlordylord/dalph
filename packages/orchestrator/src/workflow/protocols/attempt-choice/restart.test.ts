import { it } from "@effect/vitest"
import { taskTrackerGraphFactsObserved } from "../../../../test/task-tracker-facts.js"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
import { GitWorktreeReadFailure, PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { GitTargetLineageReadFailure, TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { FixtureReadError } from "../../../authorities/task-tracker/graph-reader.js"
import { projectTrackerSnapshot } from "../../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { makeTaskWorkSpecification } from "../../../authorities/task-tracker/task-work-specification.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { makeRunRecoveryProjection } from "../../../coordination/run/recovery-activation.js"
import { causalPredecessorOperationIds } from "../../causal-history.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { journaledWorkflowInterpreterLayer } from "../../../workflow-journal/journaled-interpreter.js"
import {
  attemptPlanRecordKey,
  attemptChoiceAppliedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  taskClaimReacquisitionDirectedRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, JournalStorageUnavailable, JournalStore } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTargetLineageObserved,
  AuthoritativeTaskClaimObserved,
  TaskClaimObservationUnreadable,
  WorkflowInterpreter
} from "../../interpretation/interpreter.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
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
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import { continuePlannedAttemptExecutorWork } from "../planned-attempt-executor-work/guarded-protocol.js"
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
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }),
      version: workflowJournalEventVersion
    })
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
  readonly executor?: "Completed" | "Contradictory" | "Failed" | "Running" | "RunningUntilReadOnlySafe" | "Unavailable"
  readonly factsChangeDuringTargetRead?: boolean
  readonly postChoiceClaimReacquired?: boolean
  readonly specification?: "F2" | "F3" | "F3ThenF2"
  readonly target?: "Readable" | "Unreadable"
  readonly taskEligible?: boolean
  readonly taskFacts?: "Readable" | "Unreadable"
  readonly retryAfterPending?: boolean
  readonly restartAttempts?: number
  readonly worktree?: "NotReady" | "Ready" | "Unreadable"
}

const exerciseRestart = (options: RestartHarnessOptions) =>
  Effect.gen(function* () {
    yield* appendExposedRestart
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
    const suspensionCalls = yield* Ref.make(0)
    const executorReport =
      options.executor === "Completed"
        ? PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
        : options.executor === "Failed"
          ? PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
          : PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    const exactProjection = (report: PlannedAttemptExecutorReport) =>
      PlannedAttemptExecutorProjection.cases.Exact.make({ report })
    const executor = PlannedAttemptExecutor.of({
      project: () =>
        options.executor === "Unavailable"
          ? Effect.succeed(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }))
          : options.executor === "RunningUntilReadOnlySafe"
            ? Effect.succeed(exactProjection(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })))
            : options.executor === "Contradictory"
              ? Effect.succeed(
                  PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
                    expected: correlation,
                    observed: PlannedAttemptExecutorReport.cases.Running.make({
                      correlation: { attemptId: AttemptId.make("attempt-restart-other"), runId }
                    })
                  })
                )
              : unused(),
      requestSuspension: () => Ref.update(suspensionCalls, (count) => count + 1).pipe(Effect.as(executorReport)),
      startOrContinue: () => Effect.succeed(executorReport)
    })
    if (options.executor === "Unavailable" || options.executor === "Contradictory") {
      const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
      yield* (yield* JournalStore).append(
        runId,
        plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "StartOrContinue",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: commandOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
    } else if (options.executor !== undefined) {
      yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
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
        readTrackerGraph: () =>
          options.taskFacts === "Unreadable"
            ? Effect.fail(new FixtureReadError({ detail: "task facts unreadable", target }))
            : Effect.succeed(options.taskEligible === false ? independentOnlyGraph : graph),
        readTaskWorkSpecification: () =>
          Ref.getAndUpdate(specificationReads, (count) => count + 1).pipe(
            Effect.map((count) =>
              options.specification === "F3" || (options.specification === "F3ThenF2" && count === 0)
                ? thirdSpecification
                : changedSpecification
            )
          ),
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
                  Effect.as(PlannedTaskAttempt.make({ ...successorAttempt, baseSha: planningRequest.baseSha }))
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
      result,
      suspensionCalls: yield* Ref.get(suspensionCalls)
    }
  })

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
    const executor = PlannedAttemptExecutor.of({ project: unused, requestSuspension: unused, startOrContinue: unused })

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
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("exposes the same exact attempt choice for a replacement-recorded successor", () =>
  Effect.gen(function* () {
    yield* exerciseRestart({})
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(successorAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: successorAttempt,
        version: workflowJournalEventVersion
      })
    )
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(successorAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt: successorAttempt,
        version: workflowJournalEventVersion
      })
    )
    const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(successorAttempt.attemptId, reportOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
          correlation: { attemptId: successorAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    )
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("lets a new F3 Continue replace the stale F2 Restart recovery disposition", () =>
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
    yield* (yield* AttemptChoiceControl).apply({
      choice: "ContinueExistingAttempt",
      requestId: continueRequestId,
      subject: { observedTaskRevision: thirdSpecification.fingerprint, plannedAttempt }
    })

    const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget)
    const frontier = (yield* recovery.readDeliveryProjection).frontier

    expect(frontier.explanations).not.toContainEqual(
      expect.objectContaining({ _tag: "AttemptRestartRejected", reason: "NewFingerprintChoiceRequired", taskId })
    )
    expect(frontier.transitions).toContainEqual(
      expect.objectContaining({ _tag: "ObservePlannedAttemptContinuationGraph", plannedAttempt })
    )
  }).pipe(
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    name: "waits when executor state is unavailable",
    options: { executor: "Unavailable" },
    reason: "ExecutorUnavailable",
    tag: "AttemptRestartPending"
  },
  {
    name: "waits when executor correlation is contradictory",
    options: { executor: "Contradictory" },
    reason: "ExecutorContradictory",
    tag: "AttemptRestartPending"
  },
  {
    name: "waits when the executor still reports Running",
    options: { executor: "Running" },
    reason: "ExecutorRunning",
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
          }
          expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
        })
      ),
      Effect.provide(attemptChoiceControlLayer),
      Effect.provide(plannedAttemptProtocolControllerLayer),
      Effect.provide(legacyMemoryJournalStoreLayer)
    )
  )
}

it.effect("uses read-only safe evidence after three consecutive Running suspension responses", () =>
  exerciseRestart({ executor: "RunningUntilReadOnlySafe", restartAttempts: 4 }).pipe(
    Effect.tap(({ records, result, suspensionCalls }) =>
      Effect.sync(() => {
        expect(result._tag).toBe("PlannedAttemptReplacementRecorded")
        expect(suspensionCalls).toBe(3)
        expect(
          records.filter(
            ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
          )
        ).toHaveLength(3)
        expect(
          records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorStateObserved" &&
              event.observation._tag === "ExactExecutorReport" &&
              event.observation.report._tag === "SafelySuspended"
          )
        ).toBe(true)
        expect(records.filter(({ event }) => event._tag === "PlannedAttemptReplaced")).toHaveLength(1)
      })
    ),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)
