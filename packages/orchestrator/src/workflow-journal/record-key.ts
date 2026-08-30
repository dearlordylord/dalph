import { type AttemptId } from "@dalph/contracts"
import { type OperationId } from "../workflow/identity.js"
import { type JournalPosition, JournalRecordKey } from "./identity.js"
import type {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservationOrdinal
} from "../workflow/protocols/planned-attempt-executor-work/events.js"
import type { RunPolicyRevision } from "../control/policy.js"
import type { ControlDirectionApplicationOrdinal } from "../workflow/protocols/control-direction-application/events.js"
import type { TaskClaimReacquisitionRequestId } from "../workflow/protocols/task-claim-reacquisition/events.js"
import type { AttemptChoiceRequestId } from "../workflow/protocols/attempt-choice/events.js"
import type {
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorRunCorrelation,
  IntegratorResponsibilityFacts,
  IntegratorSessionId
} from "../workflow/protocols/integrator/events.js"
import type {
  TargetPromotionAttemptOrdinal,
  TargetPromotionRequestId
} from "../workflow/protocols/target-promotion/events.js"
import type {
  CompletionClaimDeletionReadPurpose,
  CompletionClaimRequestOrdinal,
  CompletionTaskRequest,
  CompletionTaskRequestOrdinal
} from "../workflow/protocols/integration-finality/events.js"
import {
  type IntegrationQuarantineBasis,
  type IntegrationQuarantineDirectionSubject,
  integrationQuarantineBasisKey
} from "../workflow/protocols/integration-quarantine/events.js"
import type {
  CleanupMutationOrdinal,
  CleanupObservationOrdinal
} from "../workflow/protocols/disposition-cleanup/disposition.js"
import type { PlannedAttemptContinuationWitness } from "../workflow/protocols/planned-attempt-continuation/events.js"
import type { ActiveWorkAuthorityRefreshOrdinal } from "../workflow/protocols/active-work-authority-refresh/events.js"

export const workflowRunBeganRecordKey = JournalRecordKey.make("run:began")

export const workflowRunTerminatedRecordKey = JournalRecordKey.make("run:terminated")

const dispositionCleanupRecordKeyPrefix = (operationId: OperationId): string => `disposition-cleanup:${operationId}`

/** Stable key for one exact worktree cleanup authorization. */
export const worktreeCleanupAuthorizedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:worktree:authorized`)

/** Stable key for one fresh worktree cleanup read intent. */
export const worktreeCleanupObservationIntendedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:worktree:observation:${ordinal}:intent`)

/** Stable key for one fresh worktree cleanup observation. */
export const worktreeCleanupObservedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:worktree:observation:${ordinal}`)

/** Stable key for a fresh absence proof that reconciles cleanup without a mutation result. */
export const worktreeCleanupAbsenceConfirmedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:worktree:absence:${ordinal}`)

/** Stable key for one numbered worktree remove request. */
export const worktreeCleanupMutationIntendedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupMutationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:worktree:mutation:${ordinal}:intent`)

/** Stable key for one numbered worktree remove result. */
export const worktreeCleanupMutationResultRecordedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupMutationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:worktree:mutation:${ordinal}:result`)

/** Stable key for an exact worktree cleanup contradiction. */
export const worktreeCleanupContradictedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:worktree:contradicted`)

/** Stable key for the terminal worktree cleanup settlement. */
export const worktreeCleanupSettledRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:worktree:settled`)

/** Stable keys for exact planned-branch cleanup facts. */
export const branchCleanupAuthorizedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:branch:authorized`)
export const branchCleanupObservationIntendedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:branch:observation:${ordinal}:intent`)
export const branchCleanupObservedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:branch:observation:${ordinal}`)
export const branchCleanupAbsenceConfirmedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:branch:absence:${ordinal}`)
export const branchCleanupMutationIntendedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupMutationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:branch:mutation:${ordinal}:intent`)
export const branchCleanupMutationResultRecordedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupMutationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:branch:mutation:${ordinal}:result`)
export const branchCleanupContradictedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:branch:contradicted`)
export const branchCleanupSettledRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:branch:settled`)

/** Stable keys for exact Integrator-candidate cleanup facts. */
export const integratorCandidateCleanupAuthorizedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:integrator-candidate:authorized`)
export const integratorCandidateCleanupObservationIntendedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(
    `${dispositionCleanupRecordKeyPrefix(operationId)}:integrator-candidate:observation:${ordinal}:intent`
  )
export const integratorCandidateCleanupObservedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:integrator-candidate:observation:${ordinal}`)
export const integratorCandidateCleanupAbsenceConfirmedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:integrator-candidate:absence:${ordinal}`)
export const integratorCandidateCleanupMutationIntendedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupMutationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(
    `${dispositionCleanupRecordKeyPrefix(operationId)}:integrator-candidate:mutation:${ordinal}:intent`
  )
export const integratorCandidateCleanupMutationResultRecordedRecordKey = (
  operationId: OperationId,
  ordinal: CleanupMutationOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(
    `${dispositionCleanupRecordKeyPrefix(operationId)}:integrator-candidate:mutation:${ordinal}:result`
  )
export const integratorCandidateCleanupContradictedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:integrator-candidate:contradicted`)
export const integratorCandidateCleanupSettledRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${dispositionCleanupRecordKeyPrefix(operationId)}:integrator-candidate:settled`)

/** Stable singleton key for the Operator's one applied Run cancellation. */
export const runCancellationAppliedRecordKey = JournalRecordKey.make("run:cancellation:applied")

/** Stable key for one exact cancelled-attempt executor responsibility settlement. */
export const cancelledAttemptImplementationResponsibilityRelinquishedRecordKey = (
  attemptId: AttemptId
): JournalRecordKey => JournalRecordKey.make(`cancelled-attempt:${attemptId}:implementation-relinquished`)

/** Stable key for one exact cancelled-attempt claim no-release observation. */
export const cancelledAttemptClaimNoReleaseRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`cancelled-attempt:${attemptId}:claim-no-release`)

export const controlDirectionAppliedRecordKey = (ordinal: ControlDirectionApplicationOrdinal): JournalRecordKey =>
  JournalRecordKey.make(`control-direction:${ordinal}:applied`)

export const taskClaimReacquisitionDirectedRecordKey = (requestId: TaskClaimReacquisitionRequestId): JournalRecordKey =>
  JournalRecordKey.make(`task-claim-reacquisition:${requestId}:directed`)

export const attemptChoiceAppliedRecordKey = (requestId: AttemptChoiceRequestId): JournalRecordKey =>
  JournalRecordKey.make(`attempt-choice:${requestId.nonce}:applied`)

/** Stable P1-scoped key for its one possible atomic successor plan. */
export const plannedAttemptReplacedRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:replaced`)

export const attemptStoppageIntentRecordKey = (requestId: AttemptChoiceRequestId): JournalRecordKey =>
  JournalRecordKey.make(`attempt-stoppage:${requestId.nonce}:intent`)

export const attemptImplementationAbandonedRecordKey = (requestId: AttemptChoiceRequestId): JournalRecordKey =>
  JournalRecordKey.make(`attempt-stoppage:${requestId.nonce}:implementation-abandoned`)

export const stoppedAttemptClaimNoReleaseRecordKey = (requestId: AttemptChoiceRequestId): JournalRecordKey =>
  JournalRecordKey.make(`attempt-stoppage:${requestId.nonce}:claim-no-release`)

export const taskWorkCapacityPolicyRecordKey = (revision: RunPolicyRevision): JournalRecordKey =>
  JournalRecordKey.make(`run-policy:${revision}:task-work-capacity`)

export const intentRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:intent`)

export const outcomeRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:outcome`)

/** Stable key for one Restart-scoped authority-read failure occurrence. */
export const attemptRestartAuthorityReadFailedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:restart-authority-read-failed`)

/** Stable key for one numbered active-work authority-refresh Git read failure. */
export const activeWorkAuthorityRefreshGitReadFailedRecordKey = (
  operationId: OperationId,
  ordinal: ActiveWorkAuthorityRefreshOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:active-work-authority-refresh-git-read-failed:${ordinal}`)

export const attemptPlanRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:plan`)

export const plannedAttemptExecutorWorkResponsibilityBeganRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:executor-work-responsibility-began`)

/** Stable key for one exact continuation authorization and its current-fact witnesses. */
export const plannedAttemptContinuationAuthorizedRecordKey = (
  attemptId: AttemptId,
  witness: PlannedAttemptContinuationWitness
): JournalRecordKey => {
  const observation = witness.activeTaskContinuationRead
  const witnessOperationIds = [
    observation.graphObservationOperationId,
    observation.taskClaimObservationOperationId,
    observation.taskWorkSpecificationObservationOperationId,
    witness.targetLineageObservationOperationId,
    witness.worktreeObservationOperationId
  ]
  return JournalRecordKey.make(
    `attempt:${attemptId}:continuation-authorized:${witnessOperationIds.toSorted().join(":")}`
  )
}

export const plannedAttemptExecutorCommandIntendedRecordKey = (
  attemptId: AttemptId,
  ordinal: PlannedAttemptExecutorCommandOrdinal
): JournalRecordKey => JournalRecordKey.make(`attempt:${attemptId}:executor-command:${ordinal}:intent`)

export const plannedAttemptExecutorCommandProjectionObservedRecordKey = (
  attemptId: AttemptId,
  commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
  projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(
    `attempt:${attemptId}:executor-command:${commandOrdinal}:projection:${projectionOrdinal}:observation`
  )

export const plannedAttemptExecutorCommandResponseContradictedRecordKey = (
  attemptId: AttemptId,
  commandOrdinal: PlannedAttemptExecutorCommandOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:executor-command:${commandOrdinal}:response-contradiction`)

export const plannedAttemptExecutorCommandResponseObservedRecordKey = (
  attemptId: AttemptId,
  commandOrdinal: PlannedAttemptExecutorCommandOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:executor-command:${commandOrdinal}:response-observation`)

export const plannedAttemptExecutorWorkReportedRecordKey = (
  attemptId: AttemptId,
  ordinal: PlannedAttemptExecutorReportOrdinal
): JournalRecordKey => JournalRecordKey.make(`attempt:${attemptId}:executor-work-report:${ordinal}`)

export const plannedAttemptExecutorStateObservedRecordKey = (
  attemptId: AttemptId,
  ordinal: PlannedAttemptExecutorStateObservationOrdinal
): JournalRecordKey => JournalRecordKey.make(`attempt:${attemptId}:executor-state-observation:${ordinal}`)

export const integrationResponsibilityBeganRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:integration-responsibility-began`)

export const integrationStartedRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:integration-started`)

const integratorRecordKeyPrefix = (responsibility: IntegratorResponsibilityFacts): string =>
  `integrator:${responsibility.plannedAttempt.runId}:${responsibility.plannedAttempt.attemptId}:${responsibility.startedAt}`

const integratorCorrelationRecordKeyPrefix = (correlation: IntegratorSessionCorrelation): string =>
  `${integratorRecordKeyPrefix(correlation)}:session:${correlation.sessionId}`

/** Stable key prefix for one exact outer-Integrator run within its session. */
export const integratorRunRecordKeyPrefix = (run: IntegratorRunCorrelation): string =>
  `${integratorCorrelationRecordKeyPrefix(run.session)}:run:${run.ordinal}`

/** Stable key for the intent written before one exact opaque Integrator run. */
export const integratorRunStartedRecordKey = (run: IntegratorRunCorrelation): JournalRecordKey =>
  JournalRecordKey.make(`${integratorRunRecordKeyPrefix(run)}:started`)

/** Stable key for one exact run's durable outer result. */
export const integratorRunResultRecordedRecordKey = (run: IntegratorRunCorrelation): JournalRecordKey =>
  JournalRecordKey.make(`${integratorRunRecordKeyPrefix(run)}:result`)

/** Stable key prefix for one exact run's explicitly reported candidate. */
export const integratorRunCandidateRecordKeyPrefix = (
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText
): string => `${integratorRunRecordKeyPrefix(run)}:candidate:${JSON.stringify(candidateText)}`

/** Intent before Git reads a candidate reported by one exact Integrator run. */
export const integratorRunCandidateGitReadIntendedRecordKey = (
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText
): JournalRecordKey =>
  JournalRecordKey.make(`${integratorRunCandidateRecordKeyPrefix(run, candidateText)}:git-read-intent`)

/** Durable Git object-and-parent observation for one exact Integrator run. */
export const integratorRunCandidateGitObservedRecordKey = (
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText
): JournalRecordKey =>
  JournalRecordKey.make(`${integratorRunCandidateRecordKeyPrefix(run, candidateText)}:git-observation`)

/** One fixed outer-Integrator session for an exact started responsibility, independent of a later observed H. */
export const integratorSessionFixedRecordKey = (responsibility: IntegratorResponsibilityFacts): JournalRecordKey =>
  JournalRecordKey.make(`${integratorRecordKeyPrefix(responsibility)}:session-fixed`)

/** Stable key for the one FullRerun successor allowed for one exact Q/D subject. */
export const integratorSuccessorSessionFixedRecordKey = (
  predecessor: IntegratorSessionCorrelation,
  quarantineAt: JournalPosition,
  directionAppliedAt: JournalPosition
): JournalRecordKey =>
  JournalRecordKey.make(
    `${integratorCorrelationRecordKeyPrefix(predecessor)}:successor:full-rerun:${quarantineAt}:${directionAppliedAt}:fixed`
  )

const targetPromotionRecordKeyPrefix = (requestId: TargetPromotionRequestId): string => `target-promotion:${requestId}`

/** Stable journal key for one exact candidate's promotion intent. */
export const targetPromotionIntentRecordKey = (requestId: TargetPromotionRequestId): JournalRecordKey =>
  JournalRecordKey.make(`${targetPromotionRecordKeyPrefix(requestId)}:intent`)

/** Stable journal key for the intent preceding one numbered compare-and-set request. */
export const targetPromotionAttemptIntentRecordKey = (
  requestId: TargetPromotionRequestId,
  attemptOrdinal: TargetPromotionAttemptOrdinal
): JournalRecordKey => JournalRecordKey.make(`${targetPromotionRecordKeyPrefix(requestId)}:attempt:${attemptOrdinal}`)

/** Stable journal key for the one exact promotion proof. */
export const targetPromotionObservedSuccessRecordKey = (requestId: TargetPromotionRequestId): JournalRecordKey =>
  JournalRecordKey.make(`${targetPromotionRecordKeyPrefix(requestId)}:observed-success`)

/** Stable journal key for the one stale-head result. */
export const targetPromotionStaleRecordKey = (requestId: TargetPromotionRequestId): JournalRecordKey =>
  JournalRecordKey.make(`${targetPromotionRecordKeyPrefix(requestId)}:stale`)

/** Stable journal key for the accepted three-attempt terminal disposition. */
export const targetPromotionNonConvergenceRecordKey = (requestId: TargetPromotionRequestId): JournalRecordKey =>
  JournalRecordKey.make(`${targetPromotionRecordKeyPrefix(requestId)}:nonconvergence`)

const completionClaimRecordKeyPrefix = (operationId: OperationId): string => `completion-claim:${operationId}`

/** Stable journal key for intent to replace one exact active claim. */
export const completionClaimReplacementIntentRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${completionClaimRecordKeyPrefix(operationId)}:replacement-intent`)

/** Stable journal key for one numbered completion-claim replacement request. */
export const completionClaimReplacementAttemptIntentRecordKey = (
  operationId: OperationId,
  attemptOrdinal: CompletionClaimRequestOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${completionClaimRecordKeyPrefix(operationId)}:replacement-attempt:${attemptOrdinal}`)

/** Stable journal key for the one exact completion-claim replacement result. */
export const completionClaimReplacedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${completionClaimRecordKeyPrefix(operationId)}:replaced`)

/** Stable journal key for intent to delete one exact completion claim. */
export const completionClaimDeletionIntentRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${completionClaimRecordKeyPrefix(operationId)}:deletion-intent`)

/** Stable journal key for one numbered completion-claim deletion request. */
export const completionClaimDeletionAttemptIntentRecordKey = (
  operationId: OperationId,
  attemptOrdinal: CompletionClaimRequestOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${completionClaimRecordKeyPrefix(operationId)}:deletion-attempt:${attemptOrdinal}`)

/** Stable journal key for one exact completion-claim cleanup reread result. */
export const completionClaimDeletionReadObservedRecordKey = (
  operationId: OperationId,
  purpose: CompletionClaimDeletionReadPurpose
): JournalRecordKey => {
  const attemptIdentity = purpose._tag === "BeforeOriginalClaimRelease" ? "original" : purpose.attemptOrdinal
  return JournalRecordKey.make(
    `${completionClaimRecordKeyPrefix(operationId)}:deletion-read:${purpose._tag}:${attemptIdentity}:${purpose.readOrdinal}`
  )
}

/** Stable journal key for the one exact completion-claim deletion result. */
export const completionClaimDeletedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${completionClaimRecordKeyPrefix(operationId)}:deleted`)

/** Stable journal key for one task-scoped integration finality settlement. */
export const integrationFinalitySettledRecordKey = (requestId: TargetPromotionRequestId): JournalRecordKey =>
  JournalRecordKey.make(`integration-finality:${requestId}:settled`)

/** Stable key for one exact conclusive quarantine occurrence of one Integrator session. */
export const integrationQuarantinedRecordKey = (
  sessionId: IntegratorSessionId,
  basis: IntegrationQuarantineBasis
): JournalRecordKey =>
  JournalRecordKey.make(`integration-quarantine:${sessionId}:${integrationQuarantineBasisKey(basis)}:quarantined`)

/** Stable key for exact proof that one provider run has no owned activity. */
export const integrationProviderRunActivityAbsentRecordKey = (run: IntegratorRunCorrelation): JournalRecordKey =>
  JournalRecordKey.make(`integration-quarantine:${run.session.sessionId}:run:${run.ordinal}:provider-activity-absent`)

/** Stable key for the one winning operator direction for an exact quarantine subject. */
export const integrationQuarantineDirectionAppliedRecordKey = (
  subject: IntegrationQuarantineDirectionSubject
): JournalRecordKey =>
  JournalRecordKey.make(`integration-quarantine-direction:${subject.sessionId}:${subject.quarantineAt}:applied`)

const completionTaskRecordKeyPrefix = (operationId: OperationId): string => `completion-task:${operationId}`

/** Stable key for the immutable task-completion request intent. */
export const completionTaskIntentRecordKey = (request: CompletionTaskRequest): JournalRecordKey =>
  JournalRecordKey.make(`${completionTaskRecordKeyPrefix(request.operationId)}:intent`)

/** Stable key for one numbered task-completion call intent. */
export const completionTaskAttemptIntentRecordKey = (
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal
): JournalRecordKey => JournalRecordKey.make(`${completionTaskRecordKeyPrefix(request.operationId)}:attempt:${ordinal}`)

/** Stable key for the direct tracker acknowledgement. */
export const completionTaskAcknowledgedRecordKey = (request: CompletionTaskRequest): JournalRecordKey =>
  JournalRecordKey.make(`${completionTaskRecordKeyPrefix(request.operationId)}:acknowledged`)

/** Stable key for the lost-response occurrence. */
export const completionTaskResponseLostRecordKey = (
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal
): JournalRecordKey => JournalRecordKey.make(`${completionTaskRecordKeyPrefix(request.operationId)}:lost:${ordinal}`)

/** Stable key for one definitive tracker rejection of numbered Q. */
export const completionTaskRejectedRecordKey = (
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${completionTaskRecordKeyPrefix(request.operationId)}:rejected:${ordinal}`)

/** Stable keys around one exact promoted-candidate ancestry boundary read. */
export const completionTaskCandidateAncestryReadIntentRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${completionTaskRecordKeyPrefix(operationId)}:ancestry-read:intent`)
export const completionTaskCandidateAncestryObservedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${completionTaskRecordKeyPrefix(operationId)}:ancestry-read:observed`)

/** Stable key for intent before one exact request-result lookup. */
export const completionTaskRequestLookupIntentRecordKey = (
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`${completionTaskRecordKeyPrefix(request.operationId)}:lookup:${ordinal}:intent`)

/** Stable key for one exact-request lookup result. */
export const completionTaskRequestLookupRecordKey = (
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal
): JournalRecordKey => JournalRecordKey.make(`${completionTaskRecordKeyPrefix(request.operationId)}:lookup:${ordinal}`)
