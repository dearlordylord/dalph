import { Effect } from "effect"
import { ReviewerSessionId, SemanticReviewRound } from "./domain.js"
import {
  type FreshImplementationConvergenceOptions,
  type FreshImplementationConvergenceStage,
  freshImplementationTransition,
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
import { RunnableFrontierTransition as FrontierTransition } from "./runnable-frontier.js"
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

/** Builds process-local selector stages; durable journal facts remain the recovery authority. */
export const makeFreshImplementationConvergenceStage = Effect.fn(
  "Workflow.makeFreshImplementationConvergenceStage"
)(function*(
  options: FreshImplementationConvergenceOptions,
  initialExecutionOutcome: TaskExecutionOutcome
): Effect.fn.Return<
  FreshImplementationConvergenceStage,
  TaskWorktreeExecutionModeContradiction
> {
  const makeReworkExecutionStage = Effect.fn(
    "Workflow.makeFreshReworkExecutionStage"
  )(function*(
    review: SealedImplementationReview,
    round: number,
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
        true
      ),
      run: () =>
        Effect.gen(function*() {
          yield* options.emit(OperationSelected.make({ operation }))
          yield* options.emit(TaskExecutionAdmitted.make({ operation }))
          const observed = yield* options.interpreter.executeTaskWork(operation)
          yield* options.emit(TaskExecutionOutcomeObserved.make({
            operation,
            outcome: observed
          }))
          return yield* stageForOutcome(
            observed.outcome,
            review,
            round + 1
          )
        })
    }
  })

  const stageAfterReview = Effect.fn("Workflow.stageAfterFreshReview")(
    function*(
      executionOutcome: Extract<TaskExecutionOutcome, { readonly _tag: "Succeeded" }>,
      review: SealedImplementationReview,
      round: number,
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
      if (round === Number(options.roundLimit)) {
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
            true
          )
          : FrontierTransition.ContinueReviewFindingsHandback({
            operationId: operation.request.operationId,
            taskId: options.task.id
          }),
        run: () =>
          Effect.gen(function*() {
            if (recoveredHandback === undefined) {
              yield* options.emit(OperationSelected.make({ operation }))
            }
            const handback = yield* Effect.result(
              options.interpreter.handBackReviewFindings(operation)
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
      round: number,
      recoveredOperation:
        | ReturnType<
          typeof makeImplementationReviewOperation
        >
        | undefined
    ): Effect.fn.Return<
      FreshImplementationConvergenceStage,
      TaskWorktreeExecutionModeContradiction
    > {
      const recoveredRequest = recoveredOperation?.request
      if (
        recoveredRequest !== undefined
        && recoveredRequest._tag !== "AuthorizedImplementationReview"
      ) {
        return yield* new TaskWorktreeExecutionModeContradiction({
          operationId: recoveredRequest.operationId
        })
      }
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
          round: SemanticReviewRound.make(round),
          roundLimit: options.roundLimit
        })
      const operation = recoveredOperation
        ?? makeImplementationReviewOperation(request)
      return {
        transition: recoveredOperation === undefined
          ? freshImplementationTransition(operationId, options.task, true)
          : FrontierTransition.ContinueImplementationReview({
            operationId,
            taskId: options.task.id
          }),
        run: () =>
          Effect.gen(function*() {
            if (recoveredOperation === undefined) {
              yield* options.emit(OperationSelected.make({ operation }))
            }
            const reviewed = yield* Effect.result(
              options.interpreter.reviewImplementation(operation)
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
      round: number
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
          false
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

  const round = Number(
    options.initialRound
      ?? options.initialReview?.manifest.round
      ?? 1
  )
  if (options.initialCompletedHandbackOperationId !== undefined) {
    if (options.initialPreviousReview === undefined) {
      return yield* new TaskWorktreeExecutionModeContradiction({
        operationId: options.initialCompletedHandbackOperationId
      })
    }
    return yield* makeReworkExecutionStage(
      options.initialPreviousReview,
      round,
      options.initialCompletedHandbackOperationId
    )
  }
  if (options.initialReview !== undefined) {
    if (initialExecutionOutcome._tag !== "Succeeded") {
      return yield* new TaskWorktreeExecutionModeContradiction({
        operationId: initialExecutionOutcome.operationId
      })
    }
    return yield* stageAfterReview(
      initialExecutionOutcome,
      options.initialReview,
      round,
      options.initialHandbackOperation
    )
  }
  if (options.initialReviewOperation !== undefined) {
    const request = options.initialReviewOperation.request
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
      options.initialPreviousReview,
      round,
      options.initialReviewOperation
    )
  }
  if (options.initialSealedEvidence !== undefined) {
    if (initialExecutionOutcome._tag !== "Succeeded") {
      return yield* new TaskWorktreeExecutionModeContradiction({
        operationId: initialExecutionOutcome.operationId
      })
    }
    return yield* makeReviewStage(
      initialExecutionOutcome,
      options.initialSealedEvidence.sealed,
      options.initialSealedEvidence.operationId,
      options.initialPreviousReview,
      round,
      undefined
    )
  }
  return yield* stageForOutcome(
    initialExecutionOutcome,
    options.initialPreviousReview,
    round
  )
})
