import { Effect } from "effect"
import { ReviewerSessionId, SemanticReviewRound } from "./domain.js"
import {
  continuedImplementationTransition,
  type FreshImplementationConvergenceOptions,
  type FreshImplementationConvergenceStage,
  freshImplementationTransition,
  noTaskWorkCapacityUse as noCapacity,
  oneTaskWorkCapacityPosition as usesCapacity,
  priorImplementationReviewEvidence
} from "./implementation-convergence-stage.js"
import { ImplementationConvergenceDisposition } from "./implementation-convergence.js"
import { makeImplementationDispositionStage } from "./implementation-disposition-stage.js"
import {
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
import { TaskWorktreeExecutionModeContradiction } from "./task-worktree-reconciliation.js"
import { OperationSelected } from "./tracker-workflow-trace.js"
import {
  makeImplementationEvidenceSealingOperation,
  makeImplementationReviewOperation,
  makeReviewFindingsHandbackOperation,
  makeTaskExecutionOperation
} from "./workflow-operation.js"

export const makeFreshImplementationConvergenceStage = Effect.fn(
  "Workflow.makeFreshImplementationConvergenceStage"
)(function*(
  options: FreshImplementationConvergenceOptions,
  initialExecutionOutcome: TaskExecutionOutcome
) {
  const makeReworkExecutionStage = Effect.fn(
    "Workflow.makeFreshReworkExecutionStage"
  )(function*(
    review: SealedImplementationReview,
    round: SemanticReviewRound,
    predecessorOperationId: Parameters<
      typeof makeTaskExecutionOperation
    >[0]["predecessorOperationIds"][number]
  ): Effect.fn.Return<FreshImplementationConvergenceStage> {
    const operation = makeTaskExecutionOperation({
      predecessorOperationIds: [
        predecessorOperationId,
        options.subject.sessionEstablishmentOperationId
      ],
      request: TaskExecutionRequest.make({
        operationId: yield* options.allocator.allocate(),
        plannedAttempt: options.subject.plannedAttempt,
        session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
          sessionId: options.subject.sessionId
        }),
        task: options.task
      })
    })
    return {
      transition: freshImplementationTransition(
        operation.request.operationId,
        options.task,
        usesCapacity
      ),
      run: (recordActivationIntent) =>
        Effect.gen(function*() {
          yield* options.emit(OperationSelected.make({ operation }))
          yield* options.emit(TaskExecutionAdmitted.make({ operation }))
          const observed = yield* options.interpreter.executeTaskWork(
            operation,
            recordActivationIntent(operation.request.operationId)
          )
          yield* options.emit(TaskExecutionOutcomeObserved.make({
            operation,
            outcome: observed
          }))
          return yield* stageForOutcome(
            observed.outcome,
            review,
            SemanticReviewRound.make(Number(round) + 1)
          )
        })
    }
  })

  const stageAfterReview = Effect.fn("Workflow.stageAfterFreshReview")(
    function*(
      executionOutcome: Extract<TaskExecutionOutcome, { readonly _tag: "Succeeded" }>,
      review: SealedImplementationReview,
      round: SemanticReviewRound,
      recoveredHandback:
        | ReturnType<
          typeof makeReviewFindingsHandbackOperation
        >
        | undefined
    ): Effect.fn.Return<FreshImplementationConvergenceStage> {
      if (review.manifest.disposition._tag === "Accepted") {
        return yield* makeImplementationDispositionStage(
          options,
          ImplementationConvergenceDisposition.cases.Accepted.make({
            review,
            subject: options.subject
          }),
          review.manifest.operationId
        )
      }
      if (Number(round) === Number(options.roundLimit)) {
        return yield* makeImplementationDispositionStage(
          options,
          ImplementationConvergenceDisposition.cases.ImplementationNonConvergent.make({
            review,
            subject: options.subject
          }),
          review.manifest.operationId
        )
      }
      const operation = recoveredHandback ?? makeReviewFindingsHandbackOperation(
        ReviewFindingsHandbackRequest.make({
          implementerInvocationId: executionOutcome.operationId,
          implementerSessionId: executionOutcome.sessionId,
          operationId: yield* options.allocator.allocate(),
          plannedAttempt: options.subject.plannedAttempt,
          review,
          reviewOperationId: review.manifest.operationId
        })
      )
      return {
        transition: recoveredHandback === undefined
          ? freshImplementationTransition(
            operation.request.operationId,
            options.task,
            usesCapacity
          )
          : continuedImplementationTransition(
            operation.request.operationId,
            options.task,
            usesCapacity
          ),
        run: (recordActivationIntent) =>
          Effect.gen(function*() {
            if (recoveredHandback === undefined) {
              yield* options.emit(OperationSelected.make({ operation }))
            }
            const handback = yield* Effect.result(
              options.interpreter.handBackReviewFindings(
                operation,
                recordActivationIntent(operation.request.operationId)
              )
            )
            if (handback._tag === "Failure") {
              if (!(handback.failure instanceof ReviewFindingsHandbackFailure)) {
                return yield* Effect.fail(handback.failure)
              }
              return yield* makeImplementationDispositionStage(
                options,
                ImplementationConvergenceDisposition.cases.HandbackTechnicalRetryExhausted.make({
                  failure: handback.failure,
                  request: operation.request,
                  subject: options.subject
                }),
                operation.request.operationId
              )
            }
            yield* options.emit(ReviewFindingsHandedBackTrace.make({
              acknowledgement: handback.success,
              operation
            }))
            return yield* makeReworkExecutionStage(
              review,
              round,
              operation.request.operationId
            )
          })
      }
    }
  )

  const makeReviewStage = Effect.fn("Workflow.makeFreshReviewStage")(
    function*(
      executionOutcome: Extract<TaskExecutionOutcome, { readonly _tag: "Succeeded" }>,
      evidence: Parameters<
        typeof AuthorizedImplementationReviewRequest.make
      >[0]["implementationEvidence"],
      evidenceOperationId: Parameters<
        typeof AuthorizedImplementationReviewRequest.make
      >[0]["evidenceSealingOperationId"],
      previousReview: SealedImplementationReview | undefined,
      round: SemanticReviewRound,
      recoveredOperation:
        | (
          & ReturnType<
            typeof makeImplementationReviewOperation
          >
          & {
            readonly request: typeof AuthorizedImplementationReviewRequest.Type
          }
        )
        | undefined
    ): Effect.fn.Return<
      FreshImplementationConvergenceStage,
      TaskWorktreeExecutionModeContradiction
    > {
      const recoveredRequest = recoveredOperation?.request
      const operationId = recoveredRequest?.operationId
        ?? (yield* options.allocator.allocate())
      const request: typeof AuthorizedImplementationReviewRequest.Type = recoveredRequest
        ?? AuthorizedImplementationReviewRequest.make({
          evidenceSealingOperationId: evidenceOperationId,
          findingHistory: previousReview?.manifest.findingHistory ?? [],
          implementationEvidence: evidence,
          implementerInvocationId: executionOutcome.operationId,
          implementerSessionId: executionOutcome.sessionId,
          operationId,
          plannedAttempt: options.subject.plannedAttempt,
          predecessorEvidenceReference: previousReview?.manifestReference
            ?? evidence.manifestReference,
          reviewerSessionId: ReviewerSessionId.make(
            `reviewer-session:${operationId}`
          ),
          round,
          roundLimit: options.roundLimit
        })
      const operation = recoveredOperation
        ?? makeImplementationReviewOperation(request)
      return {
        transition: recoveredOperation === undefined
          ? freshImplementationTransition(
            operationId,
            options.task,
            usesCapacity
          )
          : continuedImplementationTransition(
            operationId,
            options.task,
            usesCapacity
          ),
        run: (recordActivationIntent) =>
          Effect.gen(function*() {
            if (recoveredOperation === undefined) {
              yield* options.emit(OperationSelected.make({ operation }))
            }
            const reviewed = yield* Effect.result(
              options.interpreter.reviewImplementation(
                operation,
                recordActivationIntent(operation.request.operationId)
              )
            )
            if (reviewed._tag === "Failure") {
              if (
                !(reviewed.failure instanceof ImplementationReviewInvocationFailure)
              ) {
                return yield* Effect.fail(reviewed.failure)
              }
              return yield* makeImplementationDispositionStage(
                options,
                ImplementationConvergenceDisposition.cases.ReviewTechnicalRetryExhausted.make({
                  failure: reviewed.failure,
                  request,
                  subject: options.subject
                }),
                operation.request.operationId
              )
            }
            if (reviewed.success._tag !== "SealedImplementationReview") {
              return yield* new TaskWorktreeExecutionModeContradiction({
                operationId
              })
            }
            yield* options.emit(ImplementationReviewCompletedTrace.make({
              operation,
              review: reviewed.success
            }))
            return yield* stageAfterReview(
              executionOutcome,
              reviewed.success,
              round,
              undefined
            )
          })
      }
    }
  )

  const stageForOutcome = Effect.fn("Workflow.stageForFreshExecutionOutcome")(
    function*(
      executionOutcome: TaskExecutionOutcome,
      previousReview: SealedImplementationReview | undefined,
      round: SemanticReviewRound
    ): Effect.fn.Return<FreshImplementationConvergenceStage> {
      if (executionOutcome._tag !== "Succeeded") {
        const evidence = priorImplementationReviewEvidence(previousReview)
        const disposition = executionOutcome._tag === "ResourceEmergency"
          ? ImplementationConvergenceDisposition.cases.ResourceEmergency.make({
            outcome: executionOutcome,
            priorEvidence: evidence,
            subject: options.subject
          })
          : executionOutcome._tag === "Failed"
          ? ImplementationConvergenceDisposition.cases.ImplementationExecutionFailed.make({
            outcome: executionOutcome,
            priorEvidence: evidence,
            subject: options.subject
          })
          : ImplementationConvergenceDisposition.cases.ImplementationExecutionInterrupted.make({
            outcome: executionOutcome,
            priorEvidence: evidence,
            subject: options.subject
          })
        return yield* makeImplementationDispositionStage(
          options,
          disposition,
          executionOutcome.operationId
        )
      }
      const operation = makeImplementationEvidenceSealingOperation({
        operationId: yield* options.allocator.allocate(),
        execution: {
          _tag: "SuccessfulExecution",
          outcome: executionOutcome
        },
        plannedAttempt: options.subject.plannedAttempt
      })
      return {
        transition: freshImplementationTransition(
          operation.operationId,
          options.task,
          noCapacity
        ),
        run: () =>
          Effect.gen(function*() {
            yield* options.emit(OperationSelected.make({ operation }))
            const sealed = yield* options.interpreter.sealImplementationEvidence(
              operation
            )
            if (sealed._tag !== "SealedImplementationEvidence") {
              return yield* new TaskWorktreeExecutionModeContradiction({
                operationId: operation.operationId
              })
            }
            yield* options.emit(SealedImplementationEvidenceTrace.make({
              operation,
              sealed
            }))
            return yield* makeReviewStage(
              executionOutcome,
              sealed,
              operation.operationId,
              previousReview,
              round,
              undefined
            )
          })
      }
    }
  )

  const start = options.start
  switch (start._tag) {
    case "HandbackCompleted":
      return yield* makeReworkExecutionStage(
        start.previousReview,
        start.round,
        start.operationId
      )
    case "ReviewCompleted":
      if (initialExecutionOutcome._tag !== "Succeeded") {
        return yield* new TaskWorktreeExecutionModeContradiction({
          operationId: initialExecutionOutcome.operationId
        })
      }
      return yield* stageAfterReview(
        initialExecutionOutcome,
        start.review,
        start.round,
        start.handbackOperation
      )
    case "ReviewIntended": {
      const request = start.operation.request
      if (
        initialExecutionOutcome._tag !== "Succeeded"
        || request._tag !== "AuthorizedImplementationReview"
      ) {
        return yield* new TaskWorktreeExecutionModeContradiction({
          operationId: request.operationId
        })
      }
      return yield* makeReviewStage(
        initialExecutionOutcome,
        request.implementationEvidence,
        request.evidenceSealingOperationId,
        start.previousReview,
        start.round,
        { ...start.operation, request }
      )
    }
    case "EvidenceSealed":
      if (initialExecutionOutcome._tag !== "Succeeded") {
        return yield* new TaskWorktreeExecutionModeContradiction({
          operationId: initialExecutionOutcome.operationId
        })
      }
      return yield* makeReviewStage(
        initialExecutionOutcome,
        start.evidence.sealed,
        start.evidence.operationId,
        start.previousReview,
        start.round,
        undefined
      )
    case "ExecutionOutcome":
      return yield* stageForOutcome(
        initialExecutionOutcome,
        start.previousReview,
        start.round
      )
  }
})
