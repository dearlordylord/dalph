// @effect-diagnostics multipleEffectProvide:off
import { it } from "@effect/vitest"
import {
  PlannedAttemptExecutor,
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
  WorktreeLocator
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
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import { type JournalRecord, JournalStore } from "../../../workflow-journal/store.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent
} from "../../registry/event.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { plannedAttemptProtocolControllerLayer } from "./protocol-controller.js"
import { makeRunRecoveryProjection } from "../../../coordination/run/recovery-activation.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorCommandResponseContradictedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "./events.js"
import {
  continuePlannedAttemptExecutorWork,
  observePlannedAttemptExecutorState,
  requestPlannedAttemptExecutorSuspension
} from "./guarded-protocol.js"
import { plannedAttemptExecutorContinuationDisposition } from "./protocol.js"
import { reconstructRunState } from "../../../coordination/reconstruction/reduce.js"
import { deriveRunnableFrontier, RunnableFrontierTransition } from "../../../coordination/frontier/frontier.js"
import { makeSelectedTransitionIdentity } from "../../../coordination/activation/selected-transition.js"
import { makeTaskAttemptPlanOperation, makeTaskClaimAcquisitionOperation } from "../../registry/operation.js"
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
import { makeTaskWorkSpecification } from "../../../authorities/task-tracker/task-work-specification.js"
import { projectTrackerSnapshot } from "../../../authorities/task-tracker/graph.js"
import { journaledWorkflowInterpreterLayer } from "../../../workflow-journal/journaled-interpreter.js"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"

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

it.effect("drives one planned attempt through the generic executor boundary", () =>
  Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor

    expect(yield* executor.startOrContinue(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    )
    expect(yield* executor.startOrContinue(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
    )
    expect(yield* executor.project(correlation)).toEqual(
      exactProjection(PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } }))
    )
    expect(yield* executor.project({ runId: correlation.runId, attemptId: correlation.attemptId })).toEqual(
      yield* executor.project(correlation)
    )
  }).pipe(
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.StartOrContinue.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
        }),
        ControlledFakeExecutorStep.cases.StartOrContinue.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
        })
      ])
    )
  )
)

it.effect("rejects exhausted, wrong-kind, and wrong-correlation fake requests", () =>
  Effect.gen(function* () {
    const emptyExecutor = yield* PlannedAttemptExecutor
    expect(yield* emptyExecutor.project(correlation)).toEqual(noReport())
    const exhausted = yield* emptyExecutor.startOrContinue(plannedAttempt).pipe(Effect.flip)
    expect(exhausted.detail).toContain("has no cassette entry")

    const suspendStep = ControlledFakeExecutorStep.cases.Suspend.make({
      correlation,
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
    })
    const wrongKind = yield* PlannedAttemptExecutor.pipe(
      Effect.flatMap((executor) => executor.startOrContinue(plannedAttempt)),
      Effect.provide(makeControlledFakePlannedAttemptExecutorLayer([suspendStep])),
      Effect.flip
    )
    expect(wrongKind.detail).toContain("expected Suspend")

    const otherAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, attemptId: AttemptId.make("other-attempt") })
    const wrongCorrelation = yield* PlannedAttemptExecutor.pipe(
      Effect.flatMap((executor) => executor.startOrContinue(otherAttempt)),
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
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
    expect(yield* executor.project(correlation)).toEqual(noReport())
    const suspended = yield* executor.requestSuspension(plannedAttempt)
    expect(suspended).toEqual(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
    expect(yield* executor.project(correlation)).toEqual(exactProjection(suspended))
    expect(yield* executor.startOrContinue(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    )
  }).pipe(Effect.provide(controlledFakePlannedAttemptExecutorLayer))
)

it.effect("rejects a cassette response for a different planned attempt", () =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(ControlledFakeExecutorStep)(
      ControlledFakeExecutorStep.cases.StartOrContinue.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
      })
    )
    const decoded = yield* Schema.decodeUnknownEffect(ControlledFakeExecutorStep)({
      _tag: "StartOrContinue",
      correlation,
      report: { _tag: "Running", correlation: { attemptId: AttemptId.make("different"), runId: correlation.runId } }
    }).pipe(Effect.flip)
    expect(String(decoded)).toContain("controlled fake request and report must name the same planned attempt")
  })
)

it.effect("journals a contradictory executor response and reconciles its exact command before retry", () =>
  Effect.gen(function* () {
    const wrongReport = PlannedAttemptExecutorReport.cases.Running.make({
      correlation: { attemptId: AttemptId.make("wrong-attempt"), runId: plannedAttempt.runId }
    })
    const mismatch = yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused"),
          startOrContinue: () => Effect.succeed(wrongReport)
        })
      ),
      Effect.flip
    )
    expect(mismatch._tag).toBe("PlannedAttemptExecutorCorrelationMismatch")
    const journal = yield* JournalStore
    const afterContradiction = yield* journal.read(plannedAttempt.runId)
    expect(afterContradiction.map(({ event }) => event._tag)).toEqual([
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

    const projectedReport = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    expect(
      yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            project: () => Effect.succeed(exactProjection(projectedReport)),
            requestSuspension: () => Effect.die("unused"),
            startOrContinue: () => Effect.die("must reconcile before another command")
          })
        )
      )
    ).toEqual(projectedReport)
    expect((yield* journal.read(plannedAttempt.runId)).map(({ event }) => event._tag)).toEqual([
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseContradicted",
      "PlannedAttemptExecutorCommandProjectionObserved"
    ])
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("continues an exact planned attempt through the executor protocol", () =>
  Effect.gen(function* () {
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
    expect(yield* continuePlannedAttemptExecutorWork(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    )
  }).pipe(
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(legacyMemoryJournalStoreLayer),
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.StartOrContinue.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
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

it.effect("projects one unmatched command without duplicating it and sends the next command on a later call", () =>
  Effect.gen(function* () {
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
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: firstCommandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const projected = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    const nextResponse = PlannedAttemptExecutorReport.cases.Terminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    const executor = PlannedAttemptExecutor.of({
      project: () => Effect.succeed(exactProjection(projected)),
      requestSuspension: () => Effect.die("unused suspension"),
      startOrContinue: () => Ref.update(commandCalls, (count) => count + 1).pipe(Effect.as(nextResponse))
    })

    expect(
      yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
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
      yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    ).toEqual(nextResponse)
    expect(yield* Ref.get(commandCalls)).toBe(1)
    expect(
      (yield* journal.read(plannedAttempt.runId)).filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended"
      )
    ).toHaveLength(2)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("does not manufacture executor-work responsibility from a read-only observation", () =>
  Effect.gen(function* () {
    const projectionCalls = yield* Ref.make(0)
    const missing = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Ref.update(projectionCalls, (count) => count + 1).pipe(Effect.as(noReport())),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      ),
      Effect.flip
    )
    expect(missing._tag).toBe("PlannedAttemptExecutorResponsibilityMissing")
    expect(yield* Ref.get(projectionCalls)).toBe(0)
    expect(yield* (yield* JournalStore).read(plannedAttempt.runId)).toEqual([])
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
        command: "StartOrContinue",
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
          project: () => Ref.update(projectionCalls, (count) => count + 1).pipe(Effect.as(noReport())),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
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
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    const unavailable = yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("reconciliation must not start work")
        })
      ),
      Effect.flip
    )
    expect(unavailable).toMatchObject({ _tag: "PlannedAttemptExecutorProjectionNoCurrentReport", commandOrdinal })

    const foreignCorrelation = { attemptId: AttemptId.make("foreign-projection"), runId: plannedAttempt.runId }
    const contradiction = yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () =>
            Effect.succeed(
              contradictoryProjection(
                PlannedAttemptExecutorReport.cases.Running.make({ correlation: foreignCorrelation })
              )
            ),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("reconciliation must not start work")
        })
      ),
      Effect.flip
    )
    expect(contradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorCorrelationMismatch",
      expected: correlation,
      observed: foreignCorrelation
    })
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
          project: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
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
          project: () =>
            Effect.succeed(
              contradictoryProjection(
                PlannedAttemptExecutorReport.cases.Running.make({ correlation: foreignCorrelation })
              )
            ),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      ),
      Effect.flip
    )
    expect(contradiction).toMatchObject({
      _tag: "PlannedAttemptExecutorCorrelationMismatch",
      expected: correlation,
      observed: foreignCorrelation
    })

    const divergent = PlannedTaskAttempt.make({ ...plannedAttempt, baseSha: GitCommitSha.make("3".repeat(40)) })
    const divergentResponsibility = yield* observePlannedAttemptExecutorState(divergent).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("contradictory responsibility must fail before projection"),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      ),
      Effect.flip
    )
    expect(divergentResponsibility).toMatchObject({ _tag: "PlannedAttemptExecutorResponsibilityContradiction" })
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

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
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    const projection = (outcome: PlannedAttemptExecutorProjection) =>
      PlannedAttemptExecutor.of({
        project: () => Effect.succeed(outcome),
        requestSuspension: () => Effect.die("unused suspension"),
        startOrContinue: () => Effect.die("temporary or unreadable projection must not start work")
      })
    const temporary = yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
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

    const unreadable = yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
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
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
        project: () => Effect.succeed(outcome),
        requestSuspension: () => Effect.die("unused suspension"),
        startOrContinue: () => Effect.die("unused continuation")
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
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it("rejects malformed executor command and projection chronology through the public history reducer", () => {
  const responsibility = PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
    plannedAttempt,
    version: workflowJournalEventVersion
  })
  const command = (ordinal: number) =>
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(ordinal),
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  const running = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
  const foreignRunning = PlannedAttemptExecutorReport.cases.Running.make({
    correlation: { attemptId: AttemptId.make("history-foreign-executor"), runId: plannedAttempt.runId }
  })
  const report = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
    report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } }),
    version: workflowJournalEventVersion
  })
  const projection = (projectionOrdinal = 1, projectedReport: PlannedAttemptExecutorReport = running) =>
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
        observed: running
      }),
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
      version: workflowJournalEventVersion
    })
  const state = (ordinal = 1, projectedReport: PlannedAttemptExecutorReport = running) =>
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: projectedReport }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(ordinal),
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  const expectedCorrelationContradictionState = () =>
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({ observed: running }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  const responseContradiction = (commandOrdinal = 1, observed: PlannedAttemptExecutorReport = foreignRunning) =>
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
      events: [responsibility, command(1), projection(1, foreignRunning)]
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
      events: [responsibility, command(1), responseContradiction(1, running)]
    },
    { detail: "has no prior matching executor-work responsibility", events: [state()] },
    { detail: "expected ordinal 1, found 2", events: [responsibility, state(2)] },
    { detail: "returned a contradictory correlation", events: [responsibility, state(1, foreignRunning)] },
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

it.effect("rejects a divergent immutable plan before recording another executor command", () =>
  Effect.gen(function* () {
    const firstReport = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.succeed(noReport()),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.succeed(firstReport)
        })
      )
    )
    const divergent = PlannedTaskAttempt.make({ ...plannedAttempt, baseSha: GitCommitSha.make("2".repeat(40)) })
    const contradiction = yield* continuePlannedAttemptExecutorWork(divergent).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("must reject before projection"),
          requestSuspension: () => Effect.die("must reject before suspension"),
          startOrContinue: () => Effect.die("must reject before continuation")
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
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("stops an always-Running executor at the durable continuation limit", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const alwaysRunning = PlannedAttemptExecutor.of({
      project: () => Effect.succeed(noReport()),
      requestSuspension: () => Effect.die("unused suspension"),
      startOrContinue: () =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.as(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
        )
    })

    yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.andThen(continuePlannedAttemptExecutorWork(plannedAttempt)),
      Effect.andThen(continuePlannedAttemptExecutorWork(plannedAttempt)),
      Effect.provideService(PlannedAttemptExecutor, alwaysRunning)
    )
    const exhausted = yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, alwaysRunning),
      Effect.flip
    )
    const retryAfterRestart = yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, alwaysRunning),
      Effect.flip
    )

    expect(exhausted).toMatchObject({ _tag: "PlannedAttemptExecutorContinuationLimitReached", correlation, limit: 3 })
    expect(retryAfterRestart).toEqual(exhausted)
    expect(yield* Ref.get(calls)).toBe(3)
    expect(
      (yield* (yield* JournalStore).read(plannedAttempt.runId)).filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported"
      )
    ).toHaveLength(3)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("counts lost start responses reconciled as Running against the durable continuation limit", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const lostResponseExecutor = PlannedAttemptExecutor.of({
      project: () => Effect.succeed(exactProjection(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))),
      requestSuspension: () => Effect.die("unused suspension"),
      startOrContinue: () => Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(Effect.die("response lost")))
    })

    for (let command = 0; command < 3; command += 1) {
      yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, lostResponseExecutor),
        Effect.exit
      )
      expect(
        yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, lostResponseExecutor)
        )
      ).toEqual(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
    }

    const exhausted = yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, lostResponseExecutor),
      Effect.flip
    )
    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(exhausted).toMatchObject({ _tag: "PlannedAttemptExecutorContinuationLimitReached", correlation, limit: 3 })
    expect(yield* Ref.get(calls)).toBe(3)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(3)
    expect(
      records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
    ).toHaveLength(3)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(0)
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("never issues a fourth durable suspension command without quiescence", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const alwaysRunning = PlannedAttemptExecutor.of({
      project: () => Effect.die("no unmatched command"),
      requestSuspension: () =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.as(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
        ),
      startOrContinue: () => Effect.die("unused continuation")
    })

    yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
      Effect.andThen(requestPlannedAttemptExecutorSuspension(plannedAttempt)),
      Effect.andThen(requestPlannedAttemptExecutorSuspension(plannedAttempt)),
      Effect.provideService(PlannedAttemptExecutor, alwaysRunning)
    )
    const exhausted = yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
      Effect.provideService(PlannedAttemptExecutor, alwaysRunning),
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
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it("generic executor correlation contains exactly RunId and AttemptId", () => {
  expect(correlation).toEqual({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  expect(Object.keys(correlation).toSorted()).toEqual(["attemptId", "runId"])
})

it("derives the continuation budget from exact reports when no durable command count is supplied", () => {
  const running = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
  const suspended = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })

  expect(plannedAttemptExecutorContinuationDisposition(correlation, [running, running, running])).toMatchObject({
    _tag: "ExecutorContinuationLimitReached"
  })
  expect(plannedAttemptExecutorContinuationDisposition(correlation, [running, suspended, running])).toMatchObject({
    _tag: "ExecutorContinuationAvailable"
  })
})

it("coalesces start, continuation, and suspension ownership by the same pair", () => {
  const start = RunnableFrontierTransition.StartPlannedAttemptExecutorWork({ plannedAttempt })
  const continuation = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
    acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
    plannedAttempt
  })
  const suspension = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })

  expect(makeSelectedTransitionIdentity(plannedAttempt.runId, start)).toEqual(
    makeSelectedTransitionIdentity(plannedAttempt.runId, continuation)
  )
  expect(makeSelectedTransitionIdentity(plannedAttempt.runId, suspension)).toEqual(
    makeSelectedTransitionIdentity(plannedAttempt.runId, continuation)
  )
})

it.effect("recreates the fake executor and continues the same attempt after shared process death", () =>
  Effect.gen(function* () {
    const firstProcess = makeControlledFakePlannedAttemptExecutorLayer([
      ControlledFakeExecutorStep.cases.StartOrContinue.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
      })
    ])
    const secondProcess = makeControlledFakePlannedAttemptExecutorLayer([
      ControlledFakeExecutorStep.cases.StartOrContinue.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
      })
    ])

    expect(yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provide(firstProcess))).toEqual(
      PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    )
    expect(yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(Effect.provide(secondProcess))).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
    )

    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(records.map(({ event }) => event._tag)).toEqual([
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorWorkReported",
      "PlannedAttemptExecutorCommandIntended",
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
  }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("reports safe suspension for the same planned attempt", () =>
  Effect.gen(function* () {
    expect(yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    )
    expect(yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
    )
  }).pipe(
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.Suspend.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
        }),
        ControlledFakeExecutorStep.cases.Suspend.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
        })
      ])
    ),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
          })
        ])
      )
    )
    yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
          })
        ])
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
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
        report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
      }),
      ControlledFakeExecutorStep.cases.Suspend.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
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
    Effect.provide(legacyMemoryJournalStoreLayer)
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
    yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
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
            report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
          })
        ])
      )
    )
    yield* control.apply({
      direction: "Unpause",
      subject: { _tag: "Task", runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
    })
    yield* Effect.gen(function* () {
      yield* continuePlannedAttemptExecutorWork(plannedAttempt)
      yield* continuePlannedAttemptExecutorWork(plannedAttempt)
    }).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
          }),
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
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
    ).toEqual([correlation, correlation, correlation, correlation])
  }).pipe(
    Effect.provide(controlDirectionApplicationLayer),
    Effect.provide(currentFactsInterpreterLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(legacyMemoryJournalStoreLayer)
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
  ).toEqual([
    RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
      acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: responsibility.beganAt },
      plannedAttempt
    })
  ])
})

it.effect("one recovered transition continues reconstructed work through the controlled fake", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      plannedAttempt.runId,
      recoveryTarget,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
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

    yield* continuePlannedAttemptExecutorWork(plannedAttempt)

    expect((yield* journal.read(plannedAttempt.runId)).at(-1)?.event).toMatchObject({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", correlation }
    })
  }).pipe(
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.StartOrContinue.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
        })
      ])
    ),
    Effect.provide(currentFactsInterpreterLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provide(plannedAttemptProtocolControllerLayer),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)
