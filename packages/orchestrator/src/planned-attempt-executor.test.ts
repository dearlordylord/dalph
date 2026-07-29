import { it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { expect } from "vitest"
import { ControlService, controlServiceLayer } from "./control-service.js"
import {
  AttemptId,
  AuthenticatedOperatorIdentity,
  ControlCommandId,
  GitCommitSha,
  JournalPosition,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkCapacity,
  WorktreeLocator
} from "./domain.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { plannedAttemptExecutorWorkStartedRecordKey } from "./journal-record-key.js"
import {
  attemptPlanRecordKey,
  JournalStore,
  memoryJournalStoreLayer,
  TaskAttemptPlannedEvent
} from "./journal-store.js"
import { activateRecoveredResponsibilities, makeManagedRecoveryActivation } from "./managed-activation.js"
import { PlannedAttemptExecutorWorkStartedEvent } from "./planned-attempt-executor-journal.js"
import {
  continuePlannedAttemptExecutorWork,
  requestPlannedAttemptExecutorSuspension
} from "./planned-attempt-executor-workflow.js"
import {
  ControlledFakeExecutorStep,
  controlledFakePlannedAttemptExecutorLayer,
  makeControlledFakePlannedAttemptExecutorLayer,
  PlannedAttemptExecutor,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport
} from "./planned-attempt-executor.js"
import { trustedPlannedAttemptRecoveryAuthorityLayer } from "./planned-attempt-recovery-authority.js"
import { reconstructManagedRunState } from "./reconstructed-managed-run.js"
import { deriveRunnableFrontier, ResponsibilityDisposition, RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeSelectedTransitionIdentity } from "./selected-transition.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { makeTaskAttemptPlanOperation } from "./workflow-operation.js"
import { WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-A-3"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-A-3"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId: RunId.make("R"),
  taskId: TaskId.make("A"),
  taskRevision: TaskRevision.make("task-A-revision"),
  worktree: WorktreeLocator.make("/worktrees/attempt-A-3")
})

const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)

it.effect("drives one planned attempt through the generic executor boundary", () =>
  Effect.gen(function*() {
    const executor = yield* PlannedAttemptExecutor

    expect(yield* executor.startOrContinue(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    )
    expect(yield* executor.startOrContinue(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({
        correlation,
        result: { _tag: "Completed" }
      })
    )
    expect(yield* executor.project(correlation)).toEqual(
      Option.some(
        PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation,
          result: { _tag: "Completed" }
        })
      )
    )
    expect(
      yield* executor.project({
        runId: correlation.runId,
        attemptId: correlation.attemptId
      })
    ).toEqual(yield* executor.project(correlation))
  }).pipe(
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.StartOrContinue.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Running.make({
            correlation
          })
        }),
        ControlledFakeExecutorStep.cases.StartOrContinue.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Terminal.make({
            correlation,
            result: { _tag: "Completed" }
          })
        })
      ])
    )
  ))

it.effect("rejects exhausted, wrong-kind, and wrong-correlation fake requests", () =>
  Effect.gen(function*() {
    const emptyExecutor = yield* PlannedAttemptExecutor
    expect(yield* emptyExecutor.project(correlation)).toEqual(Option.none())
    const exhausted = yield* emptyExecutor.startOrContinue(
      plannedAttempt
    ).pipe(Effect.flip)
    expect(exhausted.detail).toContain("has no cassette entry")

    const suspendStep = ControlledFakeExecutorStep.cases.Suspend.make({
      correlation,
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation
      })
    })
    const wrongKind = yield* PlannedAttemptExecutor.pipe(
      Effect.flatMap((executor) => executor.startOrContinue(plannedAttempt)),
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([suspendStep])
      ),
      Effect.flip
    )
    expect(wrongKind.detail).toContain("expected Suspend")

    const otherAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("other-attempt")
    })
    const wrongCorrelation = yield* PlannedAttemptExecutor.pipe(
      Effect.flatMap((executor) => executor.startOrContinue(otherAttempt)),
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Running.make({
              correlation
            })
          })
        ])
      ),
      Effect.flip
    )
    expect(wrongCorrelation.detail).toContain("other-attempt")
  }).pipe(
    Effect.provide(makeControlledFakePlannedAttemptExecutorLayer([]))
  ))

it.effect("projects default fake reports and safely suspends without a survivor lookup", () =>
  Effect.gen(function*() {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.project(correlation)).toEqual(Option.none())
    const suspended = yield* executor.requestSuspension(plannedAttempt)
    expect(suspended).toEqual(
      PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation
      })
    )
    expect(yield* executor.project(correlation)).toEqual(
      Option.some(suspended)
    )
    expect(yield* executor.startOrContinue(plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    )
  }).pipe(Effect.provide(controlledFakePlannedAttemptExecutorLayer)))

it.effect("rejects a cassette response for a different planned attempt", () =>
  Effect.gen(function*() {
    yield* Schema.decodeUnknownEffect(ControlledFakeExecutorStep)(
      ControlledFakeExecutorStep.cases.StartOrContinue.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation
        })
      })
    )
    const decoded = yield* Schema.decodeUnknownEffect(
      ControlledFakeExecutorStep
    )({
      _tag: "StartOrContinue",
      correlation,
      report: {
        _tag: "Running",
        correlation: {
          attemptId: AttemptId.make("different"),
          runId: correlation.runId
        }
      }
    }).pipe(Effect.flip)
    expect(String(decoded)).toContain(
      "controlled fake request and report must name the same planned attempt"
    )
  }))

it.effect("rejects an executor report correlated to another attempt", () =>
  Effect.gen(function*() {
    const mismatch = yield* continuePlannedAttemptExecutorWork(
      plannedAttempt
    ).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.succeed(Option.none()),
          requestSuspension: () => Effect.die("unused"),
          startOrContinue: () =>
            Effect.succeed(
              PlannedAttemptExecutorReport.cases.Running.make({
                correlation: {
                  attemptId: AttemptId.make("wrong-attempt"),
                  runId: plannedAttempt.runId
                }
              })
            )
        })
      ),
      Effect.flip
    )
    expect(mismatch._tag).toBe(
      "PlannedAttemptExecutorCorrelationMismatch"
    )
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("continues an exact planned attempt through the recovered source capability", () =>
  Effect.gen(function*() {
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
    const recovery = yield* makeManagedRecoveryActivation(
      plannedAttempt.runId
    )
    expect(
      yield* recovery.continuePlannedAttemptExecutorWork(plannedAttempt)
    ).toEqual(
      PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    )
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.StartOrContinue.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Running.make({
            correlation
          })
        })
      ])
    ),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTrackerGraph: () => Effect.die("unused"),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused")
      })
    ),
    Effect.provideService(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    )
  ))

it("generic executor correlation contains exactly RunId and AttemptId", () => {
  expect(correlation).toEqual({
    attemptId: plannedAttempt.attemptId,
    runId: plannedAttempt.runId
  })
  expect(Object.keys(correlation).toSorted()).toEqual([
    "attemptId",
    "runId"
  ])
})

it("coalesces start, continuation, and suspension ownership by the same pair", () => {
  const start = RunnableFrontierTransition.StartPlannedAttemptExecutorWork({
    plannedAttempt
  })
  const continuation = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
    plannedAttempt
  })
  const suspension = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({
    plannedAttempt
  })

  expect(
    makeSelectedTransitionIdentity(plannedAttempt.runId, start)
  ).toEqual(
    makeSelectedTransitionIdentity(
      plannedAttempt.runId,
      continuation
    )
  )
  expect(
    makeSelectedTransitionIdentity(plannedAttempt.runId, suspension)
  ).toEqual(
    makeSelectedTransitionIdentity(
      plannedAttempt.runId,
      continuation
    )
  )
})

it.effect("recreates the fake executor and continues the same attempt after shared process death", () =>
  Effect.gen(function*() {
    const firstProcess = makeControlledFakePlannedAttemptExecutorLayer([
      ControlledFakeExecutorStep.cases.StartOrContinue.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation
        })
      })
    ])
    const secondProcess = makeControlledFakePlannedAttemptExecutorLayer([
      ControlledFakeExecutorStep.cases.StartOrContinue.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation,
          result: { _tag: "Completed" }
        })
      })
    ])

    expect(
      yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provide(firstProcess)
      )
    ).toEqual(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
    expect(
      yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provide(secondProcess)
      )
    ).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({
        correlation,
        result: { _tag: "Completed" }
      })
    )

    const records = yield* (yield* JournalStore).read(plannedAttempt.runId)
    expect(records.map(({ event }) => event._tag)).toEqual([
      "PlannedAttemptExecutorWorkStarted",
      "PlannedAttemptExecutorWorkReported",
      "PlannedAttemptExecutorWorkReported"
    ])
    expect(
      records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkStarted"
          ? [event.plannedAttempt.attemptId]
          : event._tag === "PlannedAttemptExecutorWorkReported"
          ? [event.report.correlation.attemptId]
          : []
      )
    ).toEqual([
      plannedAttempt.attemptId,
      plannedAttempt.attemptId,
      plannedAttempt.attemptId
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("reports safe suspension for the same planned attempt", () =>
  Effect.gen(function*() {
    expect(
      yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
    ).toEqual(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
    expect(
      yield* requestPlannedAttemptExecutorSuspension(plannedAttempt)
    ).toEqual(
      PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
    )
  }).pipe(
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.Suspend.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Running.make({
            correlation
          })
        }),
        ControlledFakeExecutorStep.cases.Suspend.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
            correlation
          })
        })
      ])
    ),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("frees the exact task-work position after a terminal report", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* journal.append(
      plannedAttempt.runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make("plan-before-completion"),
          plannedAttempt,
          predecessorOperationIds: []
        }),
        version: workflowJournalEventVersion
      })
    )
    yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Running.make({
              correlation
            })
          })
        ])
      )
    )
    yield* activateRecoveredResponsibilities(
      plannedAttempt.runId,
      TaskWorkCapacity.make(1)
    ).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Terminal.make({
              correlation,
              result: { _tag: "Completed" }
            })
          })
        ])
      )
    )
    const recovery = yield* makeManagedRecoveryActivation(
      plannedAttempt.runId
    ).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([])
      )
    )
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      reconstructedPlannedAttemptPositions: recovery.reconstructedPlannedAttemptPositions
    })
    const otherTask = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: TaskId.make("B"),
      taskRevision: TaskRevision.make("task-B-revision")
    })
    expect(
      (yield* controller.admit({
        explanations: [],
        transitions: [otherTask]
      }, plannedAttempt.runId)).transition
    ).toEqual(Option.some(otherTask))
  }).pipe(
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTrackerGraph: () => Effect.die("unused"),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused")
      })
    ),
    Effect.provideService(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    ),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("releases capacity only after the planned attempt is safely suspended", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const planOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("plan-before-suspension"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    yield* journal.append(
      plannedAttempt.runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: planOperation,
        version: workflowJournalEventVersion
      })
    )
    yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Running.make({
              correlation
            })
          })
        ])
      )
    )
    yield* (yield* ControlService).record(
      AuthenticatedOperatorIdentity.make("alice"),
      {
        _tag: "RequestTaskPause",
        commandId: ControlCommandId.make("pause-A"),
        runId: plannedAttempt.runId,
        taskId: plannedAttempt.taskId
      }
    )
    const suspensionLayer = makeControlledFakePlannedAttemptExecutorLayer([
      ControlledFakeExecutorStep.cases.Suspend.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation
        })
      }),
      ControlledFakeExecutorStep.cases.Suspend.make({
        correlation,
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
          correlation
        })
      })
    ])
    const before = yield* makeManagedRecoveryActivation(
      plannedAttempt.runId
    ).pipe(Effect.provide(suspensionLayer))
    expect(before.reconstructedPlannedAttemptPositions).toEqual([{
      attemptId: plannedAttempt.attemptId,
      runId: plannedAttempt.runId,
      taskId: plannedAttempt.taskId
    }])

    const beforeController = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      reconstructedPlannedAttemptPositions: before.reconstructedPlannedAttemptPositions
    })
    const otherTask = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: TaskId.make("B"),
      taskRevision: TaskRevision.make("task-B-revision")
    })
    expect(Option.isNone(
      (yield* beforeController.admit({
        explanations: [],
        transitions: [otherTask]
      }, plannedAttempt.runId)).transition
    )).toBe(true)

    yield* activateRecoveredResponsibilities(
      plannedAttempt.runId,
      TaskWorkCapacity.make(1)
    ).pipe(Effect.provide(suspensionLayer))
    const after = yield* makeManagedRecoveryActivation(
      plannedAttempt.runId
    ).pipe(Effect.provide(suspensionLayer))
    expect(after.reconstructedPlannedAttemptPositions).toEqual([])
    const afterController = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      reconstructedPlannedAttemptPositions: after.reconstructedPlannedAttemptPositions
    })
    expect(
      (yield* afterController.admit({
        explanations: [],
        transitions: [otherTask]
      }, plannedAttempt.runId)).transition
    ).toEqual(Option.some(otherTask))
  }).pipe(
    Effect.provide(controlServiceLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTrackerGraph: () => Effect.die("unused"),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused")
      })
    ),
    Effect.provideService(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    ),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("resumes the same planned attempt after unpause", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* journal.append(
      plannedAttempt.runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make("plan-before-resume"),
          plannedAttempt,
          predecessorOperationIds: []
        }),
        version: workflowJournalEventVersion
      })
    )
    yield* continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Running.make({
              correlation
            })
          })
        ])
      )
    )
    const control = yield* ControlService
    yield* control.record(
      AuthenticatedOperatorIdentity.make("alice"),
      {
        _tag: "RequestTaskPause",
        commandId: ControlCommandId.make("pause-before-resume"),
        runId: plannedAttempt.runId,
        taskId: plannedAttempt.taskId
      }
    )
    yield* requestPlannedAttemptExecutorSuspension(
      plannedAttempt
    ).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.Suspend.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
              correlation
            })
          })
        ])
      )
    )
    yield* control.record(
      AuthenticatedOperatorIdentity.make("alice"),
      {
        _tag: "RequestTaskUnpause",
        commandId: ControlCommandId.make("unpause-A"),
        runId: plannedAttempt.runId,
        taskId: plannedAttempt.taskId
      }
    )
    yield* activateRecoveredResponsibilities(
      plannedAttempt.runId,
      TaskWorkCapacity.make(1)
    ).pipe(
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Running.make({
              correlation
            })
          }),
          ControlledFakeExecutorStep.cases.StartOrContinue.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.Terminal.make({
              correlation,
              result: { _tag: "Completed" }
            })
          })
        ])
      )
    )
    const records = yield* journal.read(plannedAttempt.runId)
    expect(
      records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkStarted")
    ).toHaveLength(1)
    expect(
      records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported"
          ? [event.report.correlation]
          : []
      )
    ).toEqual([correlation, correlation, correlation, correlation])
  }).pipe(
    Effect.provide(controlServiceLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTrackerGraph: () => Effect.die("unused"),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused")
      })
    ),
    Effect.provideService(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    ),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it("reconstructs the same planned attempt after Dalph and the fake executor crash together", () => {
  const reconstruction = reconstructManagedRunState(
    plannedAttempt.runId,
    [{
      event: PlannedAttemptExecutorWorkStartedEvent.make({
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkStartedRecordKey(
        plannedAttempt.attemptId
      ),
      position: JournalPosition.make(1),
      runId: plannedAttempt.runId
    }]
  )
  expect(reconstruction._tag).toBe("ValidReconstructedManagedRun")
  if (reconstruction._tag !== "ValidReconstructedManagedRun") return
  const responsibility = reconstruction.state.responsibility.entries[0]
  expect(responsibility).toEqual({
    _tag: "PlannedAttemptExecutorWorkResponsibility",
    beganAt: JournalPosition.make(1),
    plannedAttempt
  })
  if (
    responsibility?._tag
      !== "PlannedAttemptExecutorWorkResponsibility"
  ) return
  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: reconstruction.state.responsibility,
      responsibilityFacts: [{
        _tag: "PlannedAttemptExecutorFreshFacts",
        disposition: ResponsibilityDisposition.Ready(),
        responsibility
      }]
    }).transitions
  ).toEqual([
    RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
      plannedAttempt
    })
  ])
})

it.effect("generic activation continues reconstructed work through the controlled fake", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const planOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("plan-attempt-A-3"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    yield* journal.append(
      plannedAttempt.runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: planOperation,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkStartedRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkStartedEvent.make({
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    yield* activateRecoveredResponsibilities(
      plannedAttempt.runId,
      TaskWorkCapacity.make(1)
    )

    expect(
      (yield* journal.read(plannedAttempt.runId)).map(({ event }) => event._tag)
    ).toEqual([
      "TaskAttemptPlanned",
      "PlannedAttemptExecutorWorkStarted",
      "PlannedAttemptExecutorWorkReported"
    ])
  }).pipe(
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.StartOrContinue.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Terminal.make({
            correlation,
            result: { _tag: "Completed" }
          })
        })
      ])
    ),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTrackerGraph: () => Effect.die("unused"),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused")
      })
    ),
    Effect.provideService(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    ),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))
