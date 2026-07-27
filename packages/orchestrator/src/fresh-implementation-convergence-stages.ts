import { Effect } from "effect"
import { type ImplementationReviewRoundLimit, ReviewerSessionId, SemanticReviewRound, type Task } from "./domain.js"
import { ImplementationConvergenceDispositionRecordedTrace } from "./implementation-convergence-trace.js"
import {
  ImplementationConvergenceDisposition,
  type ImplementationConvergenceSubject,
  PriorImplementationReviewEvidence
} from "./implementation-convergence.js"
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
import {
  type RunnableFrontierTransition,
  RunnableFrontierTransition as FrontierTransition
} from "./runnable-frontier.js"
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

type InterpreterOperation = WorkflowInterpreterService[keyof WorkflowInterpreterService]

export type FreshImplementationConvergenceStageError =
  | Effect.Error<ReturnType<InterpreterOperation>>
  | TaskWorktreeExecutionModeContradiction
  | TraceOutputError

// eslint-disable-next-line functional/no-mixed-types -- A process-local stage deliberately pairs immutable selection with its sole executable operation.
export interface FreshImplementationConvergenceStage {
  readonly transition: RunnableFrontierTransition

  readonly run: () => Effect.Effect<
    FreshImplementationConvergenceStage | undefined,
    FreshImplementationConvergenceStageError
  >
}

// eslint-disable-next-line functional/no-mixed-types -- Dependencies and the serialized trace emitter form one stage factory input.
interface FreshImplementationConvergenceOptions {
  readonly allocator: OperationIdAllocatorService
  readonly emit: (item: TraceItem) => Effect.Effect<void, TraceOutputError>
  readonly interpreter: WorkflowInterpreterService
  readonly roundLimit: ImplementationReviewRoundLimit
  readonly subject: ImplementationConvergenceSubject
  readonly task: Task
}

const priorEvidence = (
  review: SealedImplementationReview | undefined
): PriorImplementationReviewEvidence =>
  review === undefined
    ? PriorImplementationReviewEvidence.cases.NoPriorReviewEvidence.make({})
    : PriorImplementationReviewEvidence.cases.PriorReviewEvidence.make({ review })

/** Builds process-local selector stages; durable journal facts remain the recovery authority. */
export const makeFreshImplementationConvergenceStage = Effect.fn(
  "Workflow.makeFreshImplementationConvergenceStage"
)(function*(
  options: FreshImplementationConvergenceOptions,
  initialExecutionOutcome: TaskExecutionOutcome
): Effect.fn.Return<FreshImplementationConvergenceStage> {
  const makeDispositionStage = Effect.fn(
    "Workflow.makeFreshImplementationDispositionStage"
  )(function*(
    disposition: ImplementationConvergenceDisposition,
    predecessorOperationId: Parameters<
      typeof makeImplementationDispositionOperation
    >[1]
  ): Effect.fn.Return<FreshImplementationConvergenceStage> {
    const operation = makeImplementationDispositionOperation(
      {
        _tag: "AuthorizedImplementationConvergenceDisposition",
        disposition,
        operationId: yield* options.allocator.allocate()
      },
      predecessorOperationId
    )
    return {
      transition: FrontierTransition.ContinueFreshWorkflowOperation({
        operationId: operation.request.operationId,
        taskId: options.task.id
      }),
      run: () =>
        Effect.gen(function*() {
          yield* options.emit(OperationSelected.make({ operation }))
          const result = yield* options.interpreter.recordImplementationDisposition(
            operation
          )
          if (
            result._tag
              !== "AuthoritativeImplementationConvergenceDisposition"
          ) {
            return yield* new TaskWorktreeExecutionModeContradiction({
              operationId: operation.request.operationId
            })
          }
          yield* options.emit(
            ImplementationConvergenceDispositionRecordedTrace.make({
              operation,
              result
            })
          )
        })
    }
  })

  const stageAfterReview = Effect.fn("Workflow.stageAfterFreshReview")(
    function*(
      executionOutcome: Extract<TaskExecutionOutcome, { readonly _tag: "Succeeded" }>,
      review: SealedImplementationReview,
      round: number
    ): Effect.fn.Return<FreshImplementationConvergenceStage> {
      if (review.manifest.disposition._tag === "Accepted") {
        return yield* makeDispositionStage(
          ImplementationConvergenceDisposition.cases.Accepted.make({
            review,
            subject: options.subject
          }),
          review.manifest.operationId
        )
      }
      if (round === Number(options.roundLimit)) {
        return yield* makeDispositionStage(
          ImplementationConvergenceDisposition.cases.ImplementationNonConvergent.make({
            review,
            subject: options.subject
          }),
          review.manifest.operationId
        )
      }
      const operation = makeReviewFindingsHandbackOperation(
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
        transition: FrontierTransition.ContinueReviewFindingsHandback({
          operationId: operation.request.operationId,
          taskId: options.task.id
        }),
        run: () =>
          Effect.gen(function*() {
            yield* options.emit(OperationSelected.make({ operation }))
            const handback = yield* Effect.result(
              options.interpreter.handBackReviewFindings(operation)
            )
            if (handback._tag === "Failure") {
              if (!(handback.failure instanceof ReviewFindingsHandbackFailure)) {
                return yield* Effect.fail(handback.failure)
              }
              return yield* makeDispositionStage(
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
            const executionOperation = makeTaskExecutionOperation({
              predecessorOperationIds: [
                operation.request.operationId,
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
              transition: FrontierTransition.ContinueTaskExecution({
                operationId: executionOperation.request.operationId,
                taskId: options.task.id
              }),
              run: () =>
                Effect.gen(function*() {
                  yield* options.emit(
                    OperationSelected.make({ operation: executionOperation })
                  )
                  yield* options.emit(
                    TaskExecutionAdmitted.make({ operation: executionOperation })
                  )
                  const observed = yield* options.interpreter.executeTaskWork(
                    executionOperation
                  )
                  yield* options.emit(TaskExecutionOutcomeObserved.make({
                    operation: executionOperation,
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
      round: number
    ): Effect.fn.Return<FreshImplementationConvergenceStage> {
      const operationId = yield* options.allocator.allocate()
      const request = AuthorizedImplementationReviewRequest.make({
        evidenceSealingOperationId: evidenceOperationId,
        findingHistory: previousReview?.manifest.findingHistory ?? [],
        implementationEvidence: evidence,
        implementerInvocationId: executionOutcome.operationId,
        implementerSessionId: executionOutcome.sessionId,
        operationId,
        plannedAttempt: options.subject.plannedAttempt,
        predecessorEvidenceReference: previousReview?.manifestReference ?? evidence.manifestReference,
        reviewerSessionId: ReviewerSessionId.make(
          `reviewer-session:${operationId}`
        ),
        round: SemanticReviewRound.make(round),
        roundLimit: options.roundLimit
      })
      const operation = makeImplementationReviewOperation(request)
      return {
        transition: FrontierTransition.ContinueImplementationReview({
          operationId,
          taskId: options.task.id
        }),
        run: () =>
          Effect.gen(function*() {
            yield* options.emit(OperationSelected.make({ operation }))
            const reviewed = yield* Effect.result(
              options.interpreter.reviewImplementation(operation)
            )
            if (reviewed._tag === "Failure") {
              if (
                !(reviewed.failure instanceof ImplementationReviewInvocationFailure)
              ) {
                return yield* Effect.fail(reviewed.failure)
              }
              return yield* makeDispositionStage(
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
              round
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
        const evidence = priorEvidence(previousReview)
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
        return yield* makeDispositionStage(
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
        transition: FrontierTransition.ContinueImplementationEvidenceSealing({
          operationId: operation.operationId,
          taskId: options.task.id
        }),
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
              round
            )
          })
      }
    }
  )

  return yield* stageForOutcome(initialExecutionOutcome, undefined, 1)
})
