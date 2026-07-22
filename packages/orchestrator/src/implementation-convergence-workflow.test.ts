import { it } from "@effect/vitest"
import { Effect, Ref, Schema } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  FailedProcessExitCode,
  GitCommitSha,
  ImplementationReviewRoundLimit,
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
import { runLiveImplementationConvergence } from "./implementation-convergence-workflow.js"
import {
  AuthoritativeImplementationConvergenceDisposition,
  ImplementationConvergenceDisposition,
  ImplementationConvergenceSimulated
} from "./implementation-convergence.js"
import {
  EvidenceDigest,
  EvidenceReference,
  ImplementationEvidenceSealingSimulated,
  ImplementationReviewNotAuthorized,
  SealedImplementationEvidence
} from "./implementation-evidence.js"
import {
  AuthorizedImplementationReviewRequest,
  extendReviewFindingHistory,
  ImplementationReviewDisposition,
  ImplementationReviewInvocationFailure,
  ImplementationReviewSimulated,
  ReviewFinding,
  ReviewFindingsHandbackAcknowledged,
  ReviewFindingsHandbackFailure,
  ReviewFindingsHandbackRequest,
  SealedImplementationReview
} from "./implementation-review.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionOutcome } from "./task-execution.js"
import { TaskWorktreeExecutionModeContradiction } from "./task-worktree-reconciliation.js"
import { ActiveTaskClaim } from "./tracker-mutation.js"
import {
  makeImplementationDispositionOperation,
  makeImplementationReviewOperation,
  makeReviewFindingsHandbackOperation,
  WorkflowOperation
} from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"
import type { TraceItem, WorkflowInterpreterService } from "./workflow.js"

const runId = RunId.make("convergence-run")
const taskId = TaskId.make("convergence-task")
const sessionId = TaskWorkSessionId.make("convergence-session")
const task = {
  id: taskId,
  lifecycle: { _tag: "Open" as const },
  parentTaskId: null,
  prerequisiteIds: []
}
const plannedAttempt = {
  attemptId: AttemptId.make("convergence-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/dalph/convergence"),
  executor: TaskExecutorLocator.make("executor:convergence"),
  runId,
  session: TaskWorkSessionLocator.make("session:convergence"),
  taskId,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/convergence")
}
const subject = {
  claim: ActiveTaskClaim.make({
    operationId: OperationId.make("convergence-claim"),
    owner: ClaimOwner.make("convergence-owner"),
    taskId,
    token: ClaimToken.make("convergence-token")
  }),
  plannedAttempt,
  sessionEstablishmentOperationId: OperationId.make("convergence-session-establishment"),
  sessionId,
  worktreeOperationId: OperationId.make("convergence-worktree"),
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

const successfulOutcome = (operationId: string) =>
  TaskExecutionOutcome.cases.Succeeded.make({
    observationId: ProviderObservationId.make(`observation:${operationId}`),
    operationId: OperationId.make(operationId),
    output: "implementation complete",
    processId: WorkerProcessId.make(11),
    sessionId
  })

const makeHarness = Effect.fn("ConvergenceTest.makeHarness")(function*(
  dispositions: ReadonlyArray<
    typeof ImplementationReviewDisposition.Type | ImplementationReviewInvocationFailure
  >,
  reworkOutcomes: ReadonlyArray<TaskExecutionOutcome>,
  options: {
    readonly dispositionModeContradiction?: boolean
    readonly evidenceModeContradiction?: boolean
    readonly handbackFailure?: ReviewFindingsHandbackFailure
    readonly initialExecutionOutcome?: TaskExecutionOutcome
    readonly initialHandbackOperation?: ReturnType<typeof makeReviewFindingsHandbackOperation>
    readonly initialReview?: typeof SealedImplementationReview.Type
    readonly initialReviewOperation?: ReturnType<typeof makeImplementationReviewOperation>
    readonly reviewModeContradiction?: boolean
    readonly unexpectedHandbackFailure?: boolean
    readonly unexpectedReviewFailure?: boolean
  } = {}
) {
  const nextOperation = yield* Ref.make(0)
  const remainingDispositions = yield* Ref.make(dispositions)
  const remainingRework = yield* Ref.make(reworkOutcomes)
  const reviewRequests = yield* Ref.make<
    ReadonlyArray<Parameters<WorkflowInterpreterService["reviewImplementation"]>[0]>
  >([])
  const handbacks = yield* Ref.make(0)
  const executions = yield* Ref.make(0)
  const traces = yield* Ref.make<ReadonlyArray<TraceItem>>([])
  const terminal = yield* Ref.make<typeof ImplementationConvergenceDisposition.Type | undefined>(undefined)
  const unused = () => Effect.die("unused convergence interpreter operation")
  const interpreter: WorkflowInterpreterService = {
    acquireTaskClaim: unused,
    establishTaskWorkSession: unused,
    executeTaskWork: Effect.fn("ConvergenceTest.execute")(function*(operation) {
      yield* Ref.update(executions, (count) => count + 1)
      const outcome = yield* Ref.modify(remainingRework, (current) => [current[0], current.slice(1)] as const)
      return outcome === undefined
        ? yield* Effect.die("missing controlled rework outcome")
        : WorkflowOutcome.cases.TaskExecutionObserved.make({
          outcome: TaskExecutionOutcome.make({ ...outcome, operationId: operation.request.operationId })
        })
    }),
    handBackReviewFindings: Effect.fn("ConvergenceTest.handback")(function*(operation) {
      yield* Ref.update(handbacks, (count) => count + 1)
      if (options.unexpectedHandbackFailure === true) {
        return yield* new ImplementationReviewNotAuthorized({ detail: "unexpected handback authorization failure" })
      }
      if (options.handbackFailure !== undefined) return yield* options.handbackFailure
      return ReviewFindingsHandbackAcknowledged.make({
        operationId: operation.request.operationId,
        reviewEvidenceReference: operation.request.review.manifestReference
      })
    }),
    readTrackerGraph: unused,
    reconcileTaskWorktree: unused,
    recordImplementationDisposition: Effect.fn("ConvergenceTest.disposition")(function*(operation) {
      if (options.dispositionModeContradiction === true) {
        return ImplementationConvergenceSimulated.make({
          operationId: operation.request.operationId,
          plannedAttempt,
          roundLimit: ImplementationReviewRoundLimit.make(2)
        })
      }
      if (operation.request._tag !== "AuthorizedImplementationConvergenceDisposition") {
        return yield* Effect.die("live convergence requires an authorized disposition")
      }
      yield* Ref.set(terminal, operation.request.disposition)
      return AuthoritativeImplementationConvergenceDisposition.make({
        disposition: operation.request.disposition,
        operationId: operation.request.operationId
      })
    }),
    recordTaskAttemptPlan: unused,
    reviewImplementation: Effect.fn("ConvergenceTest.review")(function*(operation) {
      yield* Ref.update(reviewRequests, (current) => [...current, operation])
      if (operation.request._tag !== "AuthorizedImplementationReview") {
        return yield* Effect.die("live convergence requires an authorized review")
      }
      if (options.unexpectedReviewFailure === true) {
        return yield* new ImplementationReviewNotAuthorized({ detail: "unexpected review authorization failure" })
      }
      if (options.reviewModeContradiction === true) {
        return ImplementationReviewSimulated.make({
          operationId: operation.request.operationId,
          predecessorOperationId: operation.request.evidenceSealingOperationId,
          round: operation.request.round,
          roundLimit: operation.request.roundLimit
        })
      }
      const disposition = yield* Ref.modify(
        remainingDispositions,
        (current) => [current[0], current.slice(1)] as const
      )
      if (disposition === undefined) return yield* Effect.die("missing controlled review disposition")
      if (disposition instanceof ImplementationReviewInvocationFailure) return yield* disposition
      return SealedImplementationReview.make({
        manifest: {
          disposition,
          findingHistory: extendReviewFindingHistory(operation.request.findingHistory, disposition),
          implementationEvidenceReference: operation.request.implementationEvidence.manifestReference,
          implementerInvocationId: operation.request.implementerInvocationId,
          implementerSessionId: operation.request.implementerSessionId,
          operationId: operation.request.operationId,
          plannedAttempt: operation.request.plannedAttempt,
          predecessorEvidenceReference: operation.request.predecessorEvidenceReference,
          reviewerSessionId: operation.request.reviewerSessionId,
          round: operation.request.round,
          roundLimit: operation.request.roundLimit,
          stage: "ImplementationReview"
        },
        manifestReference: reference
      })
    }),
    sealImplementationEvidence: Effect.fn("ConvergenceTest.seal")(function*(operation) {
      if (operation.execution._tag !== "SuccessfulExecution") {
        return yield* Effect.die("live convergence seals successful execution only")
      }
      if (options.evidenceModeContradiction === true) {
        return ImplementationEvidenceSealingSimulated.make({
          operationId: operation.operationId,
          predecessorOperationId: operation.execution.outcome.operationId,
          stage: "Implementation"
        })
      }
      return SealedImplementationEvidence.make({
        manifest: {
          diff: reference,
          implementationOutput: reference,
          plannedBaseSha: plannedAttempt.baseSha,
          predecessorOperationId: operation.execution.outcome.operationId,
          runId,
          stage: "Implementation",
          taskId
        },
        manifestReference: reference
      })
    }),
    simulateTaskExecution: unused,
    simulateTaskWorkSession: unused
  }
  const result = yield* runLiveImplementationConvergence({
    allocator: {
      allocate: () =>
        Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
          Effect.map((value) => OperationId.make(`convergence-operation:${value}`))
        )
    },
    emit: (item) => Ref.update(traces, (current) => [...current, item]),
    initialExecutionOutcome: options.initialExecutionOutcome ?? successfulOutcome("initial-execution"),
    ...(options.initialHandbackOperation === undefined
      ? {}
      : { initialHandbackOperation: options.initialHandbackOperation }),
    ...(options.initialReview === undefined ? {} : { initialReview: options.initialReview }),
    ...(options.initialReviewOperation === undefined
      ? {}
      : { initialReviewOperation: options.initialReviewOperation }),
    interpreter,
    roundLimit: ImplementationReviewRoundLimit.make(2),
    subject,
    task
  })
  return { executions, handbacks, result, reviewRequests, terminal, traces }
})

const finding = (id: string) =>
  ReviewFinding.make({
    findingId: ReviewFindingId.make(id),
    text: `finding ${id}`
  })

const findingsReview = (operationId: string) =>
  SealedImplementationReview.make({
    manifest: {
      disposition: ImplementationReviewDisposition.cases.Findings.make({ findings: [finding("resume")] }),
      findingHistory: [finding("resume")],
      implementationEvidenceReference: reference,
      implementerInvocationId: OperationId.make("initial-execution"),
      implementerSessionId: sessionId,
      operationId: OperationId.make(operationId),
      plannedAttempt,
      predecessorEvidenceReference: reference,
      reviewerSessionId: ReviewerSessionId.make(`reviewer-session:${operationId}`),
      round: SemanticReviewRound.make(1),
      roundLimit: ImplementationReviewRoundLimit.make(2),
      stage: "ImplementationReview"
    },
    manifestReference: reference
  })

it.effect("stops at the captured semantic limit with complete history and fresh reviewers", () =>
  Effect.gen(function*() {
    const harness = yield* makeHarness([
      ImplementationReviewDisposition.cases.Findings.make({ findings: [finding("first")] }),
      ImplementationReviewDisposition.cases.Findings.make({ findings: [finding("second")] })
    ], [successfulOutcome("rework")])
    expect(harness.result.disposition._tag).toBe("ImplementationNonConvergent")
    expect(yield* Ref.get(harness.handbacks)).toBe(1)
    expect(yield* Ref.get(harness.executions)).toBe(1)
    const requests = (yield* Ref.get(harness.reviewRequests)).flatMap(({ request }) =>
      request._tag === "AuthorizedImplementationReview" ? [request] : []
    )
    expect(requests).toHaveLength(2)
    expect(requests[0]?.reviewerSessionId).not.toBe(requests[1]?.reviewerSessionId)
    expect(requests[1]?.findingHistory).toEqual([finding("first")])
    const disposition = yield* Ref.get(harness.terminal)
    expect(
      disposition?._tag === "ImplementationNonConvergent"
        ? disposition.review.manifest.findingHistory
        : []
    ).toEqual([finding("first"), finding("second")])
  }))

it.effect("does not retry an unchanged invocation after demonstrated resource emergency", () =>
  Effect.gen(function*() {
    const emergency = TaskExecutionOutcome.cases.ResourceEmergency.make({
      cause: "MemoryExhausted",
      detail: "provider proved its memory cgroup limit was reached",
      observationId: ProviderObservationId.make("emergency-observation"),
      operationId: OperationId.make("emergency-placeholder"),
      partialOutput: "retained partial implementation",
      processId: WorkerProcessId.make(12),
      sessionId,
      wipPreserved: true
    })
    const harness = yield* makeHarness([
      ImplementationReviewDisposition.cases.Findings.make({ findings: [finding("emergency-finding")] })
    ], [emergency])
    expect(harness.result.disposition._tag).toBe("ResourceEmergency")
    expect(yield* Ref.get(harness.handbacks)).toBe(1)
    expect(yield* Ref.get(harness.executions)).toBe(1)
    expect(yield* Ref.get(harness.reviewRequests)).toHaveLength(1)
    const disposition = yield* Ref.get(harness.terminal)
    expect(disposition?._tag === "ResourceEmergency" ? disposition.priorEvidence._tag : undefined)
      .toBe("PriorReviewEvidence")
  }))

it.effect("keeps exhausted reviewer transport separate from semantic non-convergence", () =>
  Effect.gen(function*() {
    const failure = new ImplementationReviewInvocationFailure({
      detail: "review provider remained unavailable through its captured schedule",
      operationId: OperationId.make("convergence-operation:1"),
      reviewerSessionId: ReviewerSessionId.make("reviewer-session:convergence-operation:1")
    })
    const harness = yield* makeHarness([failure], [])
    expect(harness.result.disposition._tag).toBe("ReviewTechnicalRetryExhausted")
    expect(yield* Ref.get(harness.handbacks)).toBe(0)
    expect(yield* Ref.get(harness.executions)).toBe(0)
    expect(yield* Ref.get(harness.reviewRequests)).toHaveLength(1)
  }))

it.effect("records exhausted findings handback separately from semantic non-convergence", () =>
  Effect.gen(function*() {
    const failure = new ReviewFindingsHandbackFailure({
      detail: "implementer transport remained unavailable through its captured schedule",
      operationId: OperationId.make("convergence-operation:2")
    })
    const harness = yield* makeHarness(
      [
        ImplementationReviewDisposition.cases.Findings.make({ findings: [finding("handback")] })
      ],
      [],
      { handbackFailure: failure }
    )
    expect(harness.result.disposition._tag).toBe("HandbackTechnicalRetryExhausted")
    expect(yield* Ref.get(harness.handbacks)).toBe(1)
    expect(yield* Ref.get(harness.executions)).toBe(0)
  }))

it.effect("retains failed and interrupted first executions without invoking review", () =>
  Effect.gen(function*() {
    const evidence = {
      observationId: ProviderObservationId.make("terminal-execution-observation"),
      operationId: OperationId.make("terminal-execution"),
      partialOutput: "retained work",
      processId: WorkerProcessId.make(13),
      sessionId,
      wipPreserved: true as const
    }
    const cases = [
      {
        expected: "ImplementationExecutionFailed",
        outcome: TaskExecutionOutcome.cases.Failed.make({
          ...evidence,
          exitCode: FailedProcessExitCode.make(1)
        })
      },
      {
        expected: "ImplementationExecutionInterrupted",
        outcome: TaskExecutionOutcome.cases.Interrupted.make(evidence)
      }
    ] as const
    for (const item of cases) {
      const harness = yield* makeHarness([], [], { initialExecutionOutcome: item.outcome })
      expect(harness.result.disposition._tag).toBe(item.expected)
      expect(yield* Ref.get(harness.reviewRequests)).toHaveLength(0)
    }
  }))

it.effect("resumes the exact journaled reviewer invocation after a coordinator crash", () =>
  Effect.gen(function*() {
    const operationId = OperationId.make("crashed-review-operation")
    const operation = makeImplementationReviewOperation(AuthorizedImplementationReviewRequest.make({
      evidenceSealingOperationId: OperationId.make("crashed-evidence-operation"),
      findingHistory: [],
      implementationEvidence: SealedImplementationEvidence.make({
        manifest: {
          diff: reference,
          implementationOutput: reference,
          plannedBaseSha: plannedAttempt.baseSha,
          predecessorOperationId: OperationId.make("initial-execution"),
          runId,
          stage: "Implementation",
          taskId
        },
        manifestReference: reference
      }),
      implementerInvocationId: OperationId.make("initial-execution"),
      implementerSessionId: sessionId,
      operationId,
      plannedAttempt,
      predecessorEvidenceReference: reference,
      reviewerSessionId: ReviewerSessionId.make("crashed-reviewer-session"),
      round: SemanticReviewRound.make(1),
      roundLimit: ImplementationReviewRoundLimit.make(2)
    }))
    const harness = yield* makeHarness(
      [
        ImplementationReviewDisposition.cases.Accepted.make({})
      ],
      [],
      { initialReviewOperation: operation }
    )
    const requests = yield* Ref.get(harness.reviewRequests)
    expect(requests.map((request) => request.request.operationId)).toEqual([operationId])
    expect((yield* Ref.get(harness.traces)).some((trace) =>
      trace._tag === "OperationSelected"
      && trace.operation._tag === "ReviewImplementation"
      && trace.operation.request.operationId === operationId
    )).toBe(false)
    expect(harness.result.disposition._tag).toBe("Accepted")
  }))

it.effect("resumes the exact journaled findings handback before same-session rework", () =>
  Effect.gen(function*() {
    const review = findingsReview("crashed-handback-review")
    const handbackOperationId = OperationId.make("crashed-handback-operation")
    const operation = makeReviewFindingsHandbackOperation(ReviewFindingsHandbackRequest.make({
      implementerInvocationId: review.manifest.implementerInvocationId,
      implementerSessionId: sessionId,
      operationId: handbackOperationId,
      plannedAttempt,
      review,
      reviewOperationId: review.manifest.operationId
    }))
    const harness = yield* makeHarness(
      [
        ImplementationReviewDisposition.cases.Accepted.make({})
      ],
      [successfulOutcome("resume-rework")],
      {
        initialHandbackOperation: operation,
        initialReview: review
      }
    )
    const handedBack = (yield* Ref.get(harness.traces)).find((trace) => trace._tag === "ReviewFindingsHandedBack")
    expect(
      handedBack?._tag === "ReviewFindingsHandedBack"
        ? handedBack.operation.request.operationId
        : undefined
    ).toBe(handbackOperationId)
    expect(yield* Ref.get(harness.executions)).toBe(1)
    expect(harness.result.disposition._tag).toBe("Accepted")
  }))

it.effect("rejects terminal dispositions whose retained evidence contradicts their subject", () =>
  Effect.gen(function*() {
    const acceptedHarness = yield* makeHarness([
      ImplementationReviewDisposition.cases.Accepted.make({})
    ], [])
    const accepted = acceptedHarness.result.disposition
    if (accepted._tag !== "Accepted") return yield* Effect.die("expected accepted fixture")
    const acceptedRequest = (yield* Ref.get(acceptedHarness.reviewRequests))[0]?.request
    if (acceptedRequest?._tag !== "AuthorizedImplementationReview") {
      return yield* Effect.die("expected authorized review request")
    }
    expect(() =>
      Schema.decodeUnknownSync(AuthorizedImplementationReviewRequest)({
        ...acceptedRequest,
        round: 3,
        roundLimit: 2
      })
    ).toThrow()
    const acceptedOperation = makeImplementationDispositionOperation({
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition: accepted,
      operationId: OperationId.make("invalid-predecessor-disposition")
    }, accepted.review.manifest.operationId)
    expect(() =>
      Schema.decodeUnknownSync(WorkflowOperation.cases.RecordImplementationDisposition)({
        ...acceptedOperation,
        predecessorOperationIds: []
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ImplementationConvergenceDisposition)({
        ...accepted,
        review: {
          ...accepted.review,
          manifest: {
            ...accepted.review.manifest,
            disposition: { _tag: "Findings", findings: [finding("invalid-accepted")] }
          }
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ImplementationConvergenceDisposition)({
        ...accepted,
        subject: {
          ...accepted.subject,
          claim: { ...accepted.subject.claim, taskId: "foreign-task" }
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ImplementationConvergenceDisposition)({
        ...accepted,
        review: {
          ...accepted.review,
          manifest: { ...accepted.review.manifest, implementerSessionId: "foreign-session" }
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ImplementationConvergenceDisposition)({
        ...accepted,
        review: {
          ...accepted.review,
          manifest: {
            ...accepted.review.manifest,
            plannedAttempt: { ...accepted.review.manifest.plannedAttempt, attemptId: "foreign-attempt" }
          }
        }
      })
    ).toThrow()

    const nonConvergent = (yield* makeHarness([
      ImplementationReviewDisposition.cases.Findings.make({ findings: [finding("limit-one")] }),
      ImplementationReviewDisposition.cases.Findings.make({ findings: [finding("limit-two")] })
    ], [successfulOutcome("invalid-nonconvergent-rework")])).result.disposition
    if (nonConvergent._tag !== "ImplementationNonConvergent") {
      return yield* Effect.die("expected non-convergent fixture")
    }
    expect(() =>
      Schema.decodeUnknownSync(ImplementationConvergenceDisposition)({
        ...nonConvergent,
        review: {
          ...nonConvergent.review,
          manifest: { ...nonConvergent.review.manifest, round: 1 }
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ImplementationConvergenceDisposition)({
        ...nonConvergent,
        review: {
          ...nonConvergent.review,
          manifest: { ...nonConvergent.review.manifest, implementerSessionId: "foreign-session" }
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ImplementationConvergenceDisposition)({
        ...nonConvergent,
        review: {
          ...nonConvergent.review,
          manifest: {
            ...nonConvergent.review.manifest,
            plannedAttempt: { ...nonConvergent.review.manifest.plannedAttempt, attemptId: "foreign-attempt" }
          }
        }
      })
    ).toThrow()

    const reviewExhausted = (yield* makeHarness([
      new ImplementationReviewInvocationFailure({
        detail: "review unavailable",
        operationId: OperationId.make("convergence-operation:1"),
        reviewerSessionId: ReviewerSessionId.make("reviewer-session:convergence-operation:1")
      })
    ], [])).result.disposition
    if (reviewExhausted._tag !== "ReviewTechnicalRetryExhausted") {
      return yield* Effect.die("expected review exhaustion fixture")
    }
    for (
      const invalid of [
        { ...reviewExhausted, failure: { ...reviewExhausted.failure, operationId: "foreign-operation" } },
        { ...reviewExhausted, failure: { ...reviewExhausted.failure, reviewerSessionId: "foreign-reviewer" } },
        { ...reviewExhausted, request: { ...reviewExhausted.request, implementerSessionId: "foreign-session" } },
        {
          ...reviewExhausted,
          request: {
            ...reviewExhausted.request,
            plannedAttempt: { ...reviewExhausted.request.plannedAttempt, attemptId: "foreign-attempt" }
          }
        }
      ]
    ) expect(() => Schema.decodeUnknownSync(ImplementationConvergenceDisposition)(invalid)).toThrow()

    const handbackExhausted = (yield* makeHarness(
      [
        ImplementationReviewDisposition.cases.Findings.make({ findings: [finding("handback-invalid")] })
      ],
      [],
      {
        handbackFailure: new ReviewFindingsHandbackFailure({
          detail: "handback unavailable",
          operationId: OperationId.make("convergence-operation:2")
        })
      }
    )).result.disposition
    if (handbackExhausted._tag !== "HandbackTechnicalRetryExhausted") {
      return yield* Effect.die("expected handback exhaustion fixture")
    }
    for (
      const invalid of [
        { ...handbackExhausted, failure: { ...handbackExhausted.failure, operationId: "foreign-operation" } },
        { ...handbackExhausted, request: { ...handbackExhausted.request, implementerSessionId: "foreign-session" } },
        {
          ...handbackExhausted,
          request: {
            ...handbackExhausted.request,
            plannedAttempt: { ...handbackExhausted.request.plannedAttempt, attemptId: "foreign-attempt" }
          }
        }
      ]
    ) expect(() => Schema.decodeUnknownSync(ImplementationConvergenceDisposition)(invalid)).toThrow()

    const failed = TaskExecutionOutcome.cases.Failed.make({
      exitCode: FailedProcessExitCode.make(3),
      observationId: ProviderObservationId.make("invalid-terminal-observation"),
      operationId: OperationId.make("invalid-terminal-execution"),
      partialOutput: "retained",
      processId: WorkerProcessId.make(14),
      sessionId,
      wipPreserved: true
    })
    const executionTerminal = (yield* makeHarness([], [], { initialExecutionOutcome: failed })).result.disposition
    expect(() =>
      Schema.decodeUnknownSync(ImplementationConvergenceDisposition)({
        ...executionTerminal,
        outcome: { ...failed, sessionId: "foreign-session" }
      })
    ).toThrow()
  }))

it.effect("fails closed when a live convergence interpreter returns simulated authority", () =>
  Effect.gen(function*() {
    for (
      const options of [
        { dispositionModeContradiction: true },
        { evidenceModeContradiction: true },
        { reviewModeContradiction: true }
      ] as const
    ) {
      const failure = yield* makeHarness(
        [
          ImplementationReviewDisposition.cases.Accepted.make({})
        ],
        [],
        options
      ).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(TaskWorktreeExecutionModeContradiction)
    }
    const authorized = makeImplementationReviewOperation(AuthorizedImplementationReviewRequest.make({
      evidenceSealingOperationId: OperationId.make("simulated-review-evidence"),
      findingHistory: [],
      implementationEvidence: SealedImplementationEvidence.make({
        manifest: {
          diff: reference,
          implementationOutput: reference,
          plannedBaseSha: plannedAttempt.baseSha,
          predecessorOperationId: OperationId.make("initial-execution"),
          runId,
          stage: "Implementation",
          taskId
        },
        manifestReference: reference
      }),
      implementerInvocationId: OperationId.make("initial-execution"),
      implementerSessionId: sessionId,
      operationId: OperationId.make("simulated-review-operation"),
      plannedAttempt,
      predecessorEvidenceReference: reference,
      reviewerSessionId: ReviewerSessionId.make("simulated-reviewer"),
      round: SemanticReviewRound.make(1),
      roundLimit: ImplementationReviewRoundLimit.make(2)
    }))
    const simulatedOperation = WorkflowOperation.cases.ReviewImplementation.make({
      predecessorOperationIds: authorized.predecessorOperationIds,
      request: {
        _tag: "SimulatedImplementationReview",
        evidenceSealingOperationId: authorized.request.evidenceSealingOperationId,
        operationId: authorized.request.operationId,
        round: authorized.request.round,
        roundLimit: authorized.request.roundLimit
      }
    })
    const failure = yield* makeHarness([], [], { initialReviewOperation: simulatedOperation }).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskWorktreeExecutionModeContradiction)
  }))

it.effect("preserves non-transport review and handback failures", () =>
  Effect.gen(function*() {
    const reviewFailure = yield* makeHarness([], [], { unexpectedReviewFailure: true }).pipe(Effect.flip)
    expect(reviewFailure).toBeInstanceOf(ImplementationReviewNotAuthorized)

    const handbackFailure = yield* makeHarness(
      [
        ImplementationReviewDisposition.cases.Findings.make({ findings: [finding("authorization")] })
      ],
      [],
      { unexpectedHandbackFailure: true }
    ).pipe(Effect.flip)
    expect(handbackFailure).toBeInstanceOf(ImplementationReviewNotAuthorized)
  }))
