// @effect-diagnostics multipleEffectProvide:off
import { it } from "@effect/vitest"
import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorRequest,
  PlannedAttemptExecutorProjection,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport,
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import {
  ControlledFakeExecutorStep,
  controlledFakePlannedAttemptExecutorLayer,
  makeControlledFakePlannedAttemptExecutorLayer
} from "../../../../test/controlled-planned-attempt-executor.js"
import { Effect, Layer, Option, Ref, Schema } from "effect"
import { expect } from "vitest"
import {
  ControlDirectionApplication,
  controlDirectionApplicationLayer
} from "../control-direction-application/protocol.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import { type JournalRecord, JournalStore } from "../../../workflow-journal/store.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../registry/event.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { PlannedAttemptProtocolController, plannedAttemptProtocolControllerLayer } from "./protocol-controller.js"
import { publishPlannedAttemptExecutorProjectionResultWithPermit } from "./protocol.js"
import { makeRunRecoveryProjection } from "../../../coordination/run/recovery-activation.js"
import { requiredPlannedAttemptPositionsOf } from "../../../coordination/run/required-planned-attempt-positions.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorCommandResponseContradictedEvent,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "./events.js"
import {
  beginPlannedAttemptExecutorWork,
  observePlannedAttemptExecutorState,
  requestPlannedAttemptExecutorSuspension,
  resumePlannedAttemptExecutorWork
} from "./guarded-protocol.js"
import { hasValidAcceptedPlannedAttemptExecutorLifecycleHistory } from "./lifecycle-history.js"
import { reconstructRunState } from "../../../coordination/reconstruction/reduce.js"
import { deriveRunnableFrontier, RunnableFrontierTransition } from "../../../coordination/frontier/frontier.js"
import { makeSelectedTransitionIdentity } from "../../../coordination/activation/selected-transition.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation
} from "../../registry/operation.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTaskClaimObserved,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../interpretation/interpreter.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { projectTrackerSnapshot } from "../../../authorities/task-tracker/graph.js"
import { journaledWorkflowInterpreterLayer } from "../../../workflow-journal/journaled-interpreter.js"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import {
  TaskTrackerFactsObservedEvent,
  makeFocusedTaskWorkSpecificationFactsObserved
} from "../../task-tracker-facts/observation.js"

const currentSpecification = makeTaskWorkSpecification({
  body: "Complete task A.",
  taskId: TaskId.make("A"),
  title: "Complete A"
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-A-3"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-A-3"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId: RunId.make("R"),
  taskId: TaskId.make("A"),
  taskRevision: currentSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/attempt-A-3")
})

const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
const executorRequest = (attempt: PlannedTaskAttempt = plannedAttempt) =>
  PlannedAttemptExecutorRequest.make({ plannedAttempt: attempt, specification: currentSpecification })
const stateObservationAttempt = PlannedTaskAttempt.make({
  ...plannedAttempt,
  attemptId: AttemptId.make("attempt-A-state-observation"),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-A-state-observation"),
  worktree: WorktreeLocator.make("/worktrees/attempt-A-state-observation")
})
const stateObservationCorrelation = plannedAttemptExecutorCorrelation(stateObservationAttempt)

const noReport = () => PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
const exactProjection = (report: PlannedAttemptExecutorReport) =>
  PlannedAttemptExecutorProjection.cases.Exact.make({ report })
const contradictoryProjection = (observed: PlannedAttemptExecutorReport) =>
  PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({ expected: correlation, observed })

const taskClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("planned-attempt-executor-claim"),
  owner: ClaimOwner.make("planned-attempt-executor-owner"),
  taskId: plannedAttempt.taskId,
  token: ClaimToken.make("planned-attempt-executor-token")
})
const taskClaimOperation = makeTaskClaimAcquisitionOperation({ acquisition: taskClaim, predecessorOperationIds: [] })
const appendTaskClaim = Effect.gen(function* () {
  const journal = yield* JournalStore
  yield* journal.append(
    plannedAttempt.runId,
    intentRecordKey(taskClaim.operationId),
    TaskClaimAcquisitionIntendedEvent.make({ operation: taskClaimOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    plannedAttempt.runId,
    outcomeRecordKey(taskClaim.operationId),
    TaskClaimAcquiredEvent.make({ claim: taskClaim, version: workflowJournalEventVersion })
  )
})
const appendTaskWorkSpecification = (specification = currentSpecification, suffix = "planned-attempt-executor") =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const operation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make(`${suffix}-specification`),
      recoveryTarget,
      specification.taskId,
      []
    )
    yield* journal.append(
      plannedAttempt.runId,
      intentRecordKey(operation.operationId),
      taskTrackerReadIntent(operation)
    )
    yield* journal.append(
      plannedAttempt.runId,
      outcomeRecordKey(operation.operationId),
      TaskTrackerFactsObservedEvent.make({
        observation: makeFocusedTaskWorkSpecificationFactsObserved(operation, specification),
        operationId: operation.operationId,
        version: workflowJournalEventVersion
      })
    )
  })
const recoveryTarget = FixtureTarget.make("planned-attempt-executor-recovery-target")
const projectedCurrentGraph = projectTrackerSnapshot({
  revision: "planned-attempt-executor-current-graph",
  tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
})
const currentGraph = Option.getOrThrow(
  Option.fromUndefinedOr(projectedCurrentGraph._tag === "Valid" ? projectedCurrentGraph.snapshot : undefined)
)
const currentFactsProviderLayer = Layer.succeed(
  WorkflowInterpreter,
  WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("unused"),
    readTaskClaim: () => Effect.succeed(AuthoritativeTaskClaimObserved.make({ observation: taskClaim })),
    readTaskWorktree: () =>
      Effect.succeed(
        AuthoritativePlannedAttemptWorktreeObserved.make({
          observation: PlannedWorktreeReady.make({
            baseSha: plannedAttempt.baseSha,
            branch: plannedAttempt.branch,
            headSha: plannedAttempt.baseSha,
            worktree: plannedAttempt.worktree
          })
        })
      ),
    readTargetLineage: () => Effect.die("unused target-lineage observation"),
    readTrackerGraph: () => Effect.succeed(currentGraph),
    readTaskWorkSpecification: () => Effect.succeed(currentSpecification),
    reconcileTaskWorktree: () => Effect.die("unused"),
    recordTaskAttemptPlan: () => Effect.die("unused"),
    releaseTaskClaim: () => Effect.die("unused")
  })
)
const currentFactsInterpreterLayer = journaledWorkflowInterpreterLayer(plannedAttempt.runId, currentFactsProviderLayer)

it.effect("supplies the exact planned task specification to the injected executor", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const specificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("planned-attempt-executor-specification"),
      recoveryTarget,
      plannedAttempt.taskId,
      []
    )
    yield* journal.append(
      plannedAttempt.runId,
      JournalRecordKey.make("planned-attempt-executor-specification"),
      TaskTrackerFactsObservedEvent.make({
        observation: makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, currentSpecification),
        operationId: specificationOperation.operationId,
        version: workflowJournalEventVersion
      })
    )
    const received = yield* Ref.make<unknown>(undefined)
    const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.succeed(exactProjection(report)),
          requestSuspension: () => Effect.die("unused"),
          begin: (request) => Ref.set(received, request).pipe(Effect.as(report)),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    expect(yield* Ref.get(received)).toMatchObject({ plannedAttempt, specification: currentSpecification })
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("reconstructs the original specification when later and duplicate evidence coexist", () =>
  Effect.gen(function* () {
    const changedSpecification = makeTaskWorkSpecification({
      body: "Changed F2 instructions.",
      taskId: plannedAttempt.taskId,
      title: "Changed F2"
    })
    yield* appendTaskWorkSpecification(currentSpecification, "original")
    yield* appendTaskWorkSpecification(changedSpecification, "changed")
    yield* appendTaskWorkSpecification(currentSpecification, "duplicate")
    const received = yield* Ref.make<unknown>(undefined)
    const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused"),
          begin: (request) => Ref.set(received, request).pipe(Effect.as(report)),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    expect(yield* Ref.get(received)).toEqual({ plannedAttempt, specification: currentSpecification })
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("passes the fresh selection value without rereading journal evidence", () =>
  Effect.gen(function* () {
    const received = yield* Ref.make<unknown>(undefined)
    const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    yield* beginPlannedAttemptExecutorWork(plannedAttempt, currentSpecification).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused"),
          begin: (request) => Ref.set(received, request).pipe(Effect.as(report)),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    expect(yield* Ref.get(received)).toEqual({ plannedAttempt, specification: currentSpecification })
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a fresh selected specification mismatch before executor contact", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const changedSpecification = makeTaskWorkSpecification({
      body: "Changed F2 instructions.",
      taskId: plannedAttempt.taskId,
      title: "Changed F2"
    })
    const failure = yield* beginPlannedAttemptExecutorWork(plannedAttempt, changedSpecification).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused"),
          begin: () => Effect.die("must not contact begin"),
          resume: () => Effect.die("must not contact resume")
        })
      ),
      Effect.flip
    )
    expect(failure._tag).toBe("PlannedAttemptExecutorTaskWorkSpecificationMismatch")
    expect(yield* Ref.get(calls)).toBe(0)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("does not journal a mismatched command and retries with one exact intent", () =>
  Effect.gen(function* () {
    const changedSpecification = makeTaskWorkSpecification({
      body: "Changed F2 instructions.",
      taskId: plannedAttempt.taskId,
      title: "Changed F2"
    })
    const calls = yield* Ref.make(0)
    const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.die("the command must not project before contact"),
      requestSuspension: () => Effect.die("unused suspension"),
      begin: (request) =>
        Effect.gen(function* () {
          expect(request).toEqual({ plannedAttempt, specification: currentSpecification })
          yield* Ref.update(calls, (count) => count + 1)
          return report
        }),
      resume: () => Effect.die("unused resume")
    })
    const mismatch = yield* beginPlannedAttemptExecutorWork(plannedAttempt, changedSpecification).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.flip
    )
    expect(mismatch._tag).toBe("PlannedAttemptExecutorTaskWorkSpecificationMismatch")

    const journal = yield* JournalStore
    expect((yield* journal.read(plannedAttempt.runId)).map(({ event }) => event._tag)).toEqual([
      "PlannedAttemptExecutorWorkResponsibilityBegan"
    ])

    expect(
      yield* beginPlannedAttemptExecutorWork(plannedAttempt, currentSpecification).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    ).toEqual(report)
    expect(yield* Ref.get(calls)).toBe(1)
    expect((yield* journal.read(plannedAttempt.runId)).map(({ event }) => event._tag)).toEqual([
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseObserved",
      "PlannedAttemptExecutorWorkReported"
    ])
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("reports task-scoped missing specification without unrelated witness text", () =>
  Effect.gen(function* () {
    const unrelatedSpecification = makeTaskWorkSpecification({
      body: "Unrelated task instructions.",
      taskId: TaskId.make("unrelated-task"),
      title: "Unrelated task"
    })
    yield* appendTaskWorkSpecification(unrelatedSpecification, "unrelated")
    const failure = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("missing specification must fail before projection"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("missing specification must not begin executor work"),
          resume: () => Effect.die("missing specification must not resume executor work")
        })
      ),
      Effect.flip
    )
    expect(failure).toMatchObject({ _tag: "PlannedAttemptExecutorTaskWorkSpecificationMissing", correlation })
    expect((yield* (yield* JournalStore).read(plannedAttempt.runId)).map(({ event }) => event._tag)).toEqual([
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "PlannedAttemptExecutorWorkResponsibilityBegan"
    ])
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("drives one planned attempt through the generic executor boundary", () =>
  Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor

    expect(yield* executor.begin(executorRequest())).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    )
    expect(yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })).toEqual(
      exactProjection(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    )
    expect(
      yield* executor.observe(
        { runId: correlation.runId, attemptId: correlation.attemptId },
        { _tag: "PassiveLifecycleObservation" }
      )
    ).toEqual(yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" }))
  }).pipe(
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.Begin.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        })
      ])
    )
  )
)

it.effect("rejects exhausted, wrong-kind, and wrong-correlation fake requests", () =>
  Effect.gen(function* () {
    const emptyExecutor = yield* PlannedAttemptExecutor
    expect(yield* emptyExecutor.observe(correlation, { _tag: "PassiveLifecycleObservation" })).toEqual(noReport())
    const exhausted = yield* emptyExecutor.begin(executorRequest()).pipe(Effect.flip)
    expect(exhausted.detail).toContain("has no cassette entry")

    const suspendStep = ControlledFakeExecutorStep.cases.Suspend.make({
      correlation,
      report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    })
    const wrongKind = yield* PlannedAttemptExecutor.pipe(
      Effect.flatMap((executor) => executor.begin(executorRequest())),
      Effect.provide(makeControlledFakePlannedAttemptExecutorLayer([suspendStep])),
      Effect.flip
    )
    expect(wrongKind.detail).toContain("expected Suspend")

    const otherAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, attemptId: AttemptId.make("other-attempt") })
    const wrongCorrelation = yield* PlannedAttemptExecutor.pipe(
      Effect.flatMap((executor) => executor.begin(executorRequest(otherAttempt))),
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.Begin.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
          })
        ])
      ),
      Effect.flip
    )
    expect(wrongCorrelation.detail).toContain("other-attempt")
  }).pipe(Effect.provide(makeControlledFakePlannedAttemptExecutorLayer([])))
)

it.effect("projects default fake reports and safely suspends without a survivor lookup", () =>
  Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })).toEqual(noReport())
    const suspended = yield* executor.requestSuspension(plannedAttempt)
    expect(suspended).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }))
    expect(yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })).toEqual(
      exactProjection(suspended)
    )
    expect(yield* executor.begin(executorRequest())).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    )
  }).pipe(Effect.provide(controlledFakePlannedAttemptExecutorLayer))
)

it.effect("rejects a cassette response for a different planned attempt", () =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(ControlledFakeExecutorStep)(
      ControlledFakeExecutorStep.cases.Begin.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
    )
    const decoded = yield* Schema.decodeUnknownEffect(ControlledFakeExecutorStep)({
      _tag: "Begin",
      correlation,
      report: {
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: AttemptId.make("different"), runId: correlation.runId }
      }
    }).pipe(Effect.flip)
    expect(String(decoded)).toContain("controlled fake request and report must name the same planned attempt")
  })
)

it.effect("journals a contradictory executor response and reconciles its exact command before retry", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const wrongReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: { attemptId: AttemptId.make("wrong-attempt"), runId: plannedAttempt.runId }
    })
    const mismatch = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused"),
          begin: () => Effect.succeed(wrongReport),
          resume: () => Effect.die("unused resume")
        })
      ),
      Effect.flip
    )
    expect(mismatch._tag).toBe("PlannedAttemptExecutorCorrelationMismatch")
    const journal = yield* JournalStore
    const afterContradiction = yield* journal.read(plannedAttempt.runId)
    expect(afterContradiction.map(({ event }) => event._tag)).toEqual([
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseContradicted"
    ])
    expect(afterContradiction.at(-1)?.event).toMatchObject({
      _tag: "PlannedAttemptExecutorCommandResponseContradicted",
      commandOrdinal: 1,
      observed: wrongReport,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt
    })

    const projectedReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    expect(
      yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            observe: () => Effect.succeed(exactProjection(projectedReport)),
            requestSuspension: () => Effect.die("unused"),
            begin: () => Effect.die("must reconcile before another begin command"),
            resume: () => Effect.die("must reconcile before a resume command")
          })
        )
      )
    ).toEqual(projectedReport)
    expect((yield* journal.read(plannedAttempt.runId)).map(({ event }) => event._tag)).toEqual([
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseContradicted",
      "PlannedAttemptExecutorCommandProjectionObserved",
      "PlannedAttemptExecutorWorkReported"
    ])
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("continues an exact planned attempt through the executor protocol", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    yield* (yield* JournalStore).append(
      plannedAttempt.runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make("direct-recovered-plan"),
          plannedAttempt,
          predecessorOperationIds: []
        }),
        version: workflowJournalEventVersion
      })
    )
    expect(yield* beginPlannedAttemptExecutorWork(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    )
  }).pipe(
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer),
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.Begin.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        })
      ])
    ),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
        readTrackerGraph: () => Effect.die("unused"),
        readTaskWorkSpecification: () => Effect.die("unused"),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused"),
        releaseTaskClaim: () => Effect.die("unused")
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)

it.effect("projects one unmatched begin without duplicating it and thereafter only observes", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const journal = yield* JournalStore
    const commandCalls = yield* Ref.make(0)
    const firstCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, firstCommandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: firstCommandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const projected = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const nextResponse = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.succeed(exactProjection(projected)),
      requestSuspension: () => Effect.die("unused suspension"),
      begin: () => Ref.update(commandCalls, (count) => count + 1).pipe(Effect.as(nextResponse)),
      resume: () => Effect.die("unused resume")
    })

    expect(
      yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    ).toEqual(projected)
    expect(yield* Ref.get(commandCalls)).toBe(0)
    expect(
      (yield* journal.read(plannedAttempt.runId)).filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended"
      )
    ).toHaveLength(1)

    expect(
      yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    ).toEqual(projected)
    expect(yield* Ref.get(commandCalls)).toBe(0)
    expect(
      (yield* journal.read(plannedAttempt.runId)).filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended"
      )
    ).toHaveLength(1)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("does not manufacture executor-work responsibility from a read-only observation", () =>
  Effect.gen(function* () {
    const projectionCalls = yield* Ref.make(0)
    const missing = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Ref.update(projectionCalls, (count) => count + 1).pipe(Effect.as(noReport())),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      ),
      Effect.flip
    )
    expect(missing._tag).toBe("PlannedAttemptExecutorResponsibilityMissing")
    expect(yield* Ref.get(projectionCalls)).toBe(0)
    expect(yield* (yield* JournalStore).read(plannedAttempt.runId)).toEqual([])
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a first passive lifecycle report without an exact settled Begin", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )

    const contradiction = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          begin: () => Effect.die("passive observation must not begin"),
          observe: () => Effect.succeed(exactProjection(executing)),
          requestSuspension: () => Effect.die("passive observation must not suspend"),
          resume: () => Effect.die("passive observation must not resume")
        })
      ),
      Effect.flip
    )

    expect(contradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorInitialReportCausalityContradiction",
      observed: executing
    })
    const records = yield* journal.read(plannedAttempt.runId)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(0)
    expect(records.at(-1)?.event).toMatchObject({
      _tag: "PlannedAttemptExecutorStateObserved",
      observation: { _tag: "ExecutorInitialReportCausalityContradiction", observed: executing }
    })
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a Safe response to Begin without accepting lifecycle authority", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const executor = PlannedAttemptExecutor.of({
      begin: () => Effect.succeed(safe),
      observe: () => Effect.die("a direct Begin response must not require reconciliation"),
      requestSuspension: () => Effect.die("Begin must not request suspension"),
      resume: () => Effect.die("Begin must not resume")
    })

    const contradiction = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.flip
    )

    expect(contradiction).toMatchObject({ _tag: "PlannedAttemptExecutorBeginReportContradiction", observed: safe })
    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandResponseObserved")).toHaveLength(
      1
    )
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(0)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a passive Safe report without an exact Suspend intent", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const executor = PlannedAttemptExecutor.of({
      begin: () => Effect.succeed(executing),
      observe: () => Effect.succeed(exactProjection(safe)),
      requestSuspension: () => Effect.die("passive observation must not suspend"),
      resume: () => Effect.die("passive observation must not resume")
    })

    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provideService(PlannedAttemptExecutor, executor))
    const contradiction = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.flip
    )

    expect(contradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorLifecycleTransitionContradiction",
      accepted: executing,
      observed: safe
    })
    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(1)
    expect(records.at(-1)?.event).toMatchObject({
      _tag: "PlannedAttemptExecutorStateObserved",
      observation: { _tag: "ExecutorLifecycleTransitionContradiction", accepted: executing, observed: safe }
    })
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("accepts a passive Terminal report after accepted Safe without Resume", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    const executor = PlannedAttemptExecutor.of({
      begin: () => Effect.succeed(executing),
      observe: () => Effect.succeed(exactProjection(terminal)),
      requestSuspension: () => Effect.succeed(safe),
      resume: () => Effect.die("Terminal after Safe must not require Resume")
    })

    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provideService(PlannedAttemptExecutor, executor))
    yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor)
    )
    expect(
      yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    ).toEqual(terminal)

    expect(
      (yield* (yield* JournalStore).read(plannedAttempt.runId)).flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report._tag] : []
      )
    ).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended", "ExecutorWorkTerminal"])
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("requires exact command reconciliation before a generic executor-state observation", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const projectionCalls = yield* Ref.make(0)
    const failure = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Ref.update(projectionCalls, (count) => count + 1).pipe(Effect.as(noReport())),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      ),
      Effect.flip
    )

    expect(failure).toMatchObject({
      _tag: "PlannedAttemptExecutorCommandReconciliationRequired",
      commandOrdinal,
      correlation
    })
    expect(yield* Ref.get(projectionCalls)).toBe(0)
    expect(
      (yield* journal.read(plannedAttempt.runId)).filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorStateObserved"
      )
    ).toHaveLength(0)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("records unavailable and contradictory projections while reconciling one ambiguous command", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    const unavailable = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("reconciliation must not begin work"),
          resume: () => Effect.die("reconciliation must not resume work")
        })
      ),
      Effect.flip
    )
    expect(unavailable).toMatchObject({ _tag: "PlannedAttemptExecutorProjectionNoCurrentReport", commandOrdinal })

    const foreignCorrelation = { attemptId: AttemptId.make("foreign-projection"), runId: plannedAttempt.runId }
    const contradiction = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () =>
            Effect.succeed(
              contradictoryProjection(
                PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: foreignCorrelation })
              )
            ),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("reconciliation must not begin work"),
          resume: () => Effect.die("reconciliation must not resume work")
        })
      ),
      Effect.flip
    )
    expect(contradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorCorrelationMismatch",
      expected: correlation,
      observed: foreignCorrelation
    })

    const mismatchedProjectionCorrelation = {
      attemptId: AttemptId.make("foreign-command-projection"),
      runId: plannedAttempt.runId
    }
    const projectionMismatch = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () =>
            Effect.succeed(
              PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation: mismatchedProjectionCorrelation })
            ),
          requestSuspension: () => Effect.die("unmatched projection must not suspend"),
          begin: () => Effect.die("unmatched projection must not begin"),
          resume: () => Effect.die("unmatched projection must not resume")
        })
      ),
      Effect.flip
    )
    expect(projectionMismatch).toMatchObject({
      _tag: "PlannedAttemptExecutorProjectionCorrelationMismatch",
      expected: correlation,
      observed: mismatchedProjectionCorrelation
    })
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("accepts a settled command response before issuing another executor command", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        report: executing,
        version: workflowJournalEventVersion
      })
    )

    const calls = yield* Ref.make(0)
    expect(
      yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            observe: () => Effect.die("pending response must settle before observing"),
            requestSuspension: () => Effect.die("pending response must not suspend"),
            begin: () => Ref.update(calls, (count) => count + 1).pipe(Effect.as(executing)),
            resume: () => Effect.die("pending response must not resume")
          })
        )
      )
    ).toEqual(executing)
    expect(yield* Ref.get(calls)).toBe(0)
    expect(
      (yield* journal.read(plannedAttempt.runId)).flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report] : []
      )
    ).toEqual([executing])
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects Resume without an accepted Safe report before executor contact", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const rejected = yield* resumePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("unauthorized Resume must not observe"),
          requestSuspension: () => Effect.die("unauthorized Resume must not suspend"),
          begin: () => Effect.die("unauthorized Resume must not begin"),
          resume: () => Ref.update(calls, (count) => count + 1).pipe(Effect.as(executing))
        })
      ),
      Effect.flip
    )

    expect(rejected).toMatchObject({ _tag: "PlannedAttemptExecutorResumeNotAuthorized", correlation })
    expect(yield* Ref.get(calls)).toBe(0)
    expect(
      (yield* (yield* JournalStore).read(plannedAttempt.runId)).some(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended"
      )
    ).toBe(false)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("records unavailable and contradictory read-only executor state", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )

    const unavailable = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      ),
      Effect.flip
    )
    expect(unavailable).toMatchObject({ _tag: "PlannedAttemptExecutorStateNoCurrentReport", correlation })

    const foreignCorrelation = { attemptId: AttemptId.make("foreign-state"), runId: plannedAttempt.runId }
    const contradiction = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () =>
            Effect.succeed(
              contradictoryProjection(
                PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: foreignCorrelation })
              )
            ),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      ),
      Effect.flip
    )
    expect(contradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorCorrelationMismatch",
      expected: correlation,
      observed: foreignCorrelation
    })

    const mismatchedProjectionCorrelation = {
      attemptId: AttemptId.make("foreign-state-projection"),
      runId: plannedAttempt.runId
    }
    const projectionMismatch = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () =>
            Effect.succeed(
              PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation: mismatchedProjectionCorrelation })
            ),
          requestSuspension: () => Effect.die("unmatched state projection must not suspend"),
          begin: () => Effect.die("unmatched state projection must not begin"),
          resume: () => Effect.die("unmatched state projection must not resume")
        })
      ),
      Effect.flip
    )
    expect(projectionMismatch).toMatchObject({
      _tag: "PlannedAttemptExecutorProjectionCorrelationMismatch",
      expected: correlation,
      observed: mismatchedProjectionCorrelation
    })

    const divergent = PlannedTaskAttempt.make({ ...plannedAttempt, baseSha: GitCommitSha.make("3".repeat(40)) })
    const divergentResponsibility = yield* observePlannedAttemptExecutorState(divergent).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("contradictory responsibility must fail before projection"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.die("unused begin"),
          resume: () => Effect.die("unused resume")
        })
      ),
      Effect.flip
    )
    expect(divergentResponsibility).toMatchObject({ _tag: "PlannedAttemptExecutorResponsibilityContradiction" })
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("accepts a passive exact candidate without a second executor read", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const controller = yield* PlannedAttemptProtocolController
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    yield* appendTaskWorkSpecification()
    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("begin response must not reconcile"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.succeed(executing),
          resume: () => Effect.die("unused resume")
        })
      )
    )

    const result = yield* controller.withPermit(correlation, (permit) =>
      publishPlannedAttemptExecutorProjectionResultWithPermit(
        permit,
        plannedAttempt,
        PlannedAttemptExecutorProjection.cases.Exact.make({ report: terminal })
      )
    )

    expect(result).toEqual({ acceptedFacts: "Changed", report: terminal })
    expect((yield* journal.read(plannedAttempt.runId)).map(({ event }) => event._tag).slice(-3)).toEqual([
      "PlannedAttemptExecutorWorkReported",
      "PlannedAttemptExecutorStateObserved",
      "PlannedAttemptExecutorWorkReported"
    ])
  }).pipe(
    Effect.provideService(
      PlannedAttemptExecutor,
      PlannedAttemptExecutor.of({
        observe: () => Effect.die("an exact passive candidate must not be reread"),
        requestSuspension: () => Effect.die("unused suspension"),
        begin: () => Effect.die("unused begin"),
        resume: () => Effect.die("unused resume")
      })
    ),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("passive observation publication enters one serialized protocol owner", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const controller = yield* PlannedAttemptProtocolController
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    yield* appendTaskWorkSpecification()
    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("passive candidate publication must not reread"),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.succeed(executing),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const publish = controller.withPermit(correlation, (permit) =>
      publishPlannedAttemptExecutorProjectionResultWithPermit(
        permit,
        plannedAttempt,
        PlannedAttemptExecutorProjection.cases.Exact.make({ report: terminal })
      )
    )

    const results = yield* Effect.all([publish, publish], { concurrency: "unbounded" })
    const records = yield* journal.read(plannedAttempt.runId)

    expect(results.map(({ acceptedFacts }) => acceptedFacts).toSorted()).toEqual([
      "Changed",
      "UnchangedPassiveObservation"
    ])
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorStateObserved")).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(2)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("retains responsibility and position for absent unavailable unreadable or foreign projection", () => {
  const foreignCorrelation = { attemptId: AttemptId.make("passive-foreign-attempt"), runId: plannedAttempt.runId }
  const cases = [
    {
      error: "PlannedAttemptExecutorStateNoCurrentReport",
      observation: "ExecutorStateNoCurrentReport",
      projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
    },
    {
      error: "PlannedAttemptExecutorStateTemporarilyUnavailable",
      observation: "ExecutorStateTemporarilyUnavailable",
      projection: PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation })
    },
    {
      error: "PlannedAttemptExecutorStateUnreadable",
      observation: "ExecutorStateUnreadable",
      projection: PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation })
    },
    {
      error: "PlannedAttemptExecutorCorrelationMismatch",
      observation: "ExecutorReportContradiction",
      projection: PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
        expected: correlation,
        observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: foreignCorrelation })
      })
    }
  ] as const

  return Effect.forEach(cases, (testCase) =>
    Effect.gen(function* () {
      const journal = yield* JournalStore
      const controller = yield* PlannedAttemptProtocolController
      const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      const commandCalls = yield* Ref.make(0)
      yield* appendTaskWorkSpecification()
      yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            observe: () => Effect.die("passive candidate publication must not reread"),
            requestSuspension: () => Ref.update(commandCalls, (count) => count + 1).pipe(Effect.as(executing)),
            begin: () => Ref.update(commandCalls, (count) => count + 1).pipe(Effect.as(executing)),
            resume: () => Ref.update(commandCalls, (count) => count + 1).pipe(Effect.as(executing))
          })
        )
      )

      const failure = yield* controller
        .withPermit(correlation, (permit) =>
          publishPlannedAttemptExecutorProjectionResultWithPermit(permit, plannedAttempt, testCase.projection)
        )
        .pipe(Effect.flip)
      yield* Effect.yieldNow

      const records = yield* journal.read(plannedAttempt.runId)
      expect(failure._tag).toBe(testCase.error)
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorStateObserved" ? [event.observation._tag] : []
        )
      ).toEqual([testCase.observation])
      expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(1)
      expect(
        records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
      ).toHaveLength(1)
      const reconstruction = reconstructRunState(plannedAttempt.runId, records)
      expect(reconstruction._tag).toBe("ValidReconstructedRun")
      if (reconstruction._tag === "ValidReconstructedRun") {
        expect(requiredPlannedAttemptPositionsOf(reconstruction.state)).toEqual([
          { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
        ])
      }
      expect(yield* Ref.get(commandCalls)).toBe(1)
    }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
  )
})

it.effect("records temporary and unreadable outcomes without issuing an unmatched command", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    const projection = (outcome: PlannedAttemptExecutorProjection) =>
      PlannedAttemptExecutor.of({
        observe: () => Effect.succeed(outcome),
        requestSuspension: () => Effect.die("unused suspension"),
        begin: () => Effect.die("temporary or unreadable projection must not begin work"),
        resume: () => Effect.die("temporary or unreadable projection must not resume work")
      })
    const temporary = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        projection(PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation }))
      ),
      Effect.flip
    )
    expect(temporary).toMatchObject({
      _tag: "PlannedAttemptExecutorProjectionTemporarilyUnavailable",
      commandOrdinal,
      correlation
    })

    const unreadable = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        projection(PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation }))
      ),
      Effect.flip
    )
    expect(unreadable).toMatchObject({
      _tag: "PlannedAttemptExecutorProjectionUnreadable",
      commandOrdinal,
      correlation
    })

    const initializationContradiction = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        projection(
          PlannedAttemptExecutorProjection.cases.InitializationCorrelationContradiction.make({
            correlation,
            detail: "server platform identity contradicts the host"
          })
        )
      ),
      Effect.flip
    )
    expect(initializationContradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorInitializationCorrelationContradiction",
      correlation,
      detail: "server platform identity contradicts the host"
    })
    expect(
      (yield* journal.read(plannedAttempt.runId)).flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ? [event.observation._tag] : []
      )
    ).toEqual(["ExecutorStateTemporarilyUnavailable", "ExecutorStateUnreadable"])
    expect(
      (yield* journal.read(plannedAttempt.runId)).filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended"
      )
    ).toHaveLength(1)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("records temporary and unreadable current-state outcomes while retaining responsibility", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.append(
      stateObservationAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(stateObservationAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: stateObservationAttempt,
        version: workflowJournalEventVersion
      })
    )

    const projection = (outcome: PlannedAttemptExecutorProjection) =>
      PlannedAttemptExecutor.of({
        observe: () => Effect.succeed(outcome),
        requestSuspension: () => Effect.die("unused suspension"),
        begin: () => Effect.die("unused begin"),
        resume: () => Effect.die("unused resume")
      })
    const temporary = yield* observePlannedAttemptExecutorState(stateObservationAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        projection(
          PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({
            correlation: stateObservationCorrelation
          })
        )
      ),
      Effect.flip
    )
    expect(temporary).toMatchObject({
      _tag: "PlannedAttemptExecutorStateTemporarilyUnavailable",
      correlation: stateObservationCorrelation
    })

    const unreadable = yield* observePlannedAttemptExecutorState(stateObservationAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        projection(PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation: stateObservationCorrelation }))
      ),
      Effect.flip
    )
    expect(unreadable).toMatchObject({
      _tag: "PlannedAttemptExecutorStateUnreadable",
      correlation: stateObservationCorrelation
    })
    const initializationContradiction = yield* observePlannedAttemptExecutorState(stateObservationAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        projection(
          PlannedAttemptExecutorProjection.cases.InitializationCorrelationContradiction.make({
            correlation: stateObservationCorrelation,
            detail: "server platform identity contradicts the host"
          })
        )
      ),
      Effect.flip
    )
    expect(initializationContradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorInitializationCorrelationContradiction",
      correlation: stateObservationCorrelation,
      detail: "server platform identity contradicts the host"
    })
    expect(
      (yield* journal.read(stateObservationAttempt.runId)).flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorStateObserved" ? [event.observation._tag] : []
      )
    ).toEqual(["ExecutorStateTemporarilyUnavailable", "ExecutorStateUnreadable"])
    expect(
      (yield* journal.read(stateObservationAttempt.runId)).some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          event.plannedAttempt.attemptId === stateObservationAttempt.attemptId
      )
    ).toBe(true)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it("rejects malformed executor command and projection chronology through the public history reducer", () => {
  const responsibility = PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const command = (ordinal: number) =>
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(ordinal),
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
  const foreignExecuting = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
    correlation: { attemptId: AttemptId.make("history-foreign-executor"), runId: plannedAttempt.runId }
  })
  const report = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    }),
    version: workflowJournalEventVersion
  })
  const projection = (projectionOrdinal = 1, projectedReport: PlannedAttemptExecutorReport = executing) =>
    PlannedAttemptExecutorCommandProjectionObservedEvent.make({
      commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
        report: projectedReport
      }),
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(projectionOrdinal),
      version: workflowJournalEventVersion
    })
  const expectedCorrelationContradictionProjection = () =>
    PlannedAttemptExecutorCommandProjectionObservedEvent.make({
      commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorReportContradiction.make({
        observed: executing
      }),
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
      version: workflowJournalEventVersion
    })
  const state = (ordinal = 1, projectedReport: PlannedAttemptExecutorReport = executing) =>
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: projectedReport }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(ordinal),
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  const expectedCorrelationContradictionState = () =>
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({
        observed: executing
      }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  const responseContradiction = (commandOrdinal = 1, observed: PlannedAttemptExecutorReport = foreignExecuting) =>
    PlannedAttemptExecutorCommandResponseContradictedEvent.make({
      commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(commandOrdinal),
      observed,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  const recordsFromEvents = (events: ReadonlyArray<JournalRecord["event"]>): ReadonlyArray<JournalRecord> =>
    events.map((event, index) => ({
      event,
      key: JournalRecordKey.make(`executor-history-forged:${index}`),
      position: JournalPosition.make(index + 1),
      runId: plannedAttempt.runId
    }))
  const malformed = [
    { detail: "expected ordinal 1, found 2", events: [responsibility, command(2)] },
    { detail: "follows an unmatched prior command", events: [responsibility, command(1), command(2)] },
    { detail: "follows the terminal result", events: [responsibility, command(1), report, command(2)] },
    { detail: "has no prior matching executor-work responsibility", events: [projection()] },
    { detail: "does not name its unmatched command intent", events: [responsibility, projection()] },
    { detail: "expected ordinal 1, found 2", events: [responsibility, command(1), projection(2)] },
    {
      detail: "returned a contradictory correlation",
      events: [responsibility, command(1), projection(1, foreignExecuting)]
    },
    {
      detail: "contains the expected correlation",
      events: [responsibility, command(1), expectedCorrelationContradictionProjection()]
    },
    { detail: "has no prior matching executor-work responsibility", events: [responseContradiction()] },
    {
      detail: "does not name its unmatched command intent",
      events: [responsibility, command(1), responseContradiction(2)]
    },
    {
      detail: "contains the expected correlation",
      events: [responsibility, command(1), responseContradiction(1, executing)]
    },
    { detail: "has no prior matching executor-work responsibility", events: [state()] },
    { detail: "expected ordinal 1, found 2", events: [responsibility, state(2)] },
    { detail: "returned a contradictory correlation", events: [responsibility, state(1, foreignExecuting)] },
    { detail: "contains the expected correlation", events: [responsibility, expectedCorrelationContradictionState()] }
  ] as const

  for (const scenario of malformed) {
    const reduction = reduceWorkflowJournalHistory(plannedAttempt.runId, recordsFromEvents(scenario.events))
    expect(reduction).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining(scenario.detail) })])
    })
  }

  const unavailableProjection = PlannedAttemptExecutorCommandProjectionObservedEvent.make({
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
    observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorStateNoCurrentReport.make({}),
    occurrenceClassification: "NonActionOccurrence",
    plannedAttempt,
    projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
    version: workflowJournalEventVersion
  })
  const unavailableState = PlannedAttemptExecutorStateObservedEvent.make({
    observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({}),
    occurrenceClassification: "NonActionOccurrence",
    ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  expect(
    reduceWorkflowJournalHistory(
      plannedAttempt.runId,
      recordsFromEvents([responsibility, command(1), unavailableProjection])
    )._tag
  ).toBe("InvalidWorkflowJournalHistory")
  expect(
    reduceWorkflowJournalHistory(plannedAttempt.runId, recordsFromEvents([responsibility, unavailableState]))._tag
  ).toBe("InvalidWorkflowJournalHistory")
})

it("rejects lifecycle histories without an accepted report, exact responsibility, or prior evidence", () => {
  const responsibility = PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const terminal = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    }),
    version: workflowJournalEventVersion
  })
  const record = (
    event: JournalRecord["event"],
    position: number,
    key: string,
    runId: RunId = plannedAttempt.runId
  ): JournalRecord => ({ event, key: JournalRecordKey.make(key), position: JournalPosition.make(position), runId })
  const responsibilityRecord = record(
    responsibility,
    1,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId).toString()
  )
  const terminalRecord = record(
    terminal,
    2,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, terminal.ordinal).toString()
  )
  const stateOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
  const mismatchedEnvelopeEvidence = record(
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: terminal.report }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: stateOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    2,
    plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, stateOrdinal).toString(),
    RunId.make("foreign-envelope-run")
  )

  expect(hasValidAcceptedPlannedAttemptExecutorLifecycleHistory([responsibilityRecord], plannedAttempt)).toBe(false)
  expect(hasValidAcceptedPlannedAttemptExecutorLifecycleHistory([terminalRecord], plannedAttempt)).toBe(false)
  expect(
    hasValidAcceptedPlannedAttemptExecutorLifecycleHistory([responsibilityRecord, terminalRecord], plannedAttempt)
  ).toBe(false)
  expect(
    hasValidAcceptedPlannedAttemptExecutorLifecycleHistory(
      [responsibilityRecord, mismatchedEnvelopeEvidence, { ...terminalRecord, position: JournalPosition.make(3) }],
      plannedAttempt
    )
  ).toBe(false)
  expect(
    hasValidAcceptedPlannedAttemptExecutorLifecycleHistory(
      [
        responsibilityRecord,
        { ...responsibilityRecord, position: JournalPosition.make(2) },
        { ...terminalRecord, position: JournalPosition.make(3) }
      ],
      plannedAttempt
    )
  ).toBe(false)
})

it.effect("rejects a divergent immutable plan before recording another executor command", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const firstReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused suspension"),
          begin: () => Effect.succeed(firstReport),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const divergent = PlannedTaskAttempt.make({ ...plannedAttempt, baseSha: GitCommitSha.make("2".repeat(40)) })
    const contradiction = yield* beginPlannedAttemptExecutorWork(divergent).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () => Effect.die("must reject before projection"),
          requestSuspension: () => Effect.die("must reject before suspension"),
          begin: () => Effect.die("must reject before begin"),
          resume: () => Effect.die("must reject before resume")
        })
      ),
      Effect.flip
    )
    expect(contradiction._tag).toBe("PlannedAttemptExecutorResponsibilityContradiction")
    expect(
      (yield* (yield* JournalStore).read(plannedAttempt.runId)).filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended"
      )
    ).toHaveLength(1)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("observes unchanged executing work more than three times without durable events or another command", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const beginCalls = yield* Ref.make(0)
    const observeCalls = yield* Ref.make(0)
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const executor = PlannedAttemptExecutor.of({
      observe: () => Ref.update(observeCalls, (count) => count + 1).pipe(Effect.as(exactProjection(executing))),
      requestSuspension: () => Effect.die("unused suspension"),
      begin: () => Ref.update(beginCalls, (count) => count + 1).pipe(Effect.as(executing)),
      resume: () => Effect.die("unused resume")
    })

    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provideService(PlannedAttemptExecutor, executor))
    for (let observation = 0; observation < 5; observation += 1) {
      expect(
        yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, executor)
        )
      ).toEqual(executing)
    }
    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)

    expect(yield* Ref.get(beginCalls)).toBe(1)
    expect(yield* Ref.get(observeCalls)).toBe(5)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandResponseObserved")).toHaveLength(
      1
    )
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorStateObserved")).toHaveLength(0)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("settles an unchanged suspension response without appending another work report", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.die("no ambiguous command requires reconciliation"),
      requestSuspension: () => Effect.succeed(executing),
      begin: () => Effect.succeed(executing),
      resume: () => Effect.die("unused resume")
    })

    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provideService(PlannedAttemptExecutor, executor))
    expect(
      yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    ).toEqual(executing)

    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(2)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandResponseObserved")).toHaveLength(
      2
    )
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(1)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("reconciles a lost begin response and never repeats the once-only begin", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const calls = yield* Ref.make(0)
    const lostResponseExecutor = PlannedAttemptExecutor.of({
      observe: () =>
        Effect.succeed(exactProjection(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))),
      requestSuspension: () => Effect.die("unused suspension"),
      begin: () => Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(Effect.die("response lost"))),
      resume: () => Effect.die("unused resume")
    })

    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, lostResponseExecutor),
      Effect.exit
    )
    expect(
      yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, lostResponseExecutor)
      )
    ).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    const rejected = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, lostResponseExecutor),
      Effect.flip
    )
    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(rejected).toMatchObject({ _tag: "PlannedAttemptExecutorAlreadyBegan", correlation })
    expect(yield* Ref.get(calls)).toBe(1)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(1)
    expect(
      records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
    ).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(1)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a reconciled Safe projection for a lost Begin without accepting lifecycle authority", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.succeed(exactProjection(safe)),
      requestSuspension: () => Effect.die("Begin reconciliation must not request suspension"),
      begin: () => Effect.die("response lost"),
      resume: () => Effect.die("Begin reconciliation must not resume")
    })

    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.exit
    )
    const contradiction = yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.flip
    )

    expect(contradiction).toMatchObject({ _tag: "PlannedAttemptExecutorBeginReportContradiction", observed: safe })
    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(
      records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
    ).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(0)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects suspension before an accepted executing-work report without contacting the executor", () =>
  Effect.gen(function* () {
    const suspensionCalls = yield* Ref.make(0)
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.die("no unmatched command"),
      requestSuspension: () =>
        Ref.update(suspensionCalls, (count) => count + 1).pipe(
          Effect.andThen(Effect.die("unauthorized suspension contacted the executor"))
        ),
      begin: () => Effect.die("suspension rejection must not begin work"),
      resume: () => Effect.die("suspension rejection must not resume work")
    })

    const rejected = yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.flip
    )
    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)

    expect(rejected).toMatchObject({ _tag: "PlannedAttemptExecutorSuspensionNotAuthorized", correlation })
    expect(yield* Ref.get(suspensionCalls)).toBe(0)
    expect(
      records.filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
      )
    ).toHaveLength(0)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("never issues a fourth durable suspension command after accepted executing work", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const calls = yield* Ref.make(0)
    const alwaysExecuting = PlannedAttemptExecutor.of({
      observe: () => Effect.die("no unmatched command"),
      requestSuspension: () =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.as(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
        ),
      begin: () => Effect.succeed(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })),
      resume: () => Effect.die("unused resume")
    })

    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, alwaysExecuting)
    )
    yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
      Effect.andThen(requestPlannedAttemptExecutorSuspension(plannedAttempt)),
      Effect.andThen(requestPlannedAttemptExecutorSuspension(plannedAttempt)),
      Effect.provideService(PlannedAttemptExecutor, alwaysExecuting)
    )
    const exhausted = yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, alwaysExecuting),
      Effect.flip
    )
    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(exhausted).toMatchObject({ _tag: "PlannedAttemptExecutorSuspensionLimitReached", correlation, limit: 3 })
    expect(yield* Ref.get(calls)).toBe(3)
    expect(
      records.filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
      )
    ).toHaveLength(3)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it("generic executor correlation contains exactly RunId and AttemptId", () => {
  expect(correlation).toEqual({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  expect(Object.keys(correlation).toSorted()).toEqual(["attemptId", "runId"])
})

it("coalesces begin, observation, and suspension ownership by the same exact pair", () => {
  const beginTransition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
  const continuation = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
    acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
    plannedAttempt
  })
  const suspension = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })

  expect(makeSelectedTransitionIdentity(plannedAttempt.runId, beginTransition)).toEqual(
    makeSelectedTransitionIdentity(plannedAttempt.runId, continuation)
  )
  expect(makeSelectedTransitionIdentity(plannedAttempt.runId, suspension)).toEqual(
    makeSelectedTransitionIdentity(plannedAttempt.runId, continuation)
  )
})

it.effect("recovers process death before terminal publication by reprojecting and accepting terminal once", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const firstProcess = makeControlledFakePlannedAttemptExecutorLayer([
      ControlledFakeExecutorStep.cases.Begin.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
    ])
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    const restartReads = yield* Ref.make(0)
    const secondProcess = Layer.succeed(
      PlannedAttemptExecutor,
      PlannedAttemptExecutor.of({
        begin: () => Effect.die("must not begin again"),
        observe: () => Ref.update(restartReads, (count) => count + 1).pipe(Effect.as(exactProjection(terminal))),
        requestSuspension: () => Effect.die("unused suspension"),
        resume: () => Effect.die("unused resume")
      })
    )

    expect(yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provide(firstProcess))).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    )
    expect(yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(Effect.provide(secondProcess))).toEqual(
      terminal
    )
    expect(yield* Ref.get(restartReads)).toBe(1)

    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(records.map(({ event }) => event._tag)).toEqual([
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseObserved",
      "PlannedAttemptExecutorWorkReported",
      "PlannedAttemptExecutorStateObserved",
      "PlannedAttemptExecutorWorkReported"
    ])
    expect(
      records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
          ? [event.plannedAttempt.attemptId]
          : event._tag === "PlannedAttemptExecutorWorkReported"
            ? [event.report.correlation.attemptId]
            : []
      )
    ).toEqual([plannedAttempt.attemptId, plannedAttempt.attemptId, plannedAttempt.attemptId])
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect(
  "accepts a pending terminal observation after process death without rereading or duplicating the report",
  () =>
    Effect.gen(function* () {
      yield* appendTaskWorkSpecification()
      const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation,
        result: { _tag: "Completed" }
      })
      const firstProcess = PlannedAttemptExecutor.of({
        begin: () => Effect.succeed(executing),
        observe: () => Effect.die("first process is lost after recording its observation"),
        requestSuspension: () => Effect.die("unused suspension"),
        resume: () => Effect.die("unused resume")
      })

      yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, firstProcess)
      )
      const stateOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
      yield* (yield* JournalStore).append(
        plannedAttempt.runId,
        plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, stateOrdinal),
        PlannedAttemptExecutorStateObservedEvent.make({
          observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: terminal }),
          occurrenceClassification: "NonActionOccurrence",
          ordinal: stateOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )

      const secondProcessCalls = yield* Ref.make(0)
      const secondProcess = PlannedAttemptExecutor.of({
        begin: () => Ref.update(secondProcessCalls, (count) => count + 1).pipe(Effect.as(executing)),
        observe: () => Ref.update(secondProcessCalls, (count) => count + 1).pipe(Effect.as(exactProjection(terminal))),
        requestSuspension: () => Ref.update(secondProcessCalls, (count) => count + 1).pipe(Effect.as(executing)),
        resume: () => Ref.update(secondProcessCalls, (count) => count + 1).pipe(Effect.as(executing))
      })

      expect(
        yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, secondProcess)
        )
      ).toEqual(terminal)
      expect(yield* Ref.get(secondProcessCalls)).toBe(0)
      const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" ? [[event.ordinal, event.report._tag] as const] : []
        )
      ).toEqual([
        [1, "ExecutorWorkExecuting"],
        [2, "ExecutorWorkTerminal"]
      ])
    }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("keeps terminal reports absorbing and replays the accepted terminal report without another event", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const observeCalls = yield* Ref.make(0)
    const resumeCalls = yield* Ref.make(0)
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    const executor = PlannedAttemptExecutor.of({
      begin: () => Effect.succeed(executing),
      observe: () =>
        Ref.getAndUpdate(observeCalls, (count) => count + 1).pipe(
          Effect.map((count) => exactProjection(count < 2 ? terminal : executing))
        ),
      requestSuspension: () => Effect.die("terminal work must not receive suspension"),
      resume: () => Ref.update(resumeCalls, (count) => count + 1).pipe(Effect.as(executing))
    })

    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provideService(PlannedAttemptExecutor, executor))
    yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor)
    )
    const afterTerminal = yield* (yield* JournalStore).read(plannedAttempt.runId)

    expect(
      yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    ).toEqual(terminal)
    expect(yield* (yield* JournalStore).read(plannedAttempt.runId)).toHaveLength(afterTerminal.length)

    const resumeRejected = yield* resumePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.flip
    )
    expect(resumeRejected).toMatchObject({ _tag: "PlannedAttemptExecutorWorkAlreadyTerminal", correlation })

    const contradiction = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.flip
    )
    expect(contradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorTerminalReportContradiction",
      accepted: terminal,
      observed: executing
    })
    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(yield* Ref.get(resumeCalls)).toBe(0)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(2)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorStateObserved")).toHaveLength(2)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects passive safe-to-executing work as a typed lifecycle-transition contradiction", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const executor = PlannedAttemptExecutor.of({
      begin: () => Effect.succeed(executing),
      observe: () => Effect.succeed(exactProjection(executing)),
      requestSuspension: () => Effect.succeed(safe),
      resume: () => Effect.die("passive observation must not resume work")
    })

    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provideService(PlannedAttemptExecutor, executor))
    yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor)
    )
    const contradiction = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor),
      Effect.flip
    )

    expect(contradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorLifecycleTransitionContradiction",
      accepted: safe,
      observed: executing
    })
    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(2)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(2)
    expect(records.at(-1)?.event).toMatchObject({
      _tag: "PlannedAttemptExecutorStateObserved",
      observation: { _tag: "ExecutorLifecycleTransitionContradiction", accepted: safe, observed: executing }
    })
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("accepts safe-to-executing work only from the exact Resume command", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const executor = PlannedAttemptExecutor.of({
      begin: () => Effect.succeed(executing),
      observe: () => Effect.die("settled commands require no projection"),
      requestSuspension: () => Effect.succeed(safe),
      resume: () => Effect.succeed(executing)
    })

    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provideService(PlannedAttemptExecutor, executor))
    yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, executor)
    )
    expect(
      yield* resumePlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    ).toEqual(executing)

    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(hasValidAcceptedPlannedAttemptExecutorLifecycleHistory(records, plannedAttempt)).toBe(true)
    const forgedResumeKey = records.map((record) =>
      record.event._tag === "PlannedAttemptExecutorCommandIntended" && record.event.command === "Resume"
        ? { ...record, key: JournalRecordKey.make("forged-resume-command-key") }
        : record
    )
    expect(hasValidAcceptedPlannedAttemptExecutorLifecycleHistory(forgedResumeKey, plannedAttempt)).toBe(false)
    const resumedReport = records.find(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.ordinal === 3
    )
    if (resumedReport?.event._tag !== "PlannedAttemptExecutorWorkReported") {
      return yield* Effect.die("Resume lifecycle fixture lacks accepted report ordinal 3")
    }
    const stateOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
    const shifted = records.map((record) =>
      record.position >= resumedReport.position
        ? { ...record, position: JournalPosition.make(Number(record.position) + 1) }
        : record
    )
    const stateObserved: JournalRecord = {
      event: PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: executing }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: stateOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, stateOrdinal),
      position: resumedReport.position,
      runId: plannedAttempt.runId
    }
    const stateSourced = [...shifted, stateObserved].toSorted(
      (left, right) => Number(left.position) - Number(right.position)
    )
    expect(hasValidAcceptedPlannedAttemptExecutorLifecycleHistory(stateSourced, plannedAttempt)).toBe(true)
    const forgedResumeSettlement = stateSourced.map((record) =>
      record.event._tag === "PlannedAttemptExecutorCommandResponseObserved" && record.event.commandOrdinal === 3
        ? { ...record, key: JournalRecordKey.make("forged-resume-settlement-key") }
        : record
    )
    expect(hasValidAcceptedPlannedAttemptExecutorLifecycleHistory(forgedResumeSettlement, plannedAttempt)).toBe(false)
    expect(
      records.flatMap(({ event }) => (event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report._tag] : []))
    ).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended", "ExecutorWorkExecuting"])
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a late settlement for a Resume intent that predates the accepted Safe report", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const resumeOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, resumeOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Resume",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: resumeOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const safeOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, safeOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: safeOrdinal,
        report: safe,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, resumeOrdinal),
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal: resumeOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        report: executing,
        version: workflowJournalEventVersion
      })
    )

    const contradiction = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          begin: () => Effect.die("pending acceptance must not begin"),
          observe: () => Effect.die("pending acceptance must fail before another observation"),
          requestSuspension: () => Effect.die("pending acceptance must not suspend"),
          resume: () => Effect.die("pending acceptance must not resume")
        })
      ),
      Effect.flip
    )

    expect(contradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorLifecycleTransitionContradiction",
      accepted: safe,
      observed: executing
    })
    expect(
      (yield* journal.read(plannedAttempt.runId)).filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported"
      )
    ).toHaveLength(1)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("reports safe suspension for the same planned attempt", () =>
  Effect.gen(function* () {
    yield* appendTaskWorkSpecification()
    expect(yield* beginPlannedAttemptExecutorWork(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    )
    expect(yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    )
    expect(yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    )
  }).pipe(
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.Begin.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        }),
        ControlledFakeExecutorStep.cases.Suspend.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        }),
        ControlledFakeExecutorStep.cases.Suspend.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
        })
      ])
    ),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("frees the exact task-work position after a terminal report", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      plannedAttempt.runId,
      recoveryTarget,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendTaskWorkSpecification()
    yield* appendTaskClaim
    yield* journal.append(
      plannedAttempt.runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make("plan-before-completion"),
          plannedAttempt,
          predecessorOperationIds: [taskClaim.operationId]
        }),
        version: workflowJournalEventVersion
      })
    )
    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.Begin.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
          })
        ])
      )
    )
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          begin: () => Effect.die("must not begin twice"),
          observe: () => Effect.succeed(exactProjection(terminal)),
          requestSuspension: () => Effect.die("unused suspension"),
          resume: () => Effect.die("unused resume")
        })
      )
    )
    const recovery = yield* makeRunRecoveryProjection(plannedAttempt.runId).pipe(
      Effect.provide(makeControlledFakePlannedAttemptExecutorLayer([]))
    )
    expect(recovery.reconstructedPlannedAttemptPositions).toEqual([])
  }).pipe(
    Effect.provide(currentFactsInterpreterLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("releases capacity only after the planned attempt is safely suspended", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      plannedAttempt.runId,
      recoveryTarget,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendTaskWorkSpecification()
    const planOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("plan-before-suspension"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    yield* journal.append(
      plannedAttempt.runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
    )
    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.Begin.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
          })
        ])
      )
    )
    yield* (yield* ControlDirectionApplication).apply({
      direction: "Pause",
      subject: { _tag: "Task", runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
    })
    const suspensionLayer = makeControlledFakePlannedAttemptExecutorLayer([
      ControlledFakeExecutorStep.cases.Suspend.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      }),
      ControlledFakeExecutorStep.cases.Suspend.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
      })
    ])
    const before = yield* makeRunRecoveryProjection(plannedAttempt.runId).pipe(Effect.provide(suspensionLayer))
    expect(before.reconstructedPlannedAttemptPositions).toEqual([
      { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
    ])

    yield* Effect.gen(function* () {
      yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
      yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
    }).pipe(Effect.provide(suspensionLayer))
    const after = yield* makeRunRecoveryProjection(plannedAttempt.runId).pipe(Effect.provide(suspensionLayer))
    expect(after.reconstructedPlannedAttemptPositions).toEqual([])
  }).pipe(
    Effect.provide(controlDirectionApplicationLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
        readTrackerGraph: () => Effect.die("unused"),
        readTaskWorkSpecification: () => Effect.die("unused"),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused"),
        releaseTaskClaim: () => Effect.die("unused")
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("resumes the same planned attempt after unpause", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      plannedAttempt.runId,
      recoveryTarget,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendTaskWorkSpecification()
    yield* appendTaskClaim
    yield* journal.append(
      plannedAttempt.runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make("plan-before-resume"),
          plannedAttempt,
          predecessorOperationIds: [taskClaim.operationId]
        }),
        version: workflowJournalEventVersion
      })
    )
    yield* beginPlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.Begin.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
          })
        ])
      )
    )
    const control = yield* ControlDirectionApplication
    yield* control.apply({
      direction: "Pause",
      subject: { _tag: "Task", runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
    })
    yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.Suspend.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
          })
        ])
      )
    )
    yield* control.apply({
      direction: "Unpause",
      subject: { _tag: "Task", runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
    })
    yield* resumePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.Resume.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
              correlation,
              result: { _tag: "Completed" }
            })
          })
        ])
      )
    )
    const records = yield* journal.read(plannedAttempt.runId)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")).toHaveLength(
      1
    )
    expect(
      records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report.correlation] : []
      )
    ).toEqual([correlation, correlation, correlation])
  }).pipe(
    Effect.provide(controlDirectionApplicationLayer),
    Effect.provide(currentFactsInterpreterLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)

it("reconstructs the same planned attempt after Dalph and the fake executor crash together", () => {
  const reconstruction = reconstructRunState(plannedAttempt.runId, [
    {
      event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(1),
      runId: plannedAttempt.runId
    }
  ])
  expect(reconstruction._tag).toBe("ValidReconstructedRun")
  if (reconstruction._tag !== "ValidReconstructedRun") return
  const responsibility = reconstruction.state.responsibility.entries[0]
  expect(responsibility).toEqual({
    _tag: "PlannedAttemptExecutorWorkResponsibility",
    beganAt: JournalPosition.make(1),
    plannedAttempt
  })
  if (responsibility?._tag !== "PlannedAttemptExecutorWorkResponsibility") return
  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: reconstruction.state.responsibility,
      responsibilityFacts: [
        {
          _tag: "PlannedAttemptExecutorFreshFacts",
          disposition: {
            _tag: "Ready",
            acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: responsibility.beganAt }
          },
          responsibility
        }
      ]
    }).transitions
  ).toEqual([RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })])
})

it.effect("one recovered transition continues reconstructed work through the controlled fake", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      plannedAttempt.runId,
      recoveryTarget,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendTaskWorkSpecification()
    yield* appendTaskClaim
    const planOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("plan-attempt-A-3"),
      plannedAttempt,
      predecessorOperationIds: [taskClaim.operationId]
    })
    yield* journal.append(
      plannedAttempt.runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )

    yield* beginPlannedAttemptExecutorWork(plannedAttempt)

    expect((yield* journal.read(plannedAttempt.runId)).at(-1)?.event).toMatchObject({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", correlation }
    })
  }).pipe(
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.Begin.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        })
      ])
    ),
    Effect.provide(currentFactsInterpreterLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(memoryJournalTestLayer)
  )
)
