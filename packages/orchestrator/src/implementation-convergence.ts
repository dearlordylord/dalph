import { Schema } from "effect"
import { ImplementationReviewRoundLimit, OperationId, PlannedTaskAttempt, TaskWorkSessionId } from "./domain.js"
import { PlannedWorktreeReady } from "./git-worktree.js"
import {
  AuthorizedImplementationReviewRequest,
  ImplementationReviewInvocationFailure,
  ReviewFindingsHandbackFailure,
  ReviewFindingsHandbackRequest,
  SealedImplementationReview
} from "./implementation-review.js"
import { samePlannedTaskAttempt } from "./planned-task-attempt.js"
import { TaskExecutionOutcome } from "./task-execution.js"
import { ActiveTaskClaim } from "./tracker-mutation.js"

/** Accepted default for one bounded implementation/review loop; each first review captures it durably. */
const defaultImplementationReviewRounds = 6
export const defaultImplementationReviewRoundLimit = ImplementationReviewRoundLimit.make(
  defaultImplementationReviewRounds
)

/** Exact tracker, Git-plan, and provider-session resources retained by an implementation disposition. */
export const ImplementationConvergenceSubject = Schema.Struct({
  claim: ActiveTaskClaim,
  plannedAttempt: PlannedTaskAttempt,
  sessionEstablishmentOperationId: OperationId,
  sessionId: TaskWorkSessionId,
  worktreeOperationId: OperationId,
  worktreeProof: PlannedWorktreeReady
}).check(
  Schema.makeFilter((subject) => {
    if (subject.claim.taskId !== subject.plannedAttempt.taskId) {
      return { path: ["claim", "taskId"], issue: "retained claim must own the planned attempt task" }
    }
    return subject.worktreeProof.baseSha === subject.plannedAttempt.baseSha
        && subject.worktreeProof.branch === subject.plannedAttempt.branch
        && subject.worktreeProof.worktree === subject.plannedAttempt.worktree
      ? undefined
      : { path: ["worktreeProof"], issue: "retained worktree proof must bind the planned attempt resources" }
  })
)
export type ImplementationConvergenceSubject = typeof ImplementationConvergenceSubject.Type

/** Evidence available before a failed or emergency rework invocation; absence is explicit on the first invocation. */
export const PriorImplementationReviewEvidence = Schema.TaggedUnion({
  NoPriorReviewEvidence: {},
  PriorReviewEvidence: { review: SealedImplementationReview }
})
export type PriorImplementationReviewEvidence = typeof PriorImplementationReviewEvidence.Type

/** A bounded live implementation loop ends in exactly one evidence-backed disposition. */
const ImplementationConvergenceDispositionVariants = Schema.TaggedUnion({
  Accepted: {
    review: SealedImplementationReview,
    subject: ImplementationConvergenceSubject
  },
  ImplementationNonConvergent: {
    review: SealedImplementationReview,
    subject: ImplementationConvergenceSubject
  },
  ReviewTechnicalRetryExhausted: {
    failure: ImplementationReviewInvocationFailure,
    request: AuthorizedImplementationReviewRequest,
    subject: ImplementationConvergenceSubject
  },
  HandbackTechnicalRetryExhausted: {
    failure: ReviewFindingsHandbackFailure,
    request: ReviewFindingsHandbackRequest,
    subject: ImplementationConvergenceSubject
  },
  ResourceEmergency: {
    outcome: TaskExecutionOutcome.cases.ResourceEmergency,
    priorEvidence: PriorImplementationReviewEvidence,
    subject: ImplementationConvergenceSubject
  },
  ImplementationExecutionFailed: {
    outcome: TaskExecutionOutcome.cases.Failed,
    priorEvidence: PriorImplementationReviewEvidence,
    subject: ImplementationConvergenceSubject
  },
  ImplementationExecutionInterrupted: {
    outcome: TaskExecutionOutcome.cases.Interrupted,
    priorEvidence: PriorImplementationReviewEvidence,
    subject: ImplementationConvergenceSubject
  }
})
const validDisposition = Schema.makeFilter((disposition: typeof ImplementationConvergenceDispositionVariants.Type) => {
  const subject = disposition.subject
  switch (disposition._tag) {
    case "Accepted":
      return disposition.review.manifest.disposition._tag === "Accepted"
          && disposition.review.manifest.implementerSessionId === subject.sessionId
          && samePlannedTaskAttempt(disposition.review.manifest.plannedAttempt, subject.plannedAttempt)
        ? undefined
        : "accepted disposition must bind an accepted review for the retained attempt and session"
    case "ImplementationNonConvergent":
      return disposition.review.manifest.disposition._tag === "Findings"
          && Number(disposition.review.manifest.round) === Number(disposition.review.manifest.roundLimit)
          && disposition.review.manifest.implementerSessionId === subject.sessionId
          && samePlannedTaskAttempt(disposition.review.manifest.plannedAttempt, subject.plannedAttempt)
        ? undefined
        : "non-convergent disposition requires findings at the captured limit for the retained attempt and session"
    case "ReviewTechnicalRetryExhausted":
      return disposition.failure.operationId === disposition.request.operationId
          && disposition.failure.reviewerSessionId === disposition.request.reviewerSessionId
          && disposition.request.implementerSessionId === subject.sessionId
          && samePlannedTaskAttempt(disposition.request.plannedAttempt, subject.plannedAttempt)
        ? undefined
        : "review exhaustion must bind the exact failed request and retained attempt/session"
    case "HandbackTechnicalRetryExhausted":
      return disposition.failure.operationId === disposition.request.operationId
          && disposition.request.implementerSessionId === subject.sessionId
          && samePlannedTaskAttempt(disposition.request.plannedAttempt, subject.plannedAttempt)
        ? undefined
        : "handback exhaustion must bind the exact failed request and retained attempt/session"
    case "ResourceEmergency":
    case "ImplementationExecutionFailed":
    case "ImplementationExecutionInterrupted":
      return disposition.outcome.sessionId === subject.sessionId
        ? undefined
        : "terminal execution evidence must bind the retained session"
  }
})
export const ImplementationConvergenceDisposition = Object.assign(
  ImplementationConvergenceDispositionVariants.check(validDisposition),
  { cases: ImplementationConvergenceDispositionVariants.cases }
)
export type ImplementationConvergenceDisposition = typeof ImplementationConvergenceDisposition.Type

/** Live disposition recording or a pure dry projection that carries no claim or provider session. */
export const ImplementationConvergenceDispositionRequest = Schema.Union([
  Schema.TaggedStruct("AuthorizedImplementationConvergenceDisposition", {
    disposition: ImplementationConvergenceDisposition,
    operationId: OperationId
  }),
  Schema.TaggedStruct("SimulatedImplementationConvergenceDisposition", {
    operationId: OperationId,
    plannedAttempt: PlannedTaskAttempt,
    roundLimit: ImplementationReviewRoundLimit
  })
])
export type ImplementationConvergenceDispositionRequest = typeof ImplementationConvergenceDispositionRequest.Type

/** Journal acknowledgement that one exact live attempt reached its terminal implementation disposition. */
export const AuthoritativeImplementationConvergenceDisposition = Schema.TaggedStruct(
  "AuthoritativeImplementationConvergenceDisposition",
  { disposition: ImplementationConvergenceDisposition, operationId: OperationId }
)

/** Pure completion projection that never fabricates acceptance, findings, claims, or provider evidence. */
export const ImplementationConvergenceSimulated = Schema.TaggedStruct(
  "ImplementationConvergenceSimulated",
  { operationId: OperationId, plannedAttempt: PlannedTaskAttempt, roundLimit: ImplementationReviewRoundLimit }
)

export const ImplementationConvergenceResult = Schema.Union([
  AuthoritativeImplementationConvergenceDisposition,
  ImplementationConvergenceSimulated
])
export type ImplementationConvergenceResult = typeof ImplementationConvergenceResult.Type

/** The terminal operation directly follows the exact invocation or semantic disposition that selected it. */
export const implementationConvergencePredecessorOperationId = (
  disposition: ImplementationConvergenceDisposition
): OperationId => {
  switch (disposition._tag) {
    case "Accepted":
    case "ImplementationNonConvergent":
      return disposition.review.manifest.operationId
    case "ReviewTechnicalRetryExhausted":
    case "HandbackTechnicalRetryExhausted":
      return disposition.failure.operationId
    case "ResourceEmergency":
    case "ImplementationExecutionFailed":
    case "ImplementationExecutionInterrupted":
      return disposition.outcome.operationId
  }
}
