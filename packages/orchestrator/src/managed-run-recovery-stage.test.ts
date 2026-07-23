import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  GitCommitSha,
  JournalPosition,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorkerProcessId,
  WorktreeLocator
} from "./domain.js"
import { PlannedWorktreeReady } from "./git-worktree.js"
import {
  taskExecutionReportedRecordKey,
  taskWorkSessionReportedRecordKey,
  taskWorkSessionResultRecordKey
} from "./journal-record-key.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  type JournalRecord,
  JournalStore,
  memoryJournalStoreLayer,
  outcomeRecordKey,
  providerObservationRequestRecordKey,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskExecutionIntentRecorded,
  TaskExecutionOutcomeObservedEvent,
  TaskExecutionReported,
  TaskWorkSessionEstablishedEvent,
  TaskWorkSessionEstablishmentIntentRecorded,
  TaskWorkSessionLookupRequested,
  TaskWorkSessionReported,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "./journal-store.js"
import { reduceManagedHistory } from "./managed-history.js"
import { deriveManagedRunRecoveryStage } from "./managed-run-recovery-stage.js"
import { taskRevisionFor } from "./task-dag.js"
import {
  SuccessfulTaskExecutionReported,
  TaskExecutionOutcome,
  TaskExecutionRequest,
  TaskExecutionSessionBinding
} from "./task-execution.js"
import {
  MatchingTaskWorkSessionReported,
  TaskWorkSessionResult,
  TaskWorkSessionResultReported,
  TaskWorkStartRequest
} from "./task-work-start.js"
import { ActiveTaskClaim, type TaskClaimObservation, TrackerMutation, UnclaimedTask } from "./tracker-mutation.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskExecutionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "./workflow-operation.js"
import { recoverExactRunAfterCoordinatorDeath } from "./workflow-recovery.js"
import { continuePlannedTaskAttemptStage, RecoveryTaskEligibilityIssue } from "./workflow-stage-recovery.js"
import {
  AuthoritativeTaskWorktreeReady,
  TaskWorktreeReconciliationSimulated,
  WorkflowInterpreter,
  WorkflowOutcome,
  WorkflowTrace
} from "./workflow.js"

const runId = RunId.make("recovery-stage-run")
const task = {
  id: TaskId.make("recovery-stage-task"),
  lifecycle: { _tag: "Open" as const },
  parentTaskId: null,
  prerequisiteIds: []
}
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("recovery-stage-attempt"),
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  branch: TaskBranchRef.make("refs/heads/recovery-stage"),
  executor: TaskExecutorLocator.make("executor:recovery-stage"),
  runId,
  session: TaskWorkSessionLocator.make("session:recovery-stage"),
  taskId: task.id,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/recovery-stage")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("recovery-stage-plan"),
  plannedAttempt,
  predecessorOperationIds: []
})
const worktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("recovery-stage-worktree"),
  plannedAttempt,
  predecessorOperationIds: [planOperation.operationId]
})
const sessionOperation = makeTaskWorkSessionEstablishmentOperation({
  predecessorOperationIds: [planOperation.operationId, worktreeOperation.operationId],
  request: TaskWorkStartRequest.make({
    operationId: OperationId.make("recovery-stage-session"),
    plannedAttempt,
    task
  })
})
const sessionId = TaskWorkSessionId.make("recovery-stage-provider-session")

const records = (
  ...events: ReadonlyArray<{
    readonly event: JournalRecord["event"]
    readonly key: JournalRecord["key"]
  }>
): ReadonlyArray<JournalRecord> =>
  events.map((event, index) => ({
    ...event,
    position: JournalPosition.make(index + 1),
    runId
  }))

const plan = {
  event: TaskAttemptPlannedEvent.make({ operation: planOperation, version: 4 }),
  key: attemptPlanRecordKey(plannedAttempt.attemptId)
} as const
const worktreeIntent = {
  event: TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: 4 }),
  key: intentRecordKey(worktreeOperation.operationId)
} as const
const worktreeReady = {
  event: TaskWorktreeReadyEvent.make({
    operationId: worktreeOperation.operationId,
    proof: PlannedWorktreeReady.make({
      baseSha: plannedAttempt.baseSha,
      branch: plannedAttempt.branch,
      headSha: plannedAttempt.baseSha,
      worktree: plannedAttempt.worktree
    }),
    version: 4
  }),
  key: outcomeRecordKey(worktreeOperation.operationId)
} as const
const sessionIntent = {
  event: TaskWorkSessionEstablishmentIntentRecorded.make({ operation: sessionOperation, version: 4 }),
  key: intentRecordKey(sessionOperation.request.operationId)
} as const
const sessionEstablished = {
  event: TaskWorkSessionEstablishedEvent.make({
    outcome: {
      _tag: "TaskWorkSessionEstablished",
      operationId: sessionOperation.request.operationId,
      sessionId
    },
    version: 4
  }),
  key: outcomeRecordKey(sessionOperation.request.operationId)
} as const

it("derives a distinct recovery stage for every early legal crash gap", () => {
  const executionOperation = makeTaskExecutionOperation({
    predecessorOperationIds: [sessionOperation.request.operationId],
    request: TaskExecutionRequest.make({
      operationId: OperationId.make("recovery-stage-execution"),
      plannedAttempt,
      session: TaskExecutionSessionBinding.cases.EstablishedSession.make({ sessionId }),
      task
    })
  })
  const executionIntent = {
    event: TaskExecutionIntentRecorded.make({ operation: executionOperation, version: 4 }),
    key: intentRecordKey(executionOperation.request.operationId)
  } as const
  const executionOutcome = {
    event: TaskExecutionOutcomeObservedEvent.make({
      outcome: WorkflowOutcome.cases.TaskExecutionObserved.make({
        outcome: TaskExecutionOutcome.cases.Succeeded.make({
          observationId: ProviderObservationId.make("recovery-stage-execution-observation"),
          operationId: executionOperation.request.operationId,
          output: "recovered",
          processId: WorkerProcessId.make(90),
          sessionId
        })
      }),
      version: 4
    }),
    key: outcomeRecordKey(executionOperation.request.operationId)
  } as const
  const prefixes = [
    [records(plan), "TaskWorktreeReconciliationNeeded"],
    [records(plan, worktreeIntent), "TaskWorktreeReconciliationUnresolved"],
    [records(plan, worktreeIntent, worktreeReady), "TaskWorkSessionEstablishmentNeeded"],
    [
      records(plan, worktreeIntent, worktreeReady, sessionIntent),
      "TaskWorkSessionEstablishmentUnresolved"
    ],
    [
      records(plan, worktreeIntent, worktreeReady, sessionIntent, sessionEstablished),
      "TaskExecutionNeeded"
    ],
    [
      records(plan, worktreeIntent, worktreeReady, sessionIntent, sessionEstablished, executionIntent),
      "TaskExecutionUnresolved"
    ],
    [
      records(
        plan,
        worktreeIntent,
        worktreeReady,
        sessionIntent,
        sessionEstablished,
        executionIntent,
        executionOutcome
      ),
      "ImplementationConvergencePending"
    ]
  ] as const
  for (const [prefix, expectedStage] of prefixes) {
    expect(deriveManagedRunRecoveryStage(prefix).entries).toHaveLength(1)
    expect(deriveManagedRunRecoveryStage(prefix).entries[0]?._tag).toBe(expectedStage)
  }
  const planned = records(plan)
  const reduced = reduceManagedHistory(runId, planned)
  expect(reduced._tag === "ValidManagedHistory" ? reduced.recoveryStage.entries[0]?._tag : reduced._tag)
    .toBe("TaskWorktreeReconciliationNeeded")

  const duplicateWorktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("recovery-stage-duplicate-worktree"),
    plannedAttempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  const duplicate = reduceManagedHistory(
    runId,
    records(plan, worktreeIntent, {
      event: TaskWorktreeReconciliationIntendedEvent.make({
        operation: duplicateWorktreeOperation,
        version: 4
      }),
      key: intentRecordKey(duplicateWorktreeOperation.operationId)
    })
  )
  expect(duplicate._tag).toBe("InvalidManagedHistory")
  expect(
    duplicate._tag === "InvalidManagedHistory"
      ? duplicate.issues.some(({ detail }) => detail.includes("multiple TaskWorktreeReconciliationIntended"))
      : false
  ).toBe(true)
  const duplicateSessionOperation = makeTaskWorkSessionEstablishmentOperation({
    predecessorOperationIds: [planOperation.operationId, worktreeOperation.operationId],
    request: TaskWorkStartRequest.make({
      operationId: OperationId.make("recovery-stage-duplicate-session"),
      plannedAttempt,
      task
    })
  })
  const duplicateSession = reduceManagedHistory(
    runId,
    records(plan, worktreeIntent, worktreeReady, sessionIntent, {
      event: TaskWorkSessionEstablishmentIntentRecorded.make({
        operation: duplicateSessionOperation,
        version: 4
      }),
      key: intentRecordKey(duplicateSessionOperation.request.operationId)
    })
  )
  expect(
    duplicateSession._tag === "InvalidManagedHistory"
      ? duplicateSession.issues.some(({ detail }) =>
        detail.includes("multiple TaskWorkSessionEstablishmentIntentRecorded")
      )
      : false
  ).toBe(true)

  const boundaryClaimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("recovery-stage-boundary-claim"),
      owner: ClaimOwner.make("recovery-stage-boundary-owner"),
      taskId: task.id,
      token: ClaimToken.make("recovery-stage-boundary-token")
    },
    predecessorOperationIds: []
  })
  const boundaryClaim = {
    event: TaskClaimAcquiredEvent.make({
      claim: ActiveTaskClaim.make(boundaryClaimOperation.acquisition),
      version: 4
    }),
    key: outcomeRecordKey(boundaryClaimOperation.acquisition.operationId)
  } as const
  expect(deriveManagedRunRecoveryStage(records(boundaryClaim)).entries).toEqual([])
  expect(
    deriveManagedRunRecoveryStage(records({
      event: TaskClaimAcquisitionIntendedEvent.make({ operation: boundaryClaimOperation, version: 4 }),
      key: intentRecordKey(boundaryClaimOperation.acquisition.operationId)
    }, boundaryClaim)).entries
  ).toEqual([])

  const orphanObservationId = OperationId.make("recovery-stage-orphan-observation")
  const orphanObservation = {
    event: trackerGraphOutcomeObserved(orphanObservationId, {
      _tag: "TrackerGraphObserved" as const,
      revision: validSnapshot({ revision: "orphan-stage", tasks: [task] }).revision,
      taskIds: [task.id]
    }),
    key: outcomeRecordKey(orphanObservationId)
  } as const
  expect(deriveManagedRunRecoveryStage(records(orphanObservation)).entries).toEqual([])
  const observed = {
    event: trackerGraphObservationIntent(
      makeTrackerGraphObservationOperation(orphanObservationId, FixtureTarget.make("orphan-stage"))
    ),
    key: intentRecordKey(orphanObservationId)
  } as const
  expect(
    deriveManagedRunRecoveryStage(records(observed, orphanObservation, orphanObservation))
      .entries
  ).toHaveLength(1)
  expect(
    deriveManagedRunRecoveryStage(records(plan, observed, orphanObservation)).entries
  ).toHaveLength(1)
})

it.effect("does not treat an observed eligible task without a claim intent as terminal", () => {
  const preplanRunId = RunId.make("preplan-recovery-stage-run")
  const observation = makeTrackerGraphObservationOperation(
    OperationId.make("preplan-recovery-observation"),
    FixtureTarget.make("preplan-recovery-target")
  )
  return Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* journal.append(
      preplanRunId,
      intentRecordKey(observation.operationId),
      trackerGraphObservationIntent(observation)
    )
    yield* journal.append(
      preplanRunId,
      outcomeRecordKey(observation.operationId),
      trackerGraphOutcomeObserved(observation.operationId, {
        _tag: "TrackerGraphObserved",
        revision: validSnapshot({ revision: "preplan-recovery", tasks: [task] }).revision,
        taskIds: [task.id]
      })
    )
    const unused = () => Effect.die("pre-plan gap must fail closed before selecting an operation")
    const issues = yield* recoverExactRunAfterCoordinatorDeath(preplanRunId).pipe(
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          acquireTaskClaim: unused,
          establishTaskWorkSession: unused,
          executeTaskWork: unused,
          handBackReviewFindings: unused,
          readTrackerGraph: unused,
          reconcileTaskWorktree: unused,
          recordImplementationDisposition: unused,
          recordTaskAttemptPlan: unused,
          reviewImplementation: unused,
          sealImplementationEvidence: unused,
          simulateTaskExecution: unused,
          simulateTaskWorkSession: unused
        })
      ),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: unused,
          readTaskClaim: unused,
          releaseTaskClaim: unused
        })
      )
    )
    expect(issues).toMatchObject([{
      _tag: "RecoveryProgressIssue",
      stage: "TaskClaimAcquisitionNeeded"
    }])

    const claimOperation = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("preplan-recovery-claim"),
        owner: ClaimOwner.make("preplan-recovery-owner"),
        taskId: task.id,
        token: ClaimToken.make("preplan-recovery-token")
      },
      predecessorOperationIds: [observation.operationId]
    })
    const admission = makeTrackerGraphObservationOperation(
      OperationId.make("preplan-recovery-admission"),
      observation.target,
      [claimOperation.acquisition.operationId]
    )
    yield* journal.append(
      preplanRunId,
      intentRecordKey(claimOperation.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: 4 })
    )
    expect(
      deriveManagedRunRecoveryStage(yield* journal.read(preplanRunId)).entries[0]?._tag
    ).toBe("TaskClaimAcquisitionUnresolved")
    yield* journal.append(
      preplanRunId,
      outcomeRecordKey(claimOperation.acquisition.operationId),
      TaskClaimAcquiredEvent.make({
        claim: ActiveTaskClaim.make(claimOperation.acquisition),
        version: 4
      })
    )
    expect(
      deriveManagedRunRecoveryStage(yield* journal.read(preplanRunId)).entries[0]?._tag
    ).toBe("TaskEligibilityRefreshNeeded")
    yield* journal.append(
      preplanRunId,
      intentRecordKey(admission.operationId),
      trackerGraphObservationIntent(admission)
    )
    expect(
      deriveManagedRunRecoveryStage(yield* journal.read(preplanRunId)).entries[0]?._tag
    ).toBe("TaskEligibilityRefreshUnresolved")
    yield* journal.append(
      preplanRunId,
      outcomeRecordKey(admission.operationId),
      trackerGraphOutcomeObserved(admission.operationId, {
        _tag: "TrackerGraphObserved",
        revision: validSnapshot({ revision: "preplan-admission", tasks: [task] }).revision,
        taskIds: [task.id]
      })
    )
    const stage = deriveManagedRunRecoveryStage(yield* journal.read(preplanRunId))
    expect(stage.entries).toHaveLength(1)
    expect(stage.entries[0]?._tag).toBe("TaskAttemptPlanNeeded")
  }).pipe(Effect.provide(memoryJournalStoreLayer))
})

it.effect("reports a typed issue when a later durable stage cannot advance", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const executionOperation = makeTaskExecutionOperation({
      predecessorOperationIds: [sessionOperation.request.operationId],
      request: TaskExecutionRequest.make({
        operationId: OperationId.make("inert-convergence-execution"),
        plannedAttempt,
        session: TaskExecutionSessionBinding.cases.EstablishedSession.make({ sessionId }),
        task
      })
    })
    const executionOutcome = WorkflowOutcome.cases.TaskExecutionObserved.make({
      outcome: TaskExecutionOutcome.cases.Succeeded.make({
        observationId: ProviderObservationId.make("inert-convergence-observation"),
        operationId: executionOperation.request.operationId,
        output: "completed without legacy claim lineage",
        processId: WorkerProcessId.make(91),
        sessionId
      })
    })
    const sessionObservationId = ProviderObservationId.make("inert-convergence-session-observation")
    const executionReport = SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("inert-convergence-execution-observation"),
      operationId: executionOperation.request.operationId,
      output: "completed without legacy claim lineage",
      processId: WorkerProcessId.make(91),
      sessionId
    })
    const durableEvents = [
      plan,
      worktreeIntent,
      worktreeReady,
      sessionIntent,
      {
        event: TaskWorkSessionLookupRequested.make({
          lookup: {
            operationId: sessionOperation.request.operationId,
            plannedAttempt
          },
          observationId: sessionObservationId,
          version: 4
        }),
        key: providerObservationRequestRecordKey(sessionObservationId)
      },
      {
        event: TaskWorkSessionReported.make({
          operationId: sessionOperation.request.operationId,
          report: MatchingTaskWorkSessionReported.make({
            observationId: sessionObservationId,
            sessionId,
            work: { _tag: "NoProviderWorkReported" }
          }),
          version: 4
        }),
        key: taskWorkSessionReportedRecordKey(
          sessionOperation.request.operationId,
          sessionObservationId
        )
      },
      sessionEstablished,
      {
        event: TaskExecutionIntentRecorded.make({ operation: executionOperation, version: 4 }),
        key: intentRecordKey(executionOperation.request.operationId)
      },
      {
        event: TaskExecutionReported.make({
          operationId: executionOperation.request.operationId,
          report: executionReport,
          version: 4
        }),
        key: taskExecutionReportedRecordKey(
          executionOperation.request.operationId,
          executionReport.observationId
        )
      },
      {
        event: TaskExecutionOutcomeObservedEvent.make({ outcome: executionOutcome, version: 4 }),
        key: outcomeRecordKey(executionOperation.request.operationId)
      }
    ] as const
    for (const { event, key } of durableEvents) {
      yield* journal.append(runId, key, event)
    }
    const unused = () => Effect.die("inert convergence must not call an authority")
    const issues = yield* recoverExactRunAfterCoordinatorDeath(runId).pipe(
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          acquireTaskClaim: unused,
          establishTaskWorkSession: unused,
          executeTaskWork: unused,
          handBackReviewFindings: unused,
          readTrackerGraph: unused,
          reconcileTaskWorktree: unused,
          recordImplementationDisposition: unused,
          recordTaskAttemptPlan: unused,
          reviewImplementation: unused,
          sealImplementationEvidence: unused,
          simulateTaskExecution: unused,
          simulateTaskWorkSession: unused
        })
      ),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: unused,
          readTaskClaim: unused,
          releaseTaskClaim: unused
        })
      )
    )
    expect(issues).toMatchObject([{
      _tag: "RecoveryTaskEligibilityIssue",
      reason: "MissingEligibilityObservation"
    }])
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("checks the exact claim and current task revision before selecting missing worktree intent", () =>
  Effect.gen(function*() {
    const initialObservation = makeTrackerGraphObservationOperation(
      OperationId.make("recovery-stage-initial-observation"),
      FixtureTarget.make("recovery-stage-target")
    )
    const claimOperation = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("recovery-stage-claim"),
        owner: ClaimOwner.make("recovery-stage-owner"),
        taskId: task.id,
        token: ClaimToken.make("recovery-stage-token")
      },
      predecessorOperationIds: [initialObservation.operationId]
    })
    const admissionObservation = makeTrackerGraphObservationOperation(
      OperationId.make("recovery-stage-admission"),
      initialObservation.target,
      [claimOperation.acquisition.operationId]
    )
    const acknowledgedPlan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("recovery-stage-acknowledged-plan"),
      plannedAttempt,
      predecessorOperationIds: [admissionObservation.operationId]
    })
    const claim = ActiveTaskClaim.make(claimOperation.acquisition)
    const history = records(
      {
        event: {
          _tag: "TrackerGraphObservationIntentRecorded",
          operation: initialObservation,
          version: 4
        },
        key: intentRecordKey(initialObservation.operationId)
      },
      {
        event: TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: 4 }),
        key: intentRecordKey(claimOperation.acquisition.operationId)
      },
      {
        event: TaskClaimAcquiredEvent.make({ claim, version: 4 }),
        key: outcomeRecordKey(claimOperation.acquisition.operationId)
      },
      {
        event: {
          _tag: "TrackerGraphObservationIntentRecorded",
          operation: admissionObservation,
          version: 4
        },
        key: intentRecordKey(admissionObservation.operationId)
      },
      {
        event: TaskAttemptPlannedEvent.make({ operation: acknowledgedPlan, version: 4 }),
        key: attemptPlanRecordKey(plannedAttempt.attemptId)
      }
    )
    const stage = deriveManagedRunRecoveryStage(history).entries[0]
    if (stage?._tag !== "TaskWorktreeReconciliationNeeded") {
      return yield* Effect.die("expected missing worktree operation")
    }
    const selected = yield* Ref.make<Array<unknown>>([])
    const unused = () => Effect.die("unused recovery operation")
    const interpreter = WorkflowInterpreter.of({
      acquireTaskClaim: unused,
      establishTaskWorkSession: unused,
      executeTaskWork: unused,
      handBackReviewFindings: unused,
      readTrackerGraph: () =>
        Effect.succeed(validSnapshot({
          revision: "recovery-stage-current",
          tasks: [task]
        })),
      reconcileTaskWorktree: (operation) =>
        Effect.succeed(AuthoritativeTaskWorktreeReady.make({
          proof: PlannedWorktreeReady.make({
            baseSha: operation.plannedAttempt.baseSha,
            branch: operation.plannedAttempt.branch,
            headSha: operation.plannedAttempt.baseSha,
            worktree: operation.plannedAttempt.worktree
          })
        })),
      recordImplementationDisposition: unused,
      recordTaskAttemptPlan: unused,
      reviewImplementation: unused,
      sealImplementationEvidence: unused,
      simulateTaskExecution: unused,
      simulateTaskWorkSession: unused
    })
    const collisionOperationId = OperationId.make(
      `recovery:${runId}:${plannedAttempt.attemptId}:${history.length + 1}:tracker:0`
    )
    const collisionHistory = records(
      ...history.map(({ event, key }) => ({ event, key })),
      {
        event: {
          _tag: "TrackerGraphObservationIntentRecorded",
          operation: makeTrackerGraphObservationOperation(
            collisionOperationId,
            initialObservation.target
          ),
          version: 4
        },
        key: intentRecordKey(collisionOperationId)
      }
    )
    const advanced = yield* continuePlannedTaskAttemptStage(runId, collisionHistory, stage).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter),
      Effect.provideService(
        WorkflowTrace,
        WorkflowTrace.of({ emit: (item) => Ref.update(selected, (items) => [...items, item]) })
      ),
      Effect.provideService(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: unused,
          readTaskClaim: () => Effect.succeed(claim),
          releaseTaskClaim: unused
        })
      )
    )
    expect(advanced).toBe(true)
    expect((yield* Ref.get(selected)).map((item) => (item as { _tag: string })._tag))
      .toEqual([
        "OperationSelected",
        "TrackerGraphOutcomeObserved",
        "OperationSelected",
        "TaskWorktreeReady"
      ])

    const changed = { ...task, parentTaskId: TaskId.make("changed-parent") }
    const failure = yield* Effect.flip(
      continuePlannedTaskAttemptStage(runId, history, stage).pipe(
        Effect.provideService(
          WorkflowInterpreter,
          WorkflowInterpreter.of({
            ...interpreter,
            readTrackerGraph: () =>
              Effect.succeed(validSnapshot({
                revision: "recovery-stage-changed",
                tasks: [changed, {
                  id: changed.parentTaskId,
                  lifecycle: { _tag: "Open" },
                  parentTaskId: null,
                  prerequisiteIds: []
                }]
              }))
          })
        ),
        Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        Effect.provideService(
          TrackerMutation,
          TrackerMutation.of({
            acquireTaskClaim: unused,
            readTaskClaim: () => Effect.succeed(claim),
            releaseTaskClaim: unused
          })
        )
      )
    )
    expect(failure).toBeInstanceOf(RecoveryTaskEligibilityIssue)
    expect(failure).toMatchObject({ reason: "TaskRevisionChanged" })

    const unavailable = (
      tasks: ReadonlyArray<typeof task>,
      observedClaim: TaskClaimObservation = claim
    ) =>
      Effect.flip(
        continuePlannedTaskAttemptStage(runId, history, stage).pipe(
          Effect.provideService(
            WorkflowInterpreter,
            WorkflowInterpreter.of({
              ...interpreter,
              readTrackerGraph: () =>
                Effect.succeed(validSnapshot({
                  revision: "recovery-stage-unavailable",
                  tasks
                }))
            })
          ),
          Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
          Effect.provideService(
            TrackerMutation,
            TrackerMutation.of({
              acquireTaskClaim: unused,
              readTaskClaim: () => Effect.succeed(observedClaim),
              releaseTaskClaim: unused
            })
          )
        )
      )
    expect(yield* unavailable([])).toMatchObject({ reason: "TaskNotEligible" })
    expect(
      yield* unavailable(
        [task],
        ActiveTaskClaim.make({
          ...claim,
          token: ClaimToken.make("replacement-token")
        })
      )
    ).toMatchObject({ reason: "ClaimChanged" })
    expect(
      yield* unavailable(
        [task],
        UnclaimedTask.make({ taskId: task.id })
      )
    ).toMatchObject({ reason: "ClaimChanged" })

    const withoutClaim = history.filter(({ event }) => event._tag !== "TaskClaimAcquired")
    expect(
      yield* Effect.flip(
        continuePlannedTaskAttemptStage(runId, withoutClaim, stage).pipe(
          Effect.provideService(WorkflowInterpreter, interpreter),
          Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
          Effect.provideService(
            TrackerMutation,
            TrackerMutation.of({
              acquireTaskClaim: unused,
              readTaskClaim: () => Effect.succeed(claim),
              releaseTaskClaim: unused
            })
          )
        )
      )
    ).toMatchObject({ reason: "MissingClaim" })

    const simulated = WorkflowInterpreter.of({
      ...interpreter,
      reconcileTaskWorktree: (operation) => Effect.succeed(TaskWorktreeReconciliationSimulated.make({ operation }))
    })
    expect(
      yield* Effect.flip(
        continuePlannedTaskAttemptStage(runId, history, stage).pipe(
          Effect.provideService(WorkflowInterpreter, simulated),
          Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
          Effect.provideService(
            TrackerMutation,
            TrackerMutation.of({
              acquireTaskClaim: unused,
              readTaskClaim: () => Effect.succeed(claim),
              releaseTaskClaim: unused
            })
          )
        )
      )
    ).toMatchObject({ _tag: "TaskWorktreeExecutionModeContradiction" })

    const recoveredWorktreeOperation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("recovery-stage-ready-worktree"),
      plannedAttempt,
      predecessorOperationIds: [acknowledgedPlan.operationId]
    })
    const worktreeHistory = records(
      ...history.map(({ event, key }) => ({ event, key })),
      {
        event: TaskWorktreeReconciliationIntendedEvent.make({
          operation: recoveredWorktreeOperation,
          version: 4
        }),
        key: intentRecordKey(recoveredWorktreeOperation.operationId)
      },
      {
        event: TaskWorktreeReadyEvent.make({
          operationId: recoveredWorktreeOperation.operationId,
          proof: PlannedWorktreeReady.make({
            baseSha: plannedAttempt.baseSha,
            branch: plannedAttempt.branch,
            headSha: plannedAttempt.baseSha,
            worktree: plannedAttempt.worktree
          }),
          version: 4
        }),
        key: outcomeRecordKey(recoveredWorktreeOperation.operationId)
      }
    )
    const sessionStage = deriveManagedRunRecoveryStage(worktreeHistory).entries[0]
    if (sessionStage?._tag !== "TaskWorkSessionEstablishmentNeeded") {
      return yield* Effect.die("expected missing session operation")
    }
    const establishedSessionId = TaskWorkSessionId.make("recovered-stage-session")
    const sessionInterpreter = WorkflowInterpreter.of({
      ...interpreter,
      establishTaskWorkSession: (operation) =>
        Effect.succeed(WorkflowOutcome.cases.TaskWorkSessionEstablished.make({
          operationId: operation.request.operationId,
          sessionId: establishedSessionId
        }))
    })
    expect(
      yield* continuePlannedTaskAttemptStage(runId, worktreeHistory, sessionStage).pipe(
        Effect.provideService(WorkflowInterpreter, sessionInterpreter),
        Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        Effect.provideService(
          TrackerMutation,
          TrackerMutation.of({
            acquireTaskClaim: unused,
            readTaskClaim: () => Effect.succeed(claim),
            releaseTaskClaim: unused
          })
        )
      )
    ).toBe(true)

    const recoveredSessionOperation = makeTaskWorkSessionEstablishmentOperation({
      predecessorOperationIds: [
        acknowledgedPlan.operationId,
        recoveredWorktreeOperation.operationId
      ],
      request: TaskWorkStartRequest.make({
        operationId: OperationId.make("recovery-stage-established-session"),
        plannedAttempt,
        task
      })
    })
    const executionHistory = records(
      ...worktreeHistory.map(({ event, key }) => ({ event, key })),
      {
        event: TaskWorkSessionEstablishmentIntentRecorded.make({
          operation: recoveredSessionOperation,
          version: 4
        }),
        key: intentRecordKey(recoveredSessionOperation.request.operationId)
      },
      {
        event: TaskWorkSessionEstablishedEvent.make({
          outcome: WorkflowOutcome.cases.TaskWorkSessionEstablished.make({
            operationId: recoveredSessionOperation.request.operationId,
            sessionId: establishedSessionId
          }),
          version: 4
        }),
        key: outcomeRecordKey(recoveredSessionOperation.request.operationId)
      },
      {
        event: {
          _tag: "TaskWorkSessionResultReported",
          report: TaskWorkSessionResultReported.make({
            observationId: ProviderObservationId.make("recovered-session-result"),
            result: TaskWorkSessionResult.cases.Completed.make({ evidence: "provider completed" }),
            sessionId: establishedSessionId
          }),
          version: 4
        },
        key: taskWorkSessionResultRecordKey(
          ProviderObservationId.make("recovered-session-result")
        )
      }
    )
    const executionStage = deriveManagedRunRecoveryStage(executionHistory).entries[0]
    if (executionStage?._tag !== "TaskExecutionNeeded") {
      return yield* Effect.die("expected missing execution operation")
    }
    const executionInterpreter = WorkflowInterpreter.of({
      ...interpreter,
      executeTaskWork: (operation) =>
        Effect.succeed(WorkflowOutcome.cases.TaskExecutionObserved.make({
          outcome: TaskExecutionOutcome.cases.Succeeded.make({
            observationId: ProviderObservationId.make("recovered-execution-observation"),
            operationId: operation.request.operationId,
            output: "recovered",
            processId: WorkerProcessId.make(77),
            sessionId: establishedSessionId
          })
        }))
    })
    expect(
      yield* continuePlannedTaskAttemptStage(runId, executionHistory, executionStage).pipe(
        Effect.provideService(WorkflowInterpreter, executionInterpreter),
        Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        Effect.provideService(
          TrackerMutation,
          TrackerMutation.of({
            acquireTaskClaim: unused,
            readTaskClaim: () => Effect.succeed(claim),
            releaseTaskClaim: unused
          })
        )
      )
    ).toBe(true)
  }))

it.effect("advances an exact planned attempt once and rejects a silent continuation", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const initialObservation = makeTrackerGraphObservationOperation(
      OperationId.make("exact-recovery-initial-observation"),
      FixtureTarget.make("exact-recovery-target")
    )
    const claimOperation = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("exact-recovery-claim"),
        owner: ClaimOwner.make("exact-recovery-owner"),
        taskId: task.id,
        token: ClaimToken.make("exact-recovery-token")
      },
      predecessorOperationIds: [initialObservation.operationId]
    })
    const admissionObservation = makeTrackerGraphObservationOperation(
      OperationId.make("exact-recovery-admission"),
      initialObservation.target,
      [claimOperation.acquisition.operationId]
    )
    const acknowledgedPlan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("exact-recovery-plan"),
      plannedAttempt,
      predecessorOperationIds: [admissionObservation.operationId]
    })
    const claim = ActiveTaskClaim.make(claimOperation.acquisition)
    const snapshot = validSnapshot({
      revision: "exact-recovery-current",
      tasks: [task]
    })
    const durableEvents = [
      {
        event: trackerGraphObservationIntent(initialObservation),
        key: intentRecordKey(initialObservation.operationId)
      },
      {
        event: trackerGraphOutcomeObserved(initialObservation.operationId, {
          _tag: "TrackerGraphObserved" as const,
          revision: snapshot.revision,
          taskIds: [task.id]
        }),
        key: outcomeRecordKey(initialObservation.operationId)
      },
      {
        event: TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: 4 }),
        key: intentRecordKey(claimOperation.acquisition.operationId)
      },
      {
        event: TaskClaimAcquiredEvent.make({ claim, version: 4 }),
        key: outcomeRecordKey(claimOperation.acquisition.operationId)
      },
      {
        event: trackerGraphObservationIntent(admissionObservation),
        key: intentRecordKey(admissionObservation.operationId)
      },
      {
        event: trackerGraphOutcomeObserved(admissionObservation.operationId, {
          _tag: "TrackerGraphObserved" as const,
          revision: snapshot.revision,
          taskIds: [task.id]
        }),
        key: outcomeRecordKey(admissionObservation.operationId)
      },
      {
        event: TaskAttemptPlannedEvent.make({ operation: acknowledgedPlan, version: 4 }),
        key: attemptPlanRecordKey(plannedAttempt.attemptId)
      }
    ] as const
    for (const { event, key } of durableEvents) {
      yield* journal.append(runId, key, event)
    }

    const unused = () => Effect.die("unused exact recovery operation")
    const interpreter = WorkflowInterpreter.of({
      acquireTaskClaim: unused,
      establishTaskWorkSession: unused,
      executeTaskWork: unused,
      handBackReviewFindings: unused,
      readTrackerGraph: () => Effect.succeed(snapshot),
      reconcileTaskWorktree: (operation) =>
        Effect.succeed(AuthoritativeTaskWorktreeReady.make({
          proof: PlannedWorktreeReady.make({
            baseSha: operation.plannedAttempt.baseSha,
            branch: operation.plannedAttempt.branch,
            headSha: operation.plannedAttempt.baseSha,
            worktree: operation.plannedAttempt.worktree
          })
        })),
      recordImplementationDisposition: unused,
      recordTaskAttemptPlan: unused,
      reviewImplementation: unused,
      sealImplementationEvidence: unused,
      simulateTaskExecution: unused,
      simulateTaskWorkSession: unused
    })
    const tracker = TrackerMutation.of({
      acquireTaskClaim: unused,
      readTaskClaim: () => Effect.succeed(claim),
      releaseTaskClaim: unused
    })
    const contradictionIssues = yield* recoverExactRunAfterCoordinatorDeath(runId).pipe(
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          ...interpreter,
          reconcileTaskWorktree: (operation) => Effect.succeed(TaskWorktreeReconciliationSimulated.make({ operation }))
        })
      ),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(TrackerMutation, tracker)
    )
    expect(contradictionIssues).toMatchObject([{
      _tag: "RecoveryReconciliationIssue",
      authority: "Git"
    }])

    const silentIssues = yield* recoverExactRunAfterCoordinatorDeath(runId).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(TrackerMutation, tracker)
    )
    expect(silentIssues).toMatchObject([{ _tag: "RecoveryProgressIssue" }])

    const journalTrace = WorkflowTrace.of({
      emit: (item) =>
        Effect.gen(function*() {
          if (item._tag === "OperationSelected") {
            if (item.operation._tag === "ReadTrackerGraph") {
              yield* journal.append(
                runId,
                intentRecordKey(item.operation.operationId),
                trackerGraphObservationIntent(item.operation)
              )
            }
            if (item.operation._tag === "ReconcileTaskWorktree") {
              yield* journal.append(
                runId,
                intentRecordKey(item.operation.operationId),
                TaskWorktreeReconciliationIntendedEvent.make({
                  operation: item.operation,
                  version: 4
                })
              )
            }
          }
          if (item._tag === "TrackerGraphOutcomeObserved") {
            yield* journal.append(
              runId,
              outcomeRecordKey(item.operation.operationId),
              trackerGraphOutcomeObserved(item.operation.operationId, item.outcome)
            )
          }
          if (item._tag === "TaskWorktreeReady") {
            yield* journal.append(
              runId,
              outcomeRecordKey(item.operation.operationId),
              TaskWorktreeReadyEvent.make({
                operationId: item.operation.operationId,
                proof: item.proof,
                version: 4
              })
            )
          }
        }).pipe(Effect.orDie)
    })
    const issues = yield* recoverExactRunAfterCoordinatorDeath(runId).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter),
      Effect.provideService(WorkflowTrace, journalTrace),
      Effect.provideService(TrackerMutation, tracker)
    )
    expect(issues).toEqual([])
    expect(deriveManagedRunRecoveryStage(yield* journal.read(runId)).entries[0]?._tag)
      .toBe("TaskWorkSessionEstablishmentNeeded")
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("never reports successful inert exact-run recovery for an acknowledged plan", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: planOperation, version: 4 })
    )
    const unused = () => Effect.die("missing eligibility lineage must stop before an authority request")
    const issues = yield* recoverExactRunAfterCoordinatorDeath(runId).pipe(
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          acquireTaskClaim: unused,
          establishTaskWorkSession: unused,
          executeTaskWork: unused,
          handBackReviewFindings: unused,
          readTrackerGraph: unused,
          reconcileTaskWorktree: unused,
          recordImplementationDisposition: unused,
          recordTaskAttemptPlan: unused,
          reviewImplementation: unused,
          sealImplementationEvidence: unused,
          simulateTaskExecution: unused,
          simulateTaskWorkSession: unused
        })
      ),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      _tag: "RecoveryTaskEligibilityIssue",
      reason: "MissingEligibilityObservation"
    })
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(
      TrackerMutation,
      TrackerMutation.of({
        acquireTaskClaim: () => Effect.die("missing lineage must stop before claim acquisition"),
        readTaskClaim: () => Effect.die("missing lineage must stop before claim observation"),
        releaseTaskClaim: () => Effect.die("missing lineage must stop before claim release")
      })
    )
  ))
