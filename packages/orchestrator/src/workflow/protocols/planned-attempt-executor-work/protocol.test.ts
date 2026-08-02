// @effect-diagnostics multipleEffectProvide:off
import { it } from "@effect/vitest"
import {
  PlannedAttemptExecutor,
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
import { Effect, Layer, Option, Schema } from "effect"
import { expect } from "vitest"
import {
  ControlDirectionApplication,
  controlDirectionApplicationLayer
} from "../control-direction-application/protocol.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent
} from "../../registry/event.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { makeRunRecoveryProjection } from "../../../coordination/run/recovery-activation.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "./events.js"
import { continuePlannedAttemptExecutorWork, requestPlannedAttemptExecutorSuspension } from "./protocol.js"
import { reconstructRunState } from "../../../coordination/reconstruction/reduce.js"
import {
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  RunnableFrontierTransition
} from "../../../coordination/frontier/frontier.js"
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
      Option.some(PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } }))
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
    expect(yield* emptyExecutor.project(correlation)).toEqual(Option.none())
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
    expect(yield* executor.project(correlation)).toEqual(Option.none())
    const suspended = yield* executor.requestSuspension(plannedAttempt)
    expect(suspended).toEqual(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
    expect(yield* executor.project(correlation)).toEqual(Option.some(suspended))
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

it.effect("rejects an executor report correlated to another attempt", () =>
  Effect.gen(function* () {
    const mismatch = yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.succeed(Option.none()),
          requestSuspension: () => Effect.die("unused"),
          startOrContinue: () =>
            Effect.succeed(
              PlannedAttemptExecutorReport.cases.Running.make({
                correlation: { attemptId: AttemptId.make("wrong-attempt"), runId: plannedAttempt.runId }
              })
            )
        })
      ),
      Effect.flip
    )
    expect(mismatch._tag).toBe("PlannedAttemptExecutorCorrelationMismatch")
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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

it("generic executor correlation contains exactly RunId and AttemptId", () => {
  expect(correlation).toEqual({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  expect(Object.keys(correlation).toSorted()).toEqual(["attemptId", "runId"])
})

it("coalesces start, continuation, and suspension ownership by the same pair", () => {
  const start = RunnableFrontierTransition.StartPlannedAttemptExecutorWork({ plannedAttempt })
  const continuation = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt })
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
      "PlannedAttemptExecutorWorkReported",
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
        { _tag: "PlannedAttemptExecutorFreshFacts", disposition: ResponsibilityDisposition.Ready(), responsibility }
      ]
    }).transitions
  ).toEqual([RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt })])
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
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)
