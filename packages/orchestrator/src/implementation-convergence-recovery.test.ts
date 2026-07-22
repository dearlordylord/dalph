import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Effect, Fiber, Layer, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import { claimForPlannedAttempt } from "./implementation-convergence-history.js"
import { ImplementationConvergenceDispositionRecordedEvent } from "./implementation-convergence-journal.js"
import { recoverImplementationConvergences } from "./implementation-convergence-recovery.js"
import { AuthorizedImplementationReviewRequest, ReviewFindingsHandbackRequest } from "./implementation-review.js"
import {
  AuthoritativeTaskClaimAcquired,
  AuthoritativeTaskWorktreeReady,
  ClaimOwner,
  ClaimToken,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  FailedProcessExitCode,
  FailedTaskExecutionReported,
  FixtureTarget,
  GitCommitSha,
  GitWorktree,
  ImplementationEvidenceSource,
  ImplementationReviewDisposition,
  ImplementationReviewer,
  ImplementationReviewInvocationFailure,
  ImplementationReviewRoundLimit,
  implementationReviewTestLayer,
  journaledWorkflowInterpreterLayer,
  JournalPosition,
  JournalRecordKey,
  JournalStore,
  MatchingTaskWorkSessionReported,
  memoryEvidenceStoreLayer,
  memoryJournalStoreLayer,
  OperationId,
  PlannedWorktreeReady,
  ProviderObservationId,
  ProviderRequestId,
  reduceManagedHistory,
  ResourceEmergencyTaskExecutionReported,
  ReviewerSessionId,
  ReviewFindingId,
  ReviewFindingsHandback,
  ReviewFindingsHandbackAcknowledged,
  ReviewFindingsHandbackFailure,
  RunId,
  runWorkflow,
  SealedImplementationReview,
  SemanticReviewRound,
  SuccessfulTaskExecutionReported,
  TaskExecutorLocator,
  taskExecutorTestLayer,
  TaskRunner,
  TaskWorkCapacity,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  TechnicalRetryDelayMillis,
  TechnicalRetryLimit,
  TechnicalRetryPolicy,
  TechnicalRetryPolicyCapturedEvent,
  technicalRetryPolicyRecordKey,
  TechnicalRetryScope,
  TestImplementationReview,
  TestTaskExecutor,
  TraceOutputError,
  TrackerGraphReader,
  TrackerMutation,
  WorkerProcessId,
  WorkflowInterpreter,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import { intentRecordKey, outcomeRecordKey } from "./journal-record-key.js"
import {
  makeImplementationDispositionOperation,
  makeImplementationReviewOperation,
  makeReviewFindingsHandbackOperation
} from "./workflow-operation.js"
import { makeTrackerGraphObservedOutcome } from "./workflow-outcome.js"
import { observeManagedRunAuthorities, recoverExactRunAfterCoordinatorDeath } from "./workflow-recovery.js"

const runId = RunId.make("implementation-convergence-recovery")
const operationPrefix = "implementation-convergence-recovery"
const sessionId = TaskWorkSessionId.make(`session:${operationPrefix}:6`)

const taskRunnerLayer = Layer.succeed(
  TaskRunner,
  TaskRunner.of({
    lookupTaskWorkSession: (lookup) =>
      Effect.succeed(MatchingTaskWorkSessionReported.make({
        observationId: ProviderObservationId.make(`lookup:${lookup.operationId}`),
        sessionId,
        work: { _tag: "NoProviderWorkReported" }
      })),
    requestTaskWorkStart: (request) =>
      Effect.succeed({
        observationId: ProviderObservationId.make(`request:${request.operationId}`),
        providerRequestId: ProviderRequestId.make(`provider-request:${request.operationId}`)
      })
  })
)

const baseInterpreterLayer = Layer.succeed(
  WorkflowInterpreter,
  WorkflowInterpreter.of({
    acquireTaskClaim: (operation) =>
      Effect.succeed(AuthoritativeTaskClaimAcquired.make({
        claim: {
          operationId: operation.acquisition.operationId,
          owner: operation.acquisition.owner,
          taskId: operation.acquisition.taskId,
          token: operation.acquisition.token
        }
      })),
    establishTaskWorkSession: () => Effect.die("journaled interpreter owns establishment"),
    executeTaskWork: () => Effect.die("journaled interpreter owns execution"),
    handBackReviewFindings: () => Effect.die("journaled interpreter owns handback"),
    readTrackerGraph: () =>
      Effect.succeed(validSnapshot({
        revision: "implementation-convergence-recovery-revision",
        tasks: [{
          id: "implementation-convergence-recovery-task",
          lifecycle: { _tag: "Open" },
          parentTaskId: null,
          prerequisiteIds: []
        }]
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
    recordImplementationDisposition: () => Effect.die("journaled interpreter owns disposition"),
    recordTaskAttemptPlan: () => Effect.die("journaled interpreter owns planning"),
    reviewImplementation: () => Effect.die("journaled interpreter owns review"),
    sealImplementationEvidence: () => Effect.die("journaled interpreter owns evidence"),
    simulateTaskExecution: () => Effect.die("live recovery does not simulate"),
    simulateTaskWorkSession: () => Effect.die("live recovery does not simulate")
  })
)

const evidenceLayer = Layer.merge(
  memoryEvidenceStoreLayer,
  Layer.succeed(
    ImplementationEvidenceSource,
    ImplementationEvidenceSource.of({
      readDiff: () => Effect.succeed(new TextEncoder().encode("diff"))
    })
  )
)

const authorityPlaceholderLayer = Layer.mergeAll(
  Layer.succeed(
    GitWorktree,
    GitWorktree.of({
      createPlannedWorktree: () => Effect.die("terminal-only refresh does not create worktrees"),
      readPlannedWorktree: () => Effect.die("terminal-only refresh does not read Git")
    })
  ),
  Layer.succeed(
    TrackerGraphReader,
    TrackerGraphReader.of({
      read: () => Effect.die("terminal-only refresh does not read the graph")
    })
  ),
  Layer.succeed(
    TrackerMutation,
    TrackerMutation.of({
      acquireTaskClaim: () => Effect.die("terminal-only refresh does not acquire claims"),
      readTaskClaim: () => Effect.die("terminal-only refresh does not read claims"),
      releaseTaskClaim: () => Effect.die("terminal-only refresh does not release claims")
    })
  )
)

const interpreterLayer = journaledWorkflowInterpreterLayer(
  runId,
  baseInterpreterLayer,
  taskExecutorTestLayer,
  evidenceLayer,
  implementationReviewTestLayer
).pipe(Layer.provide(taskRunnerLayer))

const failingHandbackReviewLayer = Layer.effectContext(Effect.gen(function*() {
  const review = yield* TestImplementationReview
  const handback = ReviewFindingsHandback.of({
    deliverOrResume: (request) =>
      Effect.fail(
        new ReviewFindingsHandbackFailure({
          detail: "handback transport unavailable",
          operationId: request.operationId
        })
      )
  })
  return Context.empty().pipe(
    Context.add(ImplementationReviewer, review),
    Context.add(ReviewFindingsHandback, handback),
    Context.add(TestImplementationReview, review)
  )
})).pipe(Layer.provide(implementationReviewTestLayer))

const handbackFailureInterpreterLayer = journaledWorkflowInterpreterLayer(
  runId,
  baseInterpreterLayer,
  taskExecutorTestLayer,
  evidenceLayer,
  failingHandbackReviewLayer
).pipe(Layer.provide(taskRunnerLayer))

const planningLayer = Layer.mergeAll(
  deterministicOperationIdAllocatorLayer(operationPrefix),
  deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
    executor: TaskExecutorLocator.make("executor:implementation-convergence-recovery"),
    runId,
    sessionRoot: TaskWorkSessionLocator.make("session:implementation-convergence-recovery"),
    worktreeRoot: WorktreeLocator.make("/tmp/implementation-convergence-recovery")
  }),
  deterministicTaskClaimAcquisitionPlannerLayer({
    owner: ClaimOwner.make("implementation-convergence-recovery"),
    tokenPrefix: ClaimToken.make("implementation-convergence-recovery")
  })
)

it.effect("records acceptance after a crash following durable review without invoking another reviewer", () =>
  Effect.gen(function*() {
    const executor = yield* TestTaskExecutor
    const reviews = yield* TestImplementationReview
    yield* reviews.setDispositions([ImplementationReviewDisposition.cases.Accepted.make({})])
    yield* executor.setObservations([SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("initial-execution-observation"),
      operationId: OperationId.make(`${operationPrefix}:7`),
      output: "implementation complete",
      processId: WorkerProcessId.make(71),
      sessionId
    })])
    const crashed = yield* Ref.make(false)
    const trace = WorkflowTrace.of({
      emit: (item) =>
        Effect.gen(function*() {
          if (item._tag !== "ImplementationReviewCompleted" || (yield* Ref.get(crashed))) return
          yield* Ref.set(crashed, true)
          return yield* new TraceOutputError({ detail: "coordinator crashed" })
        })
    })
    const workflow = runWorkflow(
      FixtureTarget.make("implementation-convergence-recovery"),
      TaskWorkCapacity.make(1)
    )
    yield* workflow.pipe(Effect.provideService(WorkflowTrace, trace), Effect.flip)
    expect(
      (yield* (yield* JournalStore).read(runId)).some(({ event }) =>
        event._tag === "ImplementationConvergenceDispositionRecorded"
      )
    ).toBe(false)

    expect(yield* recoverExactRunAfterCoordinatorDeath(runId)).toEqual([])
    const records = yield* (yield* JournalStore).read(runId)
    expect(reduceManagedHistory(runId, records)._tag).toBe("ValidManagedHistory")
    const terminal = records.find(({ event }) => event._tag === "ImplementationConvergenceDispositionRecorded")?.event
    expect(
      terminal?._tag === "ImplementationConvergenceDispositionRecorded"
        && terminal.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
        ? terminal.operation.request.disposition._tag
        : undefined
    ).toBe("Accepted")
    const terminalRecord = records.find(({ event }) => event._tag === "ImplementationConvergenceDispositionRecorded")
    expect(
      terminalRecord === undefined
        ? ["missing terminal"]
        : yield* observeManagedRunAuthorities(runId, [terminalRecord])
    ).toEqual([])
    if (
      terminalRecord?.event._tag !== "ImplementationConvergenceDispositionRecorded"
      || terminalRecord.event.operation.request._tag !== "AuthorizedImplementationConvergenceDisposition"
      || terminalRecord.event.operation.request.disposition._tag !== "Accepted"
    ) return yield* Effect.die("expected authorized terminal record")
    const acceptedDisposition = terminalRecord.event.operation.request.disposition
    expect(claimForPlannedAttempt([], acceptedDisposition.subject.plannedAttempt)).toBeUndefined()
    const replaceTerminalDisposition = (
      disposition: typeof acceptedDisposition
    ) =>
      records.map((candidate) =>
        candidate.event._tag !== "ImplementationConvergenceDispositionRecorded"
          || candidate.event.operation.request._tag !== "AuthorizedImplementationConvergenceDisposition"
          ? candidate
          : {
            ...candidate,
            event: {
              ...candidate.event,
              operation: {
                ...candidate.event.operation,
                request: { ...candidate.event.operation.request, disposition }
              }
            }
          }
      )
    expect(
      reduceManagedHistory(
        runId,
        replaceTerminalDisposition({
          ...acceptedDisposition,
          subject: {
            ...acceptedDisposition.subject,
            claim: { ...acceptedDisposition.subject.claim, token: ClaimToken.make("wrong-terminal-claim") }
          }
        })
      )._tag
    ).toBe("InvalidManagedHistory")
    const simulatedOperation = makeImplementationDispositionOperation({
      _tag: "SimulatedImplementationConvergenceDisposition",
      operationId: OperationId.make("simulated-terminal"),
      plannedAttempt: acceptedDisposition.subject.plannedAttempt,
      roundLimit: ImplementationReviewRoundLimit.make(6)
    }, acceptedDisposition.review.manifest.operationId)
    const simulatedRecords = records.map((candidate) =>
      candidate !== terminalRecord
        ? candidate
        : {
          ...candidate,
          event: ImplementationConvergenceDispositionRecordedEvent.make({
            operation: simulatedOperation,
            version: 3
          })
        }
    )
    expect(
      reduceManagedHistory(runId, simulatedRecords)._tag
    ).toBe("InvalidManagedHistory")
    const simulatedTerminal = simulatedRecords.find(({ event }) =>
      event._tag === "ImplementationConvergenceDispositionRecorded"
    )
    expect(
      simulatedTerminal === undefined
        ? ["missing simulated terminal"]
        : yield* observeManagedRunAuthorities(runId, [simulatedTerminal])
    ).toEqual([])
    expect(
      reduceManagedHistory(
        runId,
        replaceTerminalDisposition({
          ...acceptedDisposition,
          subject: {
            ...acceptedDisposition.subject,
            sessionEstablishmentOperationId: OperationId.make("wrong-session-operation")
          }
        })
      )._tag
    ).toBe("InvalidManagedHistory")
    expect(
      reduceManagedHistory(runId, [
        ...records,
        {
          ...terminalRecord,
          key: JournalRecordKey.make("duplicate-terminal"),
          position: JournalPosition.make(records.length + 1)
        }
      ])._tag
    ).toBe("InvalidManagedHistory")
    const executionIntent = records.find(({ event }) => event._tag === "TaskExecutionIntentRecorded")
    expect(
      executionIntent === undefined
        ? "missing execution"
        : reduceManagedHistory(runId, [
          ...records,
          {
            ...executionIntent,
            key: JournalRecordKey.make("post-terminal-execution"),
            position: JournalPosition.make(records.length + 1)
          }
        ])._tag
    ).toBe("InvalidManagedHistory")
    const journal = yield* JournalStore
    const recoverFrom = (subset: typeof records) =>
      recoverImplementationConvergences(runId).pipe(
        Effect.provideService(JournalStore, JournalStore.of({ ...journal, read: () => Effect.succeed(subset) }))
      )
    const nonTerminal = records.filter(({ event }) => event._tag !== "ImplementationConvergenceDispositionRecorded")
    yield* recoverFrom(nonTerminal.filter(({ event }) => event._tag !== "TaskWorkSessionEstablished"))
    yield* recoverFrom(nonTerminal.filter(({ event }) => event._tag !== "TaskExecutionOutcomeObserved"))
    yield* recoverFrom(nonTerminal.filter(({ event }) => event._tag !== "TaskClaimAcquired"))
    yield* recoverFrom(nonTerminal.filter(({ event }) => event._tag !== "TaskWorktreeReady"))
    expect(yield* recoverExactRunAfterCoordinatorDeath(runId)).toEqual([])
    expect(yield* (yield* TestImplementationReview).requests()).toHaveLength(1)
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(planningLayer),
    Effect.provide(taskRunnerLayer),
    Effect.provide(taskExecutorTestLayer),
    Effect.provide(implementationReviewTestLayer),
    Effect.provide(evidenceLayer),
    Effect.provide(authorityPlaceholderLayer),
    Effect.provide(NodeServices.layer),
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  ))

it.effect("reuses sealed implementation evidence after a crash without sealing it again", () =>
  Effect.gen(function*() {
    const executor = yield* TestTaskExecutor
    const reviews = yield* TestImplementationReview
    yield* reviews.setDispositions([ImplementationReviewDisposition.cases.Accepted.make({})])
    yield* executor.setObservations([SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("sealed-evidence-execution-observation"),
      operationId: OperationId.make(`${operationPrefix}:7`),
      output: "implementation with durable evidence",
      processId: WorkerProcessId.make(76),
      sessionId
    })])
    const crashed = yield* Ref.make(false)
    const trace = WorkflowTrace.of({
      emit: (item) =>
        Effect.gen(function*() {
          if (item._tag !== "ImplementationEvidenceSealed" || (yield* Ref.get(crashed))) return
          yield* Ref.set(crashed, true)
          return yield* new TraceOutputError({ detail: "coordinator crashed after sealing evidence" })
        })
    })
    yield* runWorkflow(
      FixtureTarget.make("implementation-convergence-recovery"),
      TaskWorkCapacity.make(1)
    ).pipe(Effect.provideService(WorkflowTrace, trace), Effect.flip)

    const before = yield* (yield* JournalStore).read(runId)
    expect(before.filter(({ event }) => event._tag === "ImplementationEvidenceSealed")).toHaveLength(1)
    const sealedEvent = before.find(({ event }) => event._tag === "ImplementationEvidenceSealed")?.event
    const executionEvent = before.find(({ event }) => event._tag === "TaskExecutionOutcomeObserved")?.event
    const plannedEvent = before.find(({ event }) => event._tag === "TaskAttemptPlanned")?.event
    if (
      sealedEvent?._tag !== "ImplementationEvidenceSealed"
      || executionEvent?._tag !== "TaskExecutionOutcomeObserved"
      || executionEvent.outcome.outcome._tag !== "Succeeded"
      || plannedEvent?._tag !== "TaskAttemptPlanned"
    ) return yield* Effect.die("expected durable implementation evidence fixture")
    const reviewOperationId = OperationId.make("pending-recovery-review")
    const reviewOperation = makeImplementationReviewOperation(AuthorizedImplementationReviewRequest.make({
      evidenceSealingOperationId: sealedEvent.operationId,
      findingHistory: [],
      implementationEvidence: sealedEvent.sealed,
      implementerInvocationId: executionEvent.outcome.outcome.operationId,
      implementerSessionId: sessionId,
      operationId: reviewOperationId,
      plannedAttempt: plannedEvent.operation.plannedAttempt,
      predecessorEvidenceReference: sealedEvent.sealed.manifestReference,
      reviewerSessionId: ReviewerSessionId.make("pending-recovery-reviewer"),
      round: SemanticReviewRound.make(1),
      roundLimit: ImplementationReviewRoundLimit.make(6)
    }))
    yield* (yield* JournalStore).append(runId, intentRecordKey(reviewOperationId), {
      _tag: "ImplementationReviewIntended",
      operation: reviewOperation,
      version: 3
    })
    expect(yield* recoverExactRunAfterCoordinatorDeath(runId)).toEqual([])
    const records = yield* (yield* JournalStore).read(runId)
    expect(records.filter(({ event }) => event._tag === "ImplementationEvidenceSealed")).toHaveLength(1)
    expect(records.some(({ event }) =>
      event._tag === "ImplementationConvergenceDispositionRecorded"
      && event.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
      && event.operation.request.disposition._tag === "Accepted"
    )).toBe(true)
    expect(reduceManagedHistory(runId, records)._tag).toBe("ValidManagedHistory")
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(planningLayer),
    Effect.provide(taskRunnerLayer),
    Effect.provide(taskExecutorTestLayer),
    Effect.provide(implementationReviewTestLayer),
    Effect.provide(evidenceLayer),
    Effect.provide(NodeServices.layer),
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  ))

it.effect("starts the default first review from durable evidence alone", () =>
  Effect.gen(function*() {
    const executor = yield* TestTaskExecutor
    const reviews = yield* TestImplementationReview
    yield* reviews.setDispositions([ImplementationReviewDisposition.cases.Accepted.make({})])
    yield* executor.setObservations([SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("default-review-execution"),
      operationId: OperationId.make(`${operationPrefix}:7`),
      output: "implementation before first review selection",
      processId: WorkerProcessId.make(80),
      sessionId
    })])
    const trace = WorkflowTrace.of({
      emit: (item) =>
        item._tag === "ImplementationEvidenceSealed"
          ? Effect.fail(new TraceOutputError({ detail: "crashed before first review selection" }))
          : Effect.void
    })
    yield* runWorkflow(
      FixtureTarget.make("implementation-convergence-recovery"),
      TaskWorkCapacity.make(1)
    ).pipe(Effect.provideService(WorkflowTrace, trace), Effect.flip)
    const before = yield* (yield* JournalStore).read(runId)
    expect(before.some(({ event }) => event._tag === "ImplementationReviewIntended")).toBe(false)

    expect(yield* recoverExactRunAfterCoordinatorDeath(runId)).toEqual([])
    const records = yield* (yield* JournalStore).read(runId)
    expect(records.filter(({ event }) => event._tag === "ImplementationEvidenceSealed")).toHaveLength(1)
    expect(records.some(({ event }) =>
      event._tag === "ImplementationConvergenceDispositionRecorded"
      && event.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
      && event.operation.request.disposition._tag === "Accepted"
    )).toBe(true)
    expect(reduceManagedHistory(runId, records)._tag).toBe("ValidManagedHistory")
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(planningLayer),
    Effect.provide(taskRunnerLayer),
    Effect.provide(taskExecutorTestLayer),
    Effect.provide(implementationReviewTestLayer),
    Effect.provide(evidenceLayer),
    Effect.provide(NodeServices.layer),
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  ))

it.effect("resumes an exact pending findings handback after reviewer completion", () =>
  Effect.gen(function*() {
    const executor = yield* TestTaskExecutor
    const reviews = yield* TestImplementationReview
    yield* reviews.setDispositions([
      ImplementationReviewDisposition.cases.Findings.make({
        findings: [{ findingId: ReviewFindingId.make("pending-handback"), text: "fix pending finding" }]
      }),
      ImplementationReviewDisposition.cases.Accepted.make({})
    ])
    yield* executor.setObservations([SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("pending-handback-execution"),
      operationId: OperationId.make(`${operationPrefix}:7`),
      output: "implementation awaiting handback",
      processId: WorkerProcessId.make(78),
      sessionId
    })])
    const trace = WorkflowTrace.of({
      emit: (item) =>
        item._tag === "ImplementationReviewCompleted"
          ? Effect.fail(new TraceOutputError({ detail: "crashed after findings review" }))
          : Effect.void
    })
    yield* runWorkflow(
      FixtureTarget.make("implementation-convergence-recovery"),
      TaskWorkCapacity.make(1)
    ).pipe(Effect.provideService(WorkflowTrace, trace), Effect.flip)

    const before = yield* (yield* JournalStore).read(runId)
    const reviewEvent = before.findLast(({ event }) => event._tag === "ImplementationReviewCompleted")?.event
    if (reviewEvent?._tag !== "ImplementationReviewCompleted") {
      return yield* Effect.die("expected durable findings review")
    }
    const handbackOperationId = OperationId.make("pending-handback-operation")
    const handbackOperation = makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
      implementerInvocationId: reviewEvent.review.manifest.implementerInvocationId,
      implementerSessionId: sessionId,
      operationId: handbackOperationId,
      plannedAttempt: reviewEvent.review.manifest.plannedAttempt,
      review: reviewEvent.review,
      reviewOperationId: reviewEvent.review.manifest.operationId
    }))
    const handbackRetryScope = TechnicalRetryScope.cases.ReviewFindingsHandbackInvocation.make({
      operationId: handbackOperationId,
      reviewOperationId: reviewEvent.review.manifest.operationId,
      semanticRound: reviewEvent.review.manifest.round
    })
    yield* (yield* JournalStore).append(
      runId,
      technicalRetryPolicyRecordKey(handbackRetryScope),
      TechnicalRetryPolicyCapturedEvent.make({
        policy: TechnicalRetryPolicy.make({
          initialDelayMillis: TechnicalRetryDelayMillis.make(100),
          limit: TechnicalRetryLimit.make(3),
          maximumDelayMillis: TechnicalRetryDelayMillis.make(400)
        }),
        scope: handbackRetryScope,
        version: 3
      })
    )
    yield* (yield* JournalStore).append(runId, intentRecordKey(handbackOperationId), {
      _tag: "ReviewFindingsHandbackIntended",
      operation: handbackOperation,
      version: 3
    })
    const withIntent = yield* (yield* JournalStore).read(runId)
    const attemptId = reviewEvent.review.manifest.plannedAttempt.attemptId
    const reworkOperationId = OperationId.make(`recovery:${runId}:${attemptId}:${withIntent.length}:0`)
    yield* executor.setObservations([SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("pending-handback-rework"),
      operationId: reworkOperationId,
      output: "reworked after resumed handback",
      processId: WorkerProcessId.make(79),
      sessionId
    })])

    yield* recoverImplementationConvergences(runId)
    const records = yield* (yield* JournalStore).read(runId)
    expect(reduceManagedHistory(runId, records)._tag).toBe("ValidManagedHistory")
    expect(records.some(({ event }) =>
      event._tag === "ImplementationConvergenceDispositionRecorded"
      && event.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
      && event.operation.request.disposition._tag === "Accepted"
    )).toBe(true)
    expect(yield* reviews.handbacks()).toHaveLength(1)
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(planningLayer),
    Effect.provide(taskRunnerLayer),
    Effect.provide(taskExecutorTestLayer),
    Effect.provide(implementationReviewTestLayer),
    Effect.provide(evidenceLayer),
    Effect.provide(NodeServices.layer),
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  ))

it.effect("continues an acknowledged handback with exact same-session rework after a crash", () =>
  Effect.gen(function*() {
    const executor = yield* TestTaskExecutor
    const reviews = yield* TestImplementationReview
    yield* reviews.setDispositions([
      ImplementationReviewDisposition.cases.Findings.make({
        findings: [{ findingId: ReviewFindingId.make("recovery-finding"), text: "fix this" }]
      }),
      ImplementationReviewDisposition.cases.Accepted.make({})
    ])
    yield* executor.setObservations([SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("findings-execution-observation"),
      operationId: OperationId.make(`${operationPrefix}:7`),
      output: "initial implementation",
      processId: WorkerProcessId.make(72),
      sessionId
    })])
    const crashed = yield* Ref.make(false)
    const trace = WorkflowTrace.of({
      emit: (item) =>
        Effect.gen(function*() {
          if (item._tag !== "ReviewFindingsHandedBack" || (yield* Ref.get(crashed))) return
          yield* Ref.set(crashed, true)
          return yield* new TraceOutputError({ detail: "coordinator crashed after handback" })
        })
    })
    yield* runWorkflow(
      FixtureTarget.make("implementation-convergence-recovery"),
      TaskWorkCapacity.make(1)
    ).pipe(Effect.provideService(WorkflowTrace, trace), Effect.flip)

    const beforeRecovery = yield* (yield* JournalStore).read(runId)
    const attemptId = `attempt:implementation-convergence-recovery-task:0`
    const collidingOperationId = OperationId.make(
      `recovery:${runId}:${attemptId}:${beforeRecovery.length + 2}:0`
    )
    yield* (yield* JournalStore).append(runId, intentRecordKey(collidingOperationId), {
      _tag: "TrackerGraphObservationIntentRecorded",
      operation: {
        _tag: "ReadTrackerGraph",
        operationId: collidingOperationId,
        predecessorOperationIds: [],
        target: FixtureTarget.make("implementation-convergence-recovery")
      },
      version: 3
    })
    yield* (yield* JournalStore).append(runId, outcomeRecordKey(collidingOperationId), {
      _tag: "TrackerGraphOutcomeObserved",
      operationId: collidingOperationId,
      outcome: makeTrackerGraphObservedOutcome(validSnapshot({
        revision: "collision-observation",
        tasks: [{
          id: "implementation-convergence-recovery-task",
          lifecycle: { _tag: "Open" },
          parentTaskId: null,
          prerequisiteIds: []
        }]
      })),
      version: 3
    })
    const reworkOperationId = OperationId.make(
      `recovery:${runId}:${attemptId}:${beforeRecovery.length + 2}:1`
    )
    yield* executor.setObservations([SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("rework-execution-observation"),
      operationId: reworkOperationId,
      output: "reworked implementation",
      processId: WorkerProcessId.make(73),
      sessionId
    })])

    expect(yield* recoverExactRunAfterCoordinatorDeath(runId)).toEqual([])
    const records = yield* (yield* JournalStore).read(runId)
    expect(reduceManagedHistory(runId, records)._tag).toBe("ValidManagedHistory")
    const terminal = records.find(({ event }) => event._tag === "ImplementationConvergenceDispositionRecorded")?.event
    expect(
      terminal?._tag === "ImplementationConvergenceDispositionRecorded"
        && terminal.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
        ? terminal.operation.request.disposition._tag
        : undefined
    ).toBe("Accepted")
    expect(yield* reviews.requests()).toHaveLength(2)
    expect(yield* reviews.handbacks()).toHaveLength(1)
    expect(
      (yield* executor.requests()).map(({ session }) =>
        session._tag === "EstablishedSession" ? session.sessionId : undefined
      )
    ).toEqual([sessionId, sessionId])
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(planningLayer),
    Effect.provide(taskRunnerLayer),
    Effect.provide(taskExecutorTestLayer),
    Effect.provide(implementationReviewTestLayer),
    Effect.provide(evidenceLayer),
    Effect.provide(NodeServices.layer),
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  ))

it.effect("retains a demonstrated first-execution resource emergency without review evidence", () =>
  Effect.gen(function*() {
    const executor = yield* TestTaskExecutor
    yield* executor.setObservations([ResourceEmergencyTaskExecutionReported.make({
      cause: "MemoryExhausted",
      detail: "provider proved its memory cgroup was exhausted",
      observationId: ProviderObservationId.make("initial-resource-emergency"),
      operationId: OperationId.make(`${operationPrefix}:7`),
      partialOutput: "retained partial implementation",
      processId: WorkerProcessId.make(77),
      sessionId,
      wipPreserved: true
    })])
    yield* runWorkflow(
      FixtureTarget.make("implementation-convergence-recovery"),
      TaskWorkCapacity.make(1)
    )

    const records = yield* (yield* JournalStore).read(runId)
    expect(reduceManagedHistory(runId, records)._tag).toBe("ValidManagedHistory")
    const terminalRecord = records.find(({ event }) => event._tag === "ImplementationConvergenceDispositionRecorded")
    expect(
      terminalRecord?.event._tag === "ImplementationConvergenceDispositionRecorded"
        && terminalRecord.event.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
        ? terminalRecord.event.operation.request.disposition._tag
        : undefined
    ).toBe("ResourceEmergency")
    expect(
      terminalRecord === undefined
        ? ["missing terminal"]
        : yield* observeManagedRunAuthorities(runId, [terminalRecord])
    ).toEqual([])
    const emergencyExecutionIntent = records.find(({ event }) => event._tag === "TaskExecutionIntentRecorded")
    if (emergencyExecutionIntent?.event._tag !== "TaskExecutionIntentRecorded") {
      return yield* Effect.die("expected resource-emergency execution intent")
    }
    const withoutTerminal = records.filter(({ event }) => event._tag !== "ImplementationConvergenceDispositionRecorded")
    const postEmergencyOperationId = OperationId.make("post-resource-emergency-execution")
    const postEmergencyHistory = [
      ...withoutTerminal,
      {
        ...emergencyExecutionIntent,
        event: {
          ...emergencyExecutionIntent.event,
          operation: {
            ...emergencyExecutionIntent.event.operation,
            request: {
              ...emergencyExecutionIntent.event.operation.request,
              operationId: postEmergencyOperationId
            }
          }
        },
        key: intentRecordKey(postEmergencyOperationId),
        position: JournalPosition.make(withoutTerminal.length + 1)
      }
    ]
    const postEmergencyReduction = reduceManagedHistory(runId, postEmergencyHistory)
    expect(postEmergencyReduction._tag).toBe("InvalidManagedHistory")
    expect(postEmergencyReduction._tag === "InvalidManagedHistory" ? postEmergencyReduction.issues : [])
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("follows a demonstrated resource emergency") })
      ]))
    const journal = yield* JournalStore
    yield* recoverImplementationConvergences(runId).pipe(
      Effect.provideService(
        JournalStore,
        JournalStore.of({
          ...journal,
          append: () => Effect.die("resource-emergency contradiction must prevent recovery effects"),
          read: () => Effect.succeed(postEmergencyHistory)
        })
      )
    )
    expect(yield* (yield* TestImplementationReview).requests()).toHaveLength(0)
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(planningLayer),
    Effect.provide(taskRunnerLayer),
    Effect.provide(taskExecutorTestLayer),
    Effect.provide(implementationReviewTestLayer),
    Effect.provide(evidenceLayer),
    Effect.provide(authorityPlaceholderLayer),
    Effect.provide(NodeServices.layer),
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  ))

it.effect("authorizes the exact prior review retained by a failed rework", () =>
  Effect.gen(function*() {
    const executor = yield* TestTaskExecutor
    const reviews = yield* TestImplementationReview
    yield* reviews.setDispositions([
      ImplementationReviewDisposition.cases.Findings.make({
        findings: [{ findingId: ReviewFindingId.make("failed-rework"), text: "rework this" }]
      })
    ])
    yield* executor.setObservations([
      SuccessfulTaskExecutionReported.make({
        observationId: ProviderObservationId.make("failed-rework-initial"),
        operationId: OperationId.make(`${operationPrefix}:7`),
        output: "implementation before failed rework",
        processId: WorkerProcessId.make(81),
        sessionId
      }),
      FailedTaskExecutionReported.make({
        exitCode: FailedProcessExitCode.make(1),
        observationId: ProviderObservationId.make("failed-rework-terminal"),
        operationId: OperationId.make(`${operationPrefix}:11`),
        partialOutput: "retained failed rework",
        processId: WorkerProcessId.make(82),
        sessionId,
        wipPreserved: true
      })
    ])
    yield* runWorkflow(
      FixtureTarget.make("implementation-convergence-recovery"),
      TaskWorkCapacity.make(1)
    )

    const records = yield* (yield* JournalStore).read(runId)
    expect(reduceManagedHistory(runId, records)._tag).toBe("ValidManagedHistory")
    const terminalRecord = records.find(({ event }) => event._tag === "ImplementationConvergenceDispositionRecorded")
    expect(
      terminalRecord?.event._tag === "ImplementationConvergenceDispositionRecorded"
        && terminalRecord.event.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
        ? terminalRecord.event.operation.request.disposition._tag
        : undefined
    ).toBe("ImplementationExecutionFailed")
    expect(
      terminalRecord === undefined
        ? ["missing terminal"]
        : yield* observeManagedRunAuthorities(runId, [terminalRecord])
    ).toEqual([])
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(planningLayer),
    Effect.provide(taskRunnerLayer),
    Effect.provide(taskExecutorTestLayer),
    Effect.provide(implementationReviewTestLayer),
    Effect.provide(evidenceLayer),
    Effect.provide(authorityPlaceholderLayer),
    Effect.provide(NodeServices.layer),
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  ))

it.effect("records reviewer technical exhaustion only after its captured schedule is consumed", () =>
  Effect.gen(function*() {
    const executor = yield* TestTaskExecutor
    const reviews = yield* TestImplementationReview
    const reviewOperationId = OperationId.make(`${operationPrefix}:9`)
    const reviewerSessionId = ReviewerSessionId.make(`reviewer-session:${reviewOperationId}`)
    yield* reviews.setDispositions(Array.from({ length: 4 }, () =>
      new ImplementationReviewInvocationFailure({
        detail: "review transport unavailable",
        operationId: reviewOperationId,
        reviewerSessionId
      })))
    yield* executor.setObservations([SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("exhaustion-execution-observation"),
      operationId: OperationId.make(`${operationPrefix}:7`),
      output: "implementation awaiting review",
      processId: WorkerProcessId.make(74),
      sessionId
    })])

    const fiber = yield* runWorkflow(
      FixtureTarget.make("implementation-convergence-recovery"),
      TaskWorkCapacity.make(1)
    ).pipe(Effect.forkScoped)
    yield* TestClock.adjust("1 second")
    yield* Fiber.join(fiber)

    const records = yield* (yield* JournalStore).read(runId)
    expect(reduceManagedHistory(runId, records)._tag).toBe("ValidManagedHistory")
    const terminal = records.find(({ event }) => event._tag === "ImplementationConvergenceDispositionRecorded")?.event
    expect(
      terminal?._tag === "ImplementationConvergenceDispositionRecorded"
        && terminal.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
        ? terminal.operation.request.disposition._tag
        : undefined
    ).toBe("ReviewTechnicalRetryExhausted")
    const withoutRetryFacts = records.filter(({ event }) =>
      event._tag !== "TechnicalRetryPolicyCaptured"
      && event._tag !== "TechnicalRetryScheduled"
      && event._tag !== "TechnicalRetryDeferralSuperseded"
    )
    expect(reduceManagedHistory(runId, withoutRetryFacts)._tag).toBe("InvalidManagedHistory")
    const terminalRecord = records.find(({ event }) => event._tag === "ImplementationConvergenceDispositionRecorded")
    expect(
      terminalRecord === undefined
        ? ["missing terminal"]
        : yield* observeManagedRunAuthorities(runId, [terminalRecord])
    ).toEqual([])
    expect(yield* reviews.requests()).toHaveLength(4)

    if (
      terminalRecord === undefined
      || terminal?._tag !== "ImplementationConvergenceDispositionRecorded"
      || terminal.operation.request._tag !== "AuthorizedImplementationConvergenceDisposition"
      || terminal.operation.request.disposition._tag !== "ReviewTechnicalRetryExhausted"
    ) return yield* Effect.die("expected review exhaustion terminal")
    const request = terminal.operation.request.disposition.request
    const successfulReview = SealedImplementationReview.make({
      manifest: {
        disposition: ImplementationReviewDisposition.cases.Accepted.make({}),
        findingHistory: request.findingHistory,
        implementationEvidenceReference: request.implementationEvidence.manifestReference,
        implementerInvocationId: request.implementerInvocationId,
        implementerSessionId: request.implementerSessionId,
        operationId: request.operationId,
        plannedAttempt: request.plannedAttempt,
        predecessorEvidenceReference: request.predecessorEvidenceReference,
        reviewerSessionId: request.reviewerSessionId,
        round: request.round,
        roundLimit: request.roundLimit,
        stage: "ImplementationReview"
      },
      manifestReference: request.implementationEvidence.manifestReference
    })
    const contradictory = [
      ...records.slice(0, -1),
      {
        event: { _tag: "ImplementationReviewCompleted" as const, review: successfulReview, version: 3 as const },
        key: outcomeRecordKey(request.operationId),
        position: JournalPosition.make(records.length),
        runId
      },
      { ...terminalRecord, position: JournalPosition.make(records.length + 1) }
    ]
    const invalid = reduceManagedHistory(runId, contradictory)
    expect(invalid._tag).toBe("InvalidManagedHistory")
    expect(
      invalid._tag === "InvalidManagedHistory"
        ? invalid.issues.some(({ detail }) => detail.includes("before its captured retry limit"))
        : false
    ).toBe(true)
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(planningLayer),
    Effect.provide(taskRunnerLayer),
    Effect.provide(taskExecutorTestLayer),
    Effect.provide(implementationReviewTestLayer),
    Effect.provide(evidenceLayer),
    Effect.provide(authorityPlaceholderLayer),
    Effect.provide(NodeServices.layer),
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  ))

it.effect("records handback technical exhaustion separately after its captured schedule is consumed", () =>
  Effect.gen(function*() {
    const executor = yield* TestTaskExecutor
    const reviews = yield* TestImplementationReview
    yield* reviews.setDispositions([
      ImplementationReviewDisposition.cases.Findings.make({
        findings: [{ findingId: ReviewFindingId.make("exhausted-handback"), text: "fix remains unresolved" }]
      })
    ])
    yield* executor.setObservations([SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("handback-exhaustion-execution"),
      operationId: OperationId.make(`${operationPrefix}:7`),
      output: "implementation with findings",
      processId: WorkerProcessId.make(75),
      sessionId
    })])

    const fiber = yield* runWorkflow(
      FixtureTarget.make("implementation-convergence-recovery"),
      TaskWorkCapacity.make(1)
    ).pipe(Effect.forkScoped)
    yield* TestClock.adjust("1 second")
    yield* Fiber.join(fiber)

    const records = yield* (yield* JournalStore).read(runId)
    expect(reduceManagedHistory(runId, records)._tag).toBe("ValidManagedHistory")
    const terminal = records.find(({ event }) => event._tag === "ImplementationConvergenceDispositionRecorded")?.event
    expect(
      terminal?._tag === "ImplementationConvergenceDispositionRecorded"
        && terminal.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
        ? terminal.operation.request.disposition._tag
        : undefined
    ).toBe("HandbackTechnicalRetryExhausted")
    const terminalRecord = records.find(({ event }) => event._tag === "ImplementationConvergenceDispositionRecorded")
    expect(
      terminalRecord === undefined
        ? ["missing terminal"]
        : yield* observeManagedRunAuthorities(runId, [terminalRecord])
    ).toEqual([])

    if (
      terminalRecord === undefined
      || terminal?._tag !== "ImplementationConvergenceDispositionRecorded"
      || terminal.operation.request._tag !== "AuthorizedImplementationConvergenceDisposition"
      || terminal.operation.request.disposition._tag !== "HandbackTechnicalRetryExhausted"
    ) return yield* Effect.die("expected handback exhaustion terminal")
    const request = terminal.operation.request.disposition.request
    const contradictory = [
      ...records.slice(0, -1),
      {
        event: {
          _tag: "ReviewFindingsHandbackCompleted" as const,
          acknowledgement: ReviewFindingsHandbackAcknowledged.make({
            operationId: request.operationId,
            reviewEvidenceReference: request.review.manifestReference
          }),
          version: 3 as const
        },
        key: outcomeRecordKey(request.operationId),
        position: JournalPosition.make(records.length),
        runId
      },
      { ...terminalRecord, position: JournalPosition.make(records.length + 1) }
    ]
    const invalid = reduceManagedHistory(runId, contradictory)
    expect(invalid._tag).toBe("InvalidManagedHistory")
    expect(
      invalid._tag === "InvalidManagedHistory"
        ? invalid.issues.some(({ detail }) => detail.includes("before its captured retry limit"))
        : false
    ).toBe(true)
  }).pipe(
    Effect.provide(handbackFailureInterpreterLayer),
    Effect.provide(planningLayer),
    Effect.provide(taskRunnerLayer),
    Effect.provide(taskExecutorTestLayer),
    Effect.provide(failingHandbackReviewLayer),
    Effect.provide(evidenceLayer),
    Effect.provide(authorityPlaceholderLayer),
    Effect.provide(NodeServices.layer),
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  ))
