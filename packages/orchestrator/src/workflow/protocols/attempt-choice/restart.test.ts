import { it } from "@effect/vitest"
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
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { makeTaskWorkSpecification } from "../../../authorities/task-tracker/task-work-specification.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "../../../workflow-journal/journaled-interpreter.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
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
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation
} from "../../registry/operation.js"
import {
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
import { AttemptChoiceRequestId } from "./events.js"
import { advanceAttemptRestart } from "./restart.js"

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
  readonly ambiguousReplacementAppend?: boolean
  readonly claim?: "Absent" | "Exact" | "Foreign" | "Unreadable"
  readonly executor?: "Completed" | "Failed" | "Running"
  readonly specification?: "F2" | "F3"
  readonly worktree?: "NotReady" | "Ready"
}

const exerciseRestart = (options: RestartHarnessOptions) =>
  Effect.gen(function* () {
    yield* appendExposedRestart
    const plannerCalls = yield* Ref.make(0)
    const executorReport =
      options.executor === "Completed"
        ? PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
        : options.executor === "Failed"
          ? PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
          : PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    const executor = PlannedAttemptExecutor.of({
      project: unused,
      requestSuspension: () => Effect.succeed(executorReport),
      startOrContinue: () => Effect.succeed(executorReport)
    })
    if (options.executor !== undefined) {
      yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    }
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
                    options.claim === "Absent"
                      ? { _tag: "UnclaimedTask" as const, taskId }
                      : options.claim === "Foreign"
                        ? foreignClaim
                        : exactClaim
                })
              ),
        readTaskWorktree: () =>
          Effect.succeed(
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
          Effect.succeed(
            AuthoritativeTargetLineageObserved.make({
              observation: TargetLineageObservation.make({
                plannedBaseIsAncestorOfTargetHead: true,
                plannedBaseSha: baseSha,
                targetHeadSha
              })
            })
          ),
        readTrackerGraph: () => Effect.succeed(graph),
        readTaskWorkSpecification: () =>
          Effect.succeed(options.specification === "F3" ? thirdSpecification : changedSpecification),
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    )
    const durableJournal = yield* JournalStore
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
          plan: (_specification, selectedBaseSha) =>
            Ref.update(plannerCalls, (count) => count + 1).pipe(
              Effect.as(PlannedTaskAttempt.make({ ...successorAttempt, baseSha: selectedBaseSha ?? targetHeadSha }))
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
    const result = yield* restart
    return {
      ambiguousFailure,
      plannerCalls: yield* Ref.get(plannerCalls),
      records: yield* (yield* JournalStore).read(runId),
      result
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
      plan: (_specification, selectedBaseSha) =>
        Ref.update(plannerCalls, (count) => count + 1).pipe(
          Effect.as(PlannedTaskAttempt.make({ ...successorAttempt, baseSha: selectedBaseSha ?? targetHeadSha }))
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
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
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
          expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
        })
      ),
      Effect.provide(attemptChoiceControlLayer),
      Effect.provide(plannedAttemptProtocolControllerLayer),
      Effect.provide(legacyMemoryJournalStoreLayer)
    )
  )
}

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
