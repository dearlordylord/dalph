import { it } from "@effect/vitest"
import { Effect, Ref, Result, Schema } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  FailedProcessExitCode,
  FixtureTarget,
  GitCommitSha,
  ImplementationReviewRoundLimit,
  JournalPosition,
  JournalRecordKey,
  OperationId,
  ProviderObservationId,
  ReviewerSessionId,
  ReviewFindingId,
  RunId,
  SemanticReviewRound,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorkerProcessId,
  WorktreeLocator
} from "./domain.js"
import { PlannedWorktreeReady } from "./git-worktree.js"
import { convergenceDispositionPredecessorMatches } from "./implementation-convergence-history.js"
import { ImplementationConvergenceDisposition } from "./implementation-convergence.js"
import { EvidenceDigest, EvidenceReference, SealedImplementationEvidence } from "./implementation-evidence.js"
import {
  AuthorizedImplementationReviewRequest,
  ImplementationReviewDisposition,
  ImplementationReviewInvocationFailure,
  ReviewFinding,
  ReviewFindingsHandbackAcknowledged,
  ReviewFindingsHandbackFailure,
  ReviewFindingsHandbackRequest,
  SealedImplementationReview
} from "./implementation-review.js"
import type { JournalRecord, JournalStoreService, WorkflowJournalEvent } from "./journal-store.js"
import {
  ImplementationConvergenceHistoryContradiction,
  makeJournaledImplementationDisposition
} from "./journaled-implementation-convergence.js"
import { reduceManagedHistory } from "./managed-history.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionOutcome, TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import { ActiveTaskClaim } from "./tracker-mutation.js"
import {
  makeImplementationDispositionOperation,
  makeImplementationEvidenceSealingOperation,
  makeImplementationReviewOperation,
  makeReviewFindingsHandbackOperation,
  makeTaskExecutionOperation
} from "./workflow-operation.js"

const runId = RunId.make("journaled-convergence-run")
const taskId = TaskId.make("journaled-convergence-task")
const sessionId = TaskWorkSessionId.make("journaled-convergence-session")
const task = { id: taskId, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }
const plannedAttempt = {
  attemptId: AttemptId.make("journaled-convergence-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/dalph/journaled-convergence"),
  executor: TaskExecutorLocator.make("executor:journaled-convergence"),
  runId,
  session: TaskWorkSessionLocator.make("session:journaled-convergence"),
  taskId,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/journaled-convergence")
}
const claim = ActiveTaskClaim.make({
  operationId: OperationId.make("journaled-convergence-claim"),
  owner: ClaimOwner.make("journaled-convergence-owner"),
  taskId,
  token: ClaimToken.make("journaled-convergence-token")
})
const subject = {
  claim,
  plannedAttempt,
  sessionEstablishmentOperationId: OperationId.make("session-operation"),
  sessionId,
  worktreeOperationId: OperationId.make("worktree-operation"),
  worktreeProof: PlannedWorktreeReady.make({
    baseSha: plannedAttempt.baseSha,
    branch: plannedAttempt.branch,
    headSha: plannedAttempt.baseSha,
    worktree: plannedAttempt.worktree
  })
}
const reference = EvidenceReference.make({
  byteLength: 1,
  digest: EvidenceDigest.make("a".repeat(64))
})
const execution = TaskExecutionOutcome.cases.Succeeded.make({
  observationId: ProviderObservationId.make("journaled-convergence-observation"),
  operationId: OperationId.make("journaled-convergence-execution"),
  output: "complete",
  processId: WorkerProcessId.make(41),
  sessionId
})
const implementationEvidence = SealedImplementationEvidence.make({
  manifest: {
    diff: reference,
    implementationOutput: reference,
    plannedBaseSha: plannedAttempt.baseSha,
    predecessorOperationId: execution.operationId,
    runId,
    stage: "Implementation",
    taskId
  },
  manifestReference: reference
})
const reviewRequest = AuthorizedImplementationReviewRequest.make({
  evidenceSealingOperationId: OperationId.make("journaled-convergence-evidence"),
  findingHistory: [],
  implementationEvidence,
  implementerInvocationId: execution.operationId,
  implementerSessionId: sessionId,
  operationId: OperationId.make("journaled-convergence-review"),
  plannedAttempt,
  predecessorEvidenceReference: reference,
  reviewerSessionId: ReviewerSessionId.make("journaled-convergence-reviewer"),
  round: SemanticReviewRound.make(1),
  roundLimit: ImplementationReviewRoundLimit.make(2)
})
const review = SealedImplementationReview.make({
  manifest: {
    disposition: ImplementationReviewDisposition.cases.Accepted.make({}),
    findingHistory: [],
    implementationEvidenceReference: reference,
    implementerInvocationId: execution.operationId,
    implementerSessionId: sessionId,
    operationId: reviewRequest.operationId,
    plannedAttempt,
    predecessorEvidenceReference: reference,
    reviewerSessionId: reviewRequest.reviewerSessionId,
    round: SemanticReviewRound.make(1),
    roundLimit: ImplementationReviewRoundLimit.make(2),
    stage: "ImplementationReview"
  },
  manifestReference: reference
})

const record = (event: WorkflowJournalEvent, position: number): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`fixture:${position}`),
  position: JournalPosition.make(position),
  runId
})

const baseRecords = (): ReadonlyArray<JournalRecord> => [
  record({
    _tag: "TrackerGraphObservationIntentRecorded",
    operation: {
      _tag: "ReadTrackerGraph",
      operationId: OperationId.make("admission"),
      predecessorOperationIds: [claim.operationId],
      target: FixtureTarget.make("journaled-convergence")
    },
    version: 3
  }, 1),
  record({
    _tag: "TaskAttemptPlanned",
    operation: {
      _tag: "RecordTaskAttemptPlan",
      operationId: OperationId.make("plan"),
      plannedAttempt,
      predecessorOperationIds: [OperationId.make("admission")]
    },
    version: 3
  }, 2),
  record({ _tag: "TaskClaimAcquired", claim, version: 3 }, 3),
  record({
    _tag: "TaskWorktreeReconciliationIntended",
    operation: {
      _tag: "ReconcileTaskWorktree",
      operationId: subject.worktreeOperationId,
      plannedAttempt,
      predecessorOperationIds: [OperationId.make("plan")]
    },
    version: 3
  }, 4),
  record({
    _tag: "TaskWorktreeReady",
    operationId: subject.worktreeOperationId,
    proof: subject.worktreeProof,
    version: 3
  }, 5),
  record({
    _tag: "TaskWorkSessionEstablishmentIntentRecorded",
    operation: {
      _tag: "EstablishTaskWorkSession",
      predecessorOperationIds: [],
      request: { operationId: OperationId.make("session-operation"), plannedAttempt, task }
    },
    version: 3
  }, 6),
  record({
    _tag: "TaskWorkSessionEstablished",
    outcome: {
      _tag: "TaskWorkSessionEstablished",
      operationId: OperationId.make("session-operation"),
      sessionId
    },
    version: 3
  }, 7),
  record({
    _tag: "TaskExecutionIntentRecorded",
    operation: makeTaskExecutionOperation({
      predecessorOperationIds: [subject.sessionEstablishmentOperationId],
      request: TaskExecutionRequest.make({
        operationId: execution.operationId,
        plannedAttempt,
        session: TaskExecutionSessionBinding.cases.EstablishedSession.make({ sessionId }),
        task
      })
    }),
    version: 3
  }, 8),
  record({
    _tag: "TaskExecutionOutcomeObserved",
    outcome: { _tag: "TaskExecutionObserved", outcome: execution },
    version: 3
  }, 9),
  record({
    _tag: "ImplementationEvidenceSealingIntended",
    operation: makeImplementationEvidenceSealingOperation({
      execution: { _tag: "SuccessfulExecution", outcome: execution },
      operationId: reviewRequest.evidenceSealingOperationId,
      plannedAttempt
    }),
    version: 3
  }, 10),
  record({
    _tag: "ImplementationEvidenceSealed",
    operationId: reviewRequest.evidenceSealingOperationId,
    sealed: implementationEvidence,
    version: 3
  }, 11),
  record({
    _tag: "ImplementationReviewIntended",
    operation: makeImplementationReviewOperation(reviewRequest),
    version: 3
  }, 12),
  record({
    _tag: "ImplementationReviewCompleted",
    review,
    version: 3
  }, 13)
]

const testJournal = Effect.fn("JournaledConvergenceTest.journal")(function*(initial: ReadonlyArray<JournalRecord>) {
  const records = yield* Ref.make(initial)
  const journal: JournalStoreService = {
    append: (journalRunId, key, event) =>
      Ref.modify(records, (current) => {
        const existing = current.find((item) => item.key === key)
        if (existing !== undefined) return [existing, current]
        const appended = { event, key, position: JournalPosition.make(current.length + 1), runId: journalRunId }
        return [appended, [...current, appended]]
      }),
    read: () => Ref.get(records),
    scan: () => Effect.die("unused scan")
  }
  return { journal, records }
})

it.effect("records one exact accepted disposition and replays it idempotently", () =>
  Effect.gen(function*() {
    const fixture = yield* testJournal(baseRecords())
    const disposition = ImplementationConvergenceDisposition.cases.Accepted.make({ review, subject })
    const operation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition,
      operationId: OperationId.make("journaled-convergence-disposition")
    }, review.manifest.operationId)
    const recordDisposition = makeJournaledImplementationDisposition(runId, fixture.journal)

    expect(convergenceDispositionPredecessorMatches([], {
      ...operation,
      request: {
        _tag: "SimulatedImplementationConvergenceDisposition",
        operationId: operation.request.operationId,
        plannedAttempt,
        roundLimit: ImplementationReviewRoundLimit.make(2)
      }
    })).toBe(true)
    expect(convergenceDispositionPredecessorMatches(baseRecords(), {
      ...operation,
      predecessorOperationIds: []
    })).toBe(false)

    const predecessorFixture = yield* testJournal(baseRecords())
    expect(
      yield* makeJournaledImplementationDisposition(runId, predecessorFixture.journal)({
        ...operation,
        predecessorOperationIds: []
      }).pipe(Effect.flip)
    ).toMatchObject({ reason: "PredecessorMismatch" })

    expect(yield* recordDisposition(operation)).toMatchObject({ disposition })
    expect(yield* recordDisposition(operation)).toMatchObject({ disposition })
    expect(yield* Ref.get(fixture.records)).toHaveLength(14)

    const contradictory = baseRecords().map((item) =>
      item.event._tag === "ImplementationReviewCompleted"
        ? record({
          ...item.event,
          review: {
            ...item.event.review,
            manifest: {
              ...item.event.review.manifest,
              reviewerSessionId: ReviewerSessionId.make("same-operation-different-reviewer")
            }
          }
        }, Number(item.position))
        : item
    )
    const contradictoryFixture = yield* testJournal(contradictory)
    const rejected = yield* makeJournaledImplementationDisposition(runId, contradictoryFixture.journal)(operation)
      .pipe(Effect.flip)
    expect(rejected).toMatchObject({ reason: "MissingReview" })
    const reduced = reduceManagedHistory(runId, contradictory)
    expect(reduced._tag).toBe("InvalidManagedHistory")
    expect(reduced._tag === "InvalidManagedHistory" ? reduced.issues : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("implementation review round 1 lacks") })
      ])
    )
  }))

it.effect("rejects missing lineage and a contradictory second terminal disposition", () =>
  Effect.gen(function*() {
    const disposition = ImplementationConvergenceDisposition.cases.Accepted.make({ review, subject })
    const operation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition,
      operationId: OperationId.make("journaled-convergence-first")
    }, review.manifest.operationId)

    for (
      const [records, reason] of [
        [[], "MissingAttempt"],
        [baseRecords().slice(0, 2), "MissingClaim"],
        [baseRecords().slice(0, 5), "MissingSession"],
        [baseRecords().slice(0, 12), "MissingReview"]
      ] as const
    ) {
      const fixture = yield* testJournal(records)
      const failure = yield* makeJournaledImplementationDisposition(runId, fixture.journal)(operation).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(ImplementationConvergenceHistoryContradiction)
      expect(failure instanceof ImplementationConvergenceHistoryContradiction ? failure.reason : undefined).toBe(reason)
    }

    const fixture = yield* testJournal(baseRecords())
    const recordDisposition = makeJournaledImplementationDisposition(runId, fixture.journal)
    yield* recordDisposition(operation)
    const second = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition,
      operationId: OperationId.make("journaled-convergence-second")
    }, review.manifest.operationId)
    const failure = yield* recordDisposition(second).pipe(Effect.flip)
    expect(failure instanceof ImplementationConvergenceHistoryContradiction ? failure.reason : undefined)
      .toBe("DispositionAlreadyRecorded")
  }))

it.effect("records every exact terminal execution class without inventing prior review evidence", () =>
  Effect.gen(function*() {
    const common = {
      observationId: execution.observationId,
      operationId: execution.operationId,
      partialOutput: "retained",
      processId: execution.processId,
      sessionId,
      wipPreserved: true as const
    }
    const cases = [
      {
        expected: "ImplementationExecutionFailed",
        outcome: TaskExecutionOutcome.cases.Failed.make({
          ...common,
          exitCode: FailedProcessExitCode.make(9)
        })
      },
      {
        expected: "ImplementationExecutionInterrupted",
        outcome: TaskExecutionOutcome.cases.Interrupted.make(common)
      },
      {
        expected: "ResourceEmergency",
        outcome: TaskExecutionOutcome.cases.ResourceEmergency.make({
          ...common,
          cause: "MemoryExhausted",
          detail: "provider proved its memory limit was reached"
        })
      }
    ] as const
    for (const item of cases) {
      const records = [
        ...baseRecords().slice(0, 8),
        record({
          _tag: "TaskExecutionOutcomeObserved",
          outcome: { _tag: "TaskExecutionObserved", outcome: item.outcome },
          version: 3
        }, 9)
      ]
      const fixture = yield* testJournal(records)
      const priorEvidence = { _tag: "NoPriorReviewEvidence" as const }
      const disposition = item.outcome._tag === "Failed"
        ? ImplementationConvergenceDisposition.cases.ImplementationExecutionFailed.make({
          outcome: item.outcome,
          priorEvidence,
          subject
        })
        : item.outcome._tag === "Interrupted"
        ? ImplementationConvergenceDisposition.cases.ImplementationExecutionInterrupted.make({
          outcome: item.outcome,
          priorEvidence,
          subject
        })
        : ImplementationConvergenceDisposition.cases.ResourceEmergency.make({
          outcome: item.outcome,
          priorEvidence,
          subject
        })
      const operation = makeImplementationDispositionOperation({
        _tag: "AuthorizedImplementationConvergenceDisposition",
        disposition,
        operationId: OperationId.make(`disposition:${item.expected}`)
      }, item.outcome.operationId)
      expect(yield* makeJournaledImplementationDisposition(runId, fixture.journal)(operation))
        .toMatchObject({ disposition: { _tag: item.expected } })
      const contradictoryOutcome = item.outcome._tag === "ResourceEmergency"
        ? { ...item.outcome, detail: "contradictory same-operation emergency detail" }
        : { ...item.outcome, partialOutput: "contradictory same-operation bytes" }
      const contradictoryRecords = records.map((candidate) =>
        candidate.event._tag === "TaskExecutionOutcomeObserved"
          ? record({
            ...candidate.event,
            outcome: {
              ...candidate.event.outcome,
              outcome: contradictoryOutcome
            }
          }, Number(candidate.position))
          : candidate
      )
      const contradictoryFixture = yield* testJournal(contradictoryRecords)
      const rejected = yield* makeJournaledImplementationDisposition(runId, contradictoryFixture.journal)(operation)
        .pipe(Effect.flip)
      expect(rejected).toMatchObject({ reason: "MissingExecution" })
    }
  }))

it.effect("projects simulation without journal mutation", () =>
  Effect.gen(function*() {
    const fixture = yield* testJournal([])
    const operation = makeImplementationDispositionOperation({
      _tag: "SimulatedImplementationConvergenceDisposition",
      operationId: OperationId.make("simulated-convergence"),
      plannedAttempt,
      roundLimit: ImplementationReviewRoundLimit.make(2)
    }, OperationId.make("simulated-predecessor"))
    expect(yield* makeJournaledImplementationDisposition(runId, fixture.journal)(operation)).toMatchObject({
      _tag: "ImplementationConvergenceSimulated",
      operationId: operation.request.operationId
    })
    expect(yield* Ref.get(fixture.records)).toHaveLength(0)
  }))

it.effect("requires the exact latest review before a failed rework execution", () =>
  Effect.gen(function*() {
    const failed = TaskExecutionOutcome.cases.Failed.make({
      exitCode: FailedProcessExitCode.make(5),
      observationId: ProviderObservationId.make("failed-rework-observation"),
      operationId: OperationId.make("failed-rework"),
      partialOutput: "retained rework",
      processId: WorkerProcessId.make(42),
      sessionId,
      wipPreserved: true
    })
    const records = [
      ...baseRecords(),
      record({
        _tag: "TaskExecutionIntentRecorded",
        operation: makeTaskExecutionOperation({
          predecessorOperationIds: [review.manifest.operationId, subject.sessionEstablishmentOperationId],
          request: TaskExecutionRequest.make({
            operationId: failed.operationId,
            plannedAttempt,
            session: TaskExecutionSessionBinding.cases.EstablishedSession.make({ sessionId }),
            task
          })
        }),
        version: 3
      }, 14),
      record({
        _tag: "TaskExecutionOutcomeObserved",
        outcome: { _tag: "TaskExecutionObserved", outcome: failed },
        version: 3
      }, 15)
    ]
    const disposition = ImplementationConvergenceDisposition.cases.ImplementationExecutionFailed.make({
      outcome: failed,
      priorEvidence: { _tag: "PriorReviewEvidence", review },
      subject
    })
    const operation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition,
      operationId: OperationId.make("failed-rework-disposition")
    }, failed.operationId)
    const fixture = yield* testJournal(records)
    expect(yield* makeJournaledImplementationDisposition(runId, fixture.journal)(operation))
      .toMatchObject({ disposition: { priorEvidence: { _tag: "PriorReviewEvidence" } } })

    const missing = ImplementationConvergenceDisposition.cases.ImplementationExecutionFailed.make({
      outcome: failed,
      priorEvidence: { _tag: "NoPriorReviewEvidence" },
      subject
    })
    const missingOperation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition: missing,
      operationId: OperationId.make("failed-rework-missing-review")
    }, failed.operationId)
    const secondFixture = yield* testJournal(records)
    const failure = yield* makeJournaledImplementationDisposition(runId, secondFixture.journal)(missingOperation)
      .pipe(Effect.flip)
    expect(failure instanceof ImplementationConvergenceHistoryContradiction ? failure.reason : undefined)
      .toBe("MissingReview")
  }))

it.effect("rejects run, claim, session, and execution lineage contradictions", () =>
  Effect.gen(function*() {
    const acceptedOperation = (nextSubject: typeof subject, operationId: string) =>
      makeImplementationDispositionOperation({
        _tag: "AuthorizedImplementationConvergenceDisposition",
        disposition: ImplementationConvergenceDisposition.cases.Accepted.make({ review, subject: nextSubject }),
        operationId: OperationId.make(operationId)
      }, review.manifest.operationId)
    const expectReason = Effect.fn("JournaledConvergenceTest.expectReason")(function*(
      records: ReadonlyArray<JournalRecord>,
      operation: ReturnType<typeof acceptedOperation>,
      reason: ImplementationConvergenceHistoryContradiction["reason"]
    ) {
      const fixture = yield* testJournal(records)
      const failure = yield* makeJournaledImplementationDisposition(runId, fixture.journal)(operation)
        .pipe(Effect.flip)
      expect(failure instanceof ImplementationConvergenceHistoryContradiction ? failure.reason : undefined)
        .toBe(reason)
    })

    const foreignPlan = { ...plannedAttempt, runId: RunId.make("foreign-convergence-run") }
    const foreignReview = SealedImplementationReview.make({
      ...review,
      manifest: { ...review.manifest, plannedAttempt: foreignPlan }
    })
    const foreignSubject = { ...subject, plannedAttempt: foreignPlan }
    const foreignOperation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition: ImplementationConvergenceDisposition.cases.Accepted.make({
        review: foreignReview,
        subject: foreignSubject
      }),
      operationId: OperationId.make("foreign-run-disposition")
    }, foreignReview.manifest.operationId)
    yield* expectReason(baseRecords(), foreignOperation, "RunMismatch")

    const sameIdDifferentBaseReview = SealedImplementationReview.make({
      ...review,
      manifest: {
        ...review.manifest,
        plannedAttempt: {
          ...plannedAttempt,
          baseSha: GitCommitSha.make("f".repeat(40))
        }
      }
    })
    expect(Result.isFailure(
      Schema.decodeUnknownResult(ImplementationConvergenceDisposition)({
        _tag: "Accepted",
        review: sameIdDifferentBaseReview,
        subject
      })
    )).toBe(true)

    const foreignClaim = ActiveTaskClaim.make({
      ...claim,
      token: ClaimToken.make("foreign-claim-token")
    })
    yield* expectReason(
      baseRecords(),
      acceptedOperation({ ...subject, claim: foreignClaim }, "foreign-claim-disposition"),
      "ClaimMismatch"
    )
    yield* expectReason(
      baseRecords(),
      acceptedOperation({
        ...subject,
        sessionEstablishmentOperationId: OperationId.make("foreign-session-operation")
      }, "missing-session-disposition"),
      "MissingSession"
    )

    const mismatchedSessionRecords = baseRecords().map((item) =>
      item.event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
        ? {
          ...item,
          event: {
            ...item.event,
            operation: {
              ...item.event.operation,
              request: { ...item.event.operation.request, plannedAttempt: foreignPlan }
            }
          }
        } as JournalRecord
        : item
    )
    yield* expectReason(
      mismatchedSessionRecords,
      acceptedOperation(subject, "mismatched-session-disposition"),
      "SessionMismatch"
    )

    const missingExecution = TaskExecutionOutcome.cases.Interrupted.make({
      observationId: ProviderObservationId.make("missing-execution-observation"),
      operationId: OperationId.make("missing-execution"),
      partialOutput: "unknown",
      processId: WorkerProcessId.make(43),
      sessionId,
      wipPreserved: true
    })
    const missingDisposition = ImplementationConvergenceDisposition.cases.ImplementationExecutionInterrupted.make({
      outcome: missingExecution,
      priorEvidence: { _tag: "PriorReviewEvidence", review },
      subject
    })
    const missingOperation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition: missingDisposition,
      operationId: OperationId.make("missing-execution-disposition")
    }, missingExecution.operationId)
    const missingFixture = yield* testJournal(baseRecords())
    const failure = yield* makeJournaledImplementationDisposition(runId, missingFixture.journal)(missingOperation)
      .pipe(Effect.flip)
    expect(failure instanceof ImplementationConvergenceHistoryContradiction ? failure.reason : undefined)
      .toBe("MissingExecution")

    const crossAttemptOutcome = TaskExecutionOutcome.cases.Interrupted.make({
      observationId: ProviderObservationId.make("cross-attempt-execution-observation"),
      operationId: execution.operationId,
      partialOutput: "retained",
      processId: WorkerProcessId.make(44),
      sessionId,
      wipPreserved: true
    })
    const crossAttemptRecords = baseRecords().slice(0, 9).map((item) =>
      item.event._tag === "TaskExecutionIntentRecorded"
        ? {
          ...item,
          event: {
            ...item.event,
            operation: {
              ...item.event.operation,
              request: {
                ...item.event.operation.request,
                plannedAttempt: {
                  ...plannedAttempt,
                  baseSha: GitCommitSha.make("e".repeat(40))
                }
              }
            }
          }
        } as JournalRecord
        : item.event._tag === "TaskExecutionOutcomeObserved"
        ? record({
          ...item.event,
          outcome: { _tag: "TaskExecutionObserved", outcome: crossAttemptOutcome }
        }, Number(item.position))
        : item
    )
    const crossAttemptDisposition = ImplementationConvergenceDisposition.cases
      .ImplementationExecutionInterrupted.make({
        outcome: crossAttemptOutcome,
        priorEvidence: { _tag: "NoPriorReviewEvidence" },
        subject
      })
    const crossAttemptOperation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition: crossAttemptDisposition,
      operationId: OperationId.make("cross-attempt-execution-disposition")
    }, crossAttemptOutcome.operationId)
    const crossAttemptFixture = yield* testJournal(crossAttemptRecords)
    expect(
      yield* makeJournaledImplementationDisposition(runId, crossAttemptFixture.journal)(crossAttemptOperation)
        .pipe(Effect.flip)
    ).toMatchObject({ reason: "MissingExecution" })
  }))

it.effect("rejects missing or mismatched retained ready-worktree evidence", () =>
  Effect.gen(function*() {
    const dispositionFor = (retainedSubject: typeof subject) =>
      ImplementationConvergenceDisposition.cases.Accepted.make({ review, subject: retainedSubject })
    const operationFor = (retainedSubject: typeof subject) =>
      makeImplementationDispositionOperation({
        _tag: "AuthorizedImplementationConvergenceDisposition",
        disposition: dispositionFor(retainedSubject),
        operationId: OperationId.make(`worktree-proof:${retainedSubject.worktreeOperationId}`)
      }, review.manifest.operationId)
    const cases = [
      {
        records: baseRecords().filter(({ event }) => event._tag !== "TaskWorktreeReady"),
        retainedSubject: subject
      },
      {
        records: baseRecords(),
        retainedSubject: {
          ...subject,
          worktreeOperationId: OperationId.make("different-worktree-operation")
        }
      },
      {
        records: baseRecords(),
        retainedSubject: {
          ...subject,
          worktreeProof: PlannedWorktreeReady.make({
            ...subject.worktreeProof,
            headSha: GitCommitSha.make("f".repeat(40))
          })
        }
      }
    ] as const
    for (const item of cases) {
      const fixture = yield* testJournal(item.records)
      const failure = yield* makeJournaledImplementationDisposition(runId, fixture.journal)(
        operationFor(item.retainedSubject)
      ).pipe(Effect.flip)
      expect(failure).toMatchObject({ reason: "MissingWorktree" })
    }
  }))

it.effect("rejects technical exhaustion without exact intent, evidence, review, and consumed retries", () =>
  Effect.gen(function*() {
    const sealed = SealedImplementationEvidence.make({
      manifest: {
        diff: reference,
        implementationOutput: reference,
        plannedBaseSha: plannedAttempt.baseSha,
        predecessorOperationId: execution.operationId,
        runId,
        stage: "Implementation",
        taskId
      },
      manifestReference: reference
    })
    const reviewRequest = AuthorizedImplementationReviewRequest.make({
      evidenceSealingOperationId: OperationId.make("technical-evidence"),
      findingHistory: [],
      implementationEvidence: sealed,
      implementerInvocationId: execution.operationId,
      implementerSessionId: sessionId,
      operationId: OperationId.make("technical-review"),
      plannedAttempt,
      predecessorEvidenceReference: reference,
      reviewerSessionId: ReviewerSessionId.make("technical-reviewer"),
      round: SemanticReviewRound.make(1),
      roundLimit: ImplementationReviewRoundLimit.make(2)
    })
    const reviewDisposition = ImplementationConvergenceDisposition.cases.ReviewTechnicalRetryExhausted.make({
      failure: new ImplementationReviewInvocationFailure({
        detail: "review unavailable",
        operationId: reviewRequest.operationId,
        reviewerSessionId: reviewRequest.reviewerSessionId
      }),
      request: reviewRequest,
      subject
    })
    const reviewOperation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition: reviewDisposition,
      operationId: OperationId.make("technical-review-disposition")
    }, reviewRequest.operationId)
    const reviewIntent = record({
      _tag: "ImplementationReviewIntended",
      operation: makeImplementationReviewOperation(reviewRequest),
      version: 3
    }, 16)
    const contradictoryReviewIntent = record({
      _tag: "ImplementationReviewIntended",
      operation: makeImplementationReviewOperation({
        ...reviewRequest,
        reviewerSessionId: ReviewerSessionId.make("technical-reviewer-contradiction")
      }),
      version: 3
    }, 16)
    const evidence = record({
      _tag: "ImplementationEvidenceSealed",
      operationId: reviewRequest.evidenceSealingOperationId,
      sealed,
      version: 3
    }, 15)
    const evidenceIntent = record({
      _tag: "ImplementationEvidenceSealingIntended",
      operation: makeImplementationEvidenceSealingOperation({
        execution: { _tag: "SuccessfulExecution", outcome: execution },
        operationId: reviewRequest.evidenceSealingOperationId,
        plannedAttempt
      }),
      version: 3
    }, 14)
    const successfulReview = SealedImplementationReview.make({
      manifest: {
        disposition: ImplementationReviewDisposition.cases.Accepted.make({}),
        findingHistory: reviewRequest.findingHistory,
        implementationEvidenceReference: sealed.manifestReference,
        implementerInvocationId: reviewRequest.implementerInvocationId,
        implementerSessionId: reviewRequest.implementerSessionId,
        operationId: reviewRequest.operationId,
        plannedAttempt: reviewRequest.plannedAttempt,
        predecessorEvidenceReference: reviewRequest.predecessorEvidenceReference,
        reviewerSessionId: reviewRequest.reviewerSessionId,
        round: reviewRequest.round,
        roundLimit: reviewRequest.roundLimit,
        stage: "ImplementationReview"
      },
      manifestReference: reference
    })
    const successfulReviewRecord = record({
      _tag: "ImplementationReviewCompleted",
      review: successfulReview,
      version: 3
    }, 17)

    for (
      const [records, reason] of [
        [baseRecords(), "IntentMismatch"],
        [[...baseRecords(), contradictoryReviewIntent], "IntentMismatch"],
        [
          [...baseRecords().filter(({ event }) => event._tag !== "ImplementationEvidenceSealed"), reviewIntent],
          "EvidenceMismatch"
        ],
        [[...baseRecords(), reviewIntent], "EvidenceMismatch"],
        [[...baseRecords(), evidenceIntent, evidence, reviewIntent], "RetryNotExhausted"],
        [[...baseRecords(), evidenceIntent, evidence, reviewIntent, successfulReviewRecord], "RetryNotExhausted"]
      ] as const
    ) {
      const fixture = yield* testJournal(records)
      const failure = yield* makeJournaledImplementationDisposition(runId, fixture.journal)(reviewOperation)
        .pipe(Effect.flip)
      expect(failure instanceof ImplementationConvergenceHistoryContradiction ? failure.reason : undefined)
        .toBe(reason)
    }
    const invalidRoundTwoRequest = AuthorizedImplementationReviewRequest.make({
      ...reviewRequest,
      findingHistory: review.manifest.findingHistory,
      predecessorEvidenceReference: review.manifestReference,
      reviewerSessionId: ReviewerSessionId.make("technical-reviewer-round-two"),
      round: SemanticReviewRound.make(2)
    })
    const invalidRoundTwoDisposition = ImplementationConvergenceDisposition.cases.ReviewTechnicalRetryExhausted.make({
      failure: new ImplementationReviewInvocationFailure({
        detail: "round two lacks findings handback and rework",
        operationId: invalidRoundTwoRequest.operationId,
        reviewerSessionId: invalidRoundTwoRequest.reviewerSessionId
      }),
      request: invalidRoundTwoRequest,
      subject
    })
    const invalidRoundTwoOperation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition: invalidRoundTwoDisposition,
      operationId: OperationId.make("invalid-round-two-exhaustion")
    }, invalidRoundTwoRequest.operationId)
    const invalidRoundTwoIntent = record({
      _tag: "ImplementationReviewIntended",
      operation: makeImplementationReviewOperation(invalidRoundTwoRequest),
      version: 3
    }, 16)
    const invalidRoundTwoFixture = yield* testJournal([
      ...baseRecords(),
      evidenceIntent,
      evidence,
      invalidRoundTwoIntent
    ])
    expect(
      yield* makeJournaledImplementationDisposition(runId, invalidRoundTwoFixture.journal)(
        invalidRoundTwoOperation
      ).pipe(Effect.flip)
    ).toMatchObject({ reason: "EvidenceMismatch" })

    const handbackRequest = ReviewFindingsHandbackRequest.make({
      implementerInvocationId: execution.operationId,
      implementerSessionId: sessionId,
      operationId: OperationId.make("technical-handback"),
      plannedAttempt,
      review: SealedImplementationReview.make({
        ...review,
        manifest: {
          ...review.manifest,
          disposition: ImplementationReviewDisposition.cases.Findings.make({
            findings: [ReviewFinding.make({
              findingId: ReviewFindingId.make("technical-handback-finding"),
              text: "requires exact handback exhaustion lineage"
            })]
          }),
          findingHistory: [ReviewFinding.make({
            findingId: ReviewFindingId.make("technical-handback-finding"),
            text: "requires exact handback exhaustion lineage"
          })]
        }
      }),
      reviewOperationId: review.manifest.operationId
    })
    const handbackDisposition = ImplementationConvergenceDisposition.cases.HandbackTechnicalRetryExhausted.make({
      failure: new ReviewFindingsHandbackFailure({
        detail: "handback unavailable",
        operationId: handbackRequest.operationId
      }),
      request: handbackRequest,
      subject
    })
    const handbackBaseRecords = baseRecords().map((item) =>
      item.event._tag === "ImplementationReviewCompleted"
        ? record({ ...item.event, review: handbackRequest.review }, Number(item.position))
        : item
    )
    const handbackOperation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition: handbackDisposition,
      operationId: OperationId.make("technical-handback-disposition")
    }, handbackRequest.operationId)
    const handbackIntent = record({
      _tag: "ReviewFindingsHandbackIntended",
      operation: makeReviewFindingsHandbackOperation(handbackRequest),
      version: 3
    }, 14)
    const contradictoryHandbackIntent = record({
      _tag: "ReviewFindingsHandbackIntended",
      operation: makeReviewFindingsHandbackOperation({
        ...handbackRequest,
        implementerInvocationId: OperationId.make("same-handback-operation-different-invocation")
      }),
      version: 3
    }, 14)
    const successfulHandback = record({
      _tag: "ReviewFindingsHandbackCompleted",
      acknowledgement: ReviewFindingsHandbackAcknowledged.make({
        operationId: handbackRequest.operationId,
        reviewEvidenceReference: handbackRequest.review.manifestReference
      }),
      version: 3
    }, 15)
    for (
      const [records, reason] of [
        [handbackBaseRecords, "IntentMismatch"],
        [[...handbackBaseRecords, contradictoryHandbackIntent], "IntentMismatch"],
        [[...handbackBaseRecords.slice(0, 12), handbackIntent], "MissingReview"],
        [[...handbackBaseRecords, handbackIntent], "RetryNotExhausted"],
        [[...handbackBaseRecords, handbackIntent, successfulHandback], "RetryNotExhausted"]
      ] as const
    ) {
      const fixture = yield* testJournal(records)
      const failure = yield* makeJournaledImplementationDisposition(runId, fixture.journal)(handbackOperation)
        .pipe(Effect.flip)
      expect(failure instanceof ImplementationConvergenceHistoryContradiction ? failure.reason : undefined)
        .toBe(reason)
    }
    const malformedHandbackRequest = ReviewFindingsHandbackRequest.make({
      ...handbackRequest,
      implementerInvocationId: OperationId.make("malformed-handback-invocation")
    })
    const malformedHandbackDisposition = ImplementationConvergenceDisposition.cases.HandbackTechnicalRetryExhausted
      .make({
        failure: new ReviewFindingsHandbackFailure({
          detail: "malformed handback exhausted",
          operationId: malformedHandbackRequest.operationId
        }),
        request: malformedHandbackRequest,
        subject
      })
    const malformedHandbackOperation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition: malformedHandbackDisposition,
      operationId: OperationId.make("malformed-handback-exhaustion")
    }, malformedHandbackRequest.operationId)
    const malformedHandbackIntent = record({
      _tag: "ReviewFindingsHandbackIntended",
      operation: makeReviewFindingsHandbackOperation(malformedHandbackRequest),
      version: 3
    }, 14)
    const malformedHandbackFixture = yield* testJournal([...handbackBaseRecords, malformedHandbackIntent])
    expect(
      yield* makeJournaledImplementationDisposition(runId, malformedHandbackFixture.journal)(
        malformedHandbackOperation
      ).pipe(Effect.flip)
    ).toMatchObject({ reason: "EvidenceMismatch" })
  }))
