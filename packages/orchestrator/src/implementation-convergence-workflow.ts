import { Effect } from "effect"
import {
  type ImplementationReviewRoundLimit,
  type OperationId,
  ReviewerSessionId,
  SemanticReviewRound,
  type Task
} from "./domain.js"
import { ImplementationConvergenceDispositionRecordedTrace } from "./implementation-convergence-trace.js"
import {
  ImplementationConvergenceDisposition,
  type ImplementationConvergenceSubject,
  PriorImplementationReviewEvidence
} from "./implementation-convergence.js"
import type { SealedImplementationEvidence } from "./implementation-evidence.js"
import {
  ImplementationEvidenceSealingSimulatedTrace,
  ImplementationReviewCompletedTrace,
  ReviewFindingsHandedBackTrace,
  SealedImplementationEvidenceTrace
} from "./implementation-review-trace.js"
import {
  AuthorizedImplementationReviewRequest,
  ImplementationReviewInvocationFailure,
  ReviewFindingsHandbackFailure,
  ReviewFindingsHandbackRequest,
  type SealedImplementationReview
} from "./implementation-review.js"
import { TaskExecutionAdmitted, TaskExecutionOutcomeObserved } from "./task-execution-trace.js"
import { type TaskExecutionOutcome, TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import type { OperationIdAllocatorService } from "./task-work-planning.js"
import { TaskWorktreeExecutionModeContradiction } from "./task-worktree-reconciliation.js"
import type { TraceOutputError } from "./trace-output.js"
import { OperationSelected } from "./tracker-workflow-trace.js"
import {
  makeImplementationDispositionOperation,
  makeImplementationEvidenceSealingOperation,
  makeImplementationReviewOperation,
  makeReviewFindingsHandbackOperation,
  makeTaskExecutionOperation
} from "./workflow-operation.js"
import type { TraceItem, WorkflowInterpreterService } from "./workflow.js"

// eslint-disable-next-line functional/no-mixed-types -- One workflow invocation carries services and immutable resume state.
interface LiveImplementationConvergenceOptions {
  readonly allocator: OperationIdAllocatorService
  readonly emit: (item: TraceItem) => Effect.Effect<void, TraceOutputError>
  readonly initialExecutionOutcome: TaskExecutionOutcome
  readonly interpreter: WorkflowInterpreterService
  readonly roundLimit: ImplementationReviewRoundLimit
  readonly subject: ImplementationConvergenceSubject
  readonly task: Task
  readonly initialHandbackOperation?: ReturnType<typeof makeReviewFindingsHandbackOperation>
  readonly initialPreviousReview?: SealedImplementationReview
  readonly initialReview?: SealedImplementationReview
  readonly initialReviewOperation?: ReturnType<typeof makeImplementationReviewOperation>
  readonly initialRound?: number
  readonly initialSealedEvidence?: {
    readonly operationId: OperationId
    readonly sealed: SealedImplementationEvidence
  }
}

const priorEvidence = (
  review: SealedImplementationReview | undefined
): PriorImplementationReviewEvidence =>
  review === undefined
    ? PriorImplementationReviewEvidence.cases.NoPriorReviewEvidence.make({})
    : PriorImplementationReviewEvidence.cases.PriorReviewEvidence.make({ review })

/** Runs bounded semantic review and same-session rework until one exact terminal disposition is durable. */
export const runLiveImplementationConvergence = Effect.fn(
  "Workflow.runLiveImplementationConvergence"
)(function*(options: LiveImplementationConvergenceOptions) {
  let executionOutcome = options.initialExecutionOutcome
  let previousReview = options.initialPreviousReview
  let pendingReview = options.initialReview
  let pendingReviewOperation = options.initialReviewOperation
  let pendingHandbackOperation = options.initialHandbackOperation
  let pendingSealedEvidence = options.initialSealedEvidence
  let round = options.initialRound ?? options.initialReview?.manifest.round ?? 1

  const recordDisposition = Effect.fn("Workflow.recordImplementationDisposition")(function*(
    disposition: ImplementationConvergenceDisposition,
    predecessorOperationId: OperationId
  ) {
    const operationId = yield* options.allocator.allocate()
    const operation = makeImplementationDispositionOperation(
      {
        _tag: "AuthorizedImplementationConvergenceDisposition",
        disposition,
        operationId
      },
      predecessorOperationId
    )
    yield* options.emit(OperationSelected.make({ operation }))
    const result = yield* options.interpreter.recordImplementationDisposition(operation)
    if (result._tag !== "AuthoritativeImplementationConvergenceDisposition") {
      return yield* new TaskWorktreeExecutionModeContradiction({ operationId })
    }
    yield* options.emit(ImplementationConvergenceDispositionRecordedTrace.make({ operation, result }))
    return result
  })

  for (;;) {
    let review = pendingReview
    pendingReview = undefined
    if (review !== undefined) pendingSealedEvidence = undefined
    if (review === undefined) {
      if (executionOutcome._tag !== "Succeeded") {
        const retainedEvidence = priorEvidence(previousReview)
        const disposition = executionOutcome._tag === "ResourceEmergency"
          ? ImplementationConvergenceDisposition.cases.ResourceEmergency.make({
            outcome: executionOutcome,
            priorEvidence: retainedEvidence,
            subject: options.subject
          })
          : executionOutcome._tag === "Failed"
          ? ImplementationConvergenceDisposition.cases.ImplementationExecutionFailed.make({
            outcome: executionOutcome,
            priorEvidence: retainedEvidence,
            subject: options.subject
          })
          : ImplementationConvergenceDisposition.cases.ImplementationExecutionInterrupted.make({
            outcome: executionOutcome,
            priorEvidence: retainedEvidence,
            subject: options.subject
          })
        return yield* recordDisposition(disposition, executionOutcome.operationId)
      }
      const successfulExecution = executionOutcome
      let availableEvidence = pendingSealedEvidence
      pendingSealedEvidence = undefined
      const recoveringReviewOperation = pendingReviewOperation !== undefined
      let actualReviewOperation: ReturnType<typeof makeImplementationReviewOperation>
      if (pendingReviewOperation === undefined) {
        if (availableEvidence === undefined) {
          const evidenceOperation = makeImplementationEvidenceSealingOperation({
            operationId: yield* options.allocator.allocate(),
            execution: { _tag: "SuccessfulExecution", outcome: successfulExecution },
            plannedAttempt: options.subject.plannedAttempt
          })
          yield* options.emit(OperationSelected.make({ operation: evidenceOperation }))
          const sealingResult = yield* options.interpreter.sealImplementationEvidence(evidenceOperation)
          if (sealingResult._tag !== "SealedImplementationEvidence") {
            yield* options.emit(ImplementationEvidenceSealingSimulatedTrace.make({
              operation: evidenceOperation,
              simulation: sealingResult
            }))
            return yield* new TaskWorktreeExecutionModeContradiction({ operationId: evidenceOperation.operationId })
          }
          availableEvidence = { operationId: evidenceOperation.operationId, sealed: sealingResult }
          yield* options.emit(
            SealedImplementationEvidenceTrace.make({ operation: evidenceOperation, sealed: sealingResult })
          )
        }
        const reviewOperationId = yield* options.allocator.allocate()
        actualReviewOperation = makeImplementationReviewOperation(AuthorizedImplementationReviewRequest.make({
          evidenceSealingOperationId: availableEvidence.operationId,
          findingHistory: previousReview?.manifest.findingHistory ?? [],
          implementationEvidence: availableEvidence.sealed,
          implementerInvocationId: successfulExecution.operationId,
          implementerSessionId: successfulExecution.sessionId,
          operationId: reviewOperationId,
          plannedAttempt: options.subject.plannedAttempt,
          predecessorEvidenceReference: previousReview?.manifestReference ?? availableEvidence.sealed.manifestReference,
          reviewerSessionId: ReviewerSessionId.make(`reviewer-session:${reviewOperationId}`),
          round: SemanticReviewRound.make(round),
          roundLimit: options.roundLimit
        }))
      } else {
        actualReviewOperation = pendingReviewOperation
      }
      pendingReviewOperation = undefined
      if (actualReviewOperation.request._tag !== "AuthorizedImplementationReview") {
        return yield* new TaskWorktreeExecutionModeContradiction({
          operationId: actualReviewOperation.request.operationId
        })
      }
      const reviewRequest = actualReviewOperation.request
      const reviewOperationId = reviewRequest.operationId
      if (!recoveringReviewOperation) {
        yield* options.emit(OperationSelected.make({ operation: actualReviewOperation }))
      }
      const reviewResult = yield* Effect.result(options.interpreter.reviewImplementation(actualReviewOperation))
      if (reviewResult._tag === "Failure") {
        if (!(reviewResult.failure instanceof ImplementationReviewInvocationFailure)) {
          return yield* Effect.fail(reviewResult.failure)
        }
        return yield* recordDisposition(
          ImplementationConvergenceDisposition.cases.ReviewTechnicalRetryExhausted.make({
            failure: reviewResult.failure,
            request: reviewRequest,
            subject: options.subject
          }),
          reviewRequest.operationId
        )
      }
      const returnedReview = reviewResult.success
      if (returnedReview._tag !== "SealedImplementationReview") {
        return yield* new TaskWorktreeExecutionModeContradiction({ operationId: reviewOperationId })
      }
      review = returnedReview
      yield* options.emit(
        ImplementationReviewCompletedTrace.make({ operation: actualReviewOperation, review: returnedReview })
      )
    }
    const completedReview = review
    if (completedReview.manifest.disposition._tag === "Accepted") {
      return yield* recordDisposition(
        ImplementationConvergenceDisposition.cases.Accepted.make({ review: completedReview, subject: options.subject }),
        completedReview.manifest.operationId
      )
    }
    if (round === Number(options.roundLimit)) {
      return yield* recordDisposition(
        ImplementationConvergenceDisposition.cases.ImplementationNonConvergent.make({
          review: completedReview,
          subject: options.subject
        }),
        completedReview.manifest.operationId
      )
    }

    let handbackOperationId: OperationId
    {
      const recoveringHandbackOperation = pendingHandbackOperation !== undefined
      const handbackOperation = pendingHandbackOperation ?? makeReviewFindingsHandbackOperation(
        ReviewFindingsHandbackRequest.make({
          implementerInvocationId: executionOutcome.operationId,
          implementerSessionId: executionOutcome.sessionId,
          operationId: yield* options.allocator.allocate(),
          plannedAttempt: options.subject.plannedAttempt,
          review: completedReview,
          reviewOperationId: completedReview.manifest.operationId
        })
      )
      pendingHandbackOperation = undefined
      const handbackRequest = handbackOperation.request
      handbackOperationId = handbackRequest.operationId
      if (!recoveringHandbackOperation) {
        yield* options.emit(OperationSelected.make({ operation: handbackOperation }))
      }
      const handbackResult = yield* Effect.result(options.interpreter.handBackReviewFindings(handbackOperation))
      if (handbackResult._tag === "Failure") {
        if (!(handbackResult.failure instanceof ReviewFindingsHandbackFailure)) {
          return yield* Effect.fail(handbackResult.failure)
        }
        return yield* recordDisposition(
          ImplementationConvergenceDisposition.cases.HandbackTechnicalRetryExhausted.make({
            failure: handbackResult.failure,
            request: handbackRequest,
            subject: options.subject
          }),
          handbackRequest.operationId
        )
      }
      yield* options.emit(ReviewFindingsHandedBackTrace.make({
        acknowledgement: handbackResult.success,
        operation: handbackOperation
      }))
    }

    const executionOperation = makeTaskExecutionOperation({
      predecessorOperationIds: [handbackOperationId, options.subject.sessionEstablishmentOperationId],
      request: TaskExecutionRequest.make({
        operationId: yield* options.allocator.allocate(),
        plannedAttempt: options.subject.plannedAttempt,
        session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
          sessionId: options.subject.sessionId
        }),
        task: options.task
      })
    })
    yield* options.emit(OperationSelected.make({ operation: executionOperation }))
    yield* options.emit(TaskExecutionAdmitted.make({ operation: executionOperation }))
    const execution = yield* options.interpreter.executeTaskWork(executionOperation)
    yield* options.emit(TaskExecutionOutcomeObserved.make({ operation: executionOperation, outcome: execution }))
    previousReview = completedReview
    executionOutcome = execution.outcome
    round += 1
  }
})
