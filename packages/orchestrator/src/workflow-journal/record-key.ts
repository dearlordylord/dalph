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
  IntegrationCandidateAgentReportOrdinal,
  IntegrationCandidateCorrelation,
  IntegrationCandidateGitValidationAttemptOrdinal
} from "../workflow/protocols/integration-candidate-construction/events.js"
import type { TargetVerificationRequestId } from "../workflow/protocols/target-verification/events.js"
import type {
  TargetPromotionAttemptOrdinal,
  TargetPromotionRequestId
} from "../workflow/protocols/target-promotion/events.js"
import type { CompletionClaimRequestOrdinal } from "../workflow/protocols/integration-finality/events.js"

export const workflowRunBeganRecordKey = JournalRecordKey.make("run:began")

export const workflowRunTerminatedRecordKey = JournalRecordKey.make("run:terminated")

export const controlDirectionAppliedRecordKey = (ordinal: ControlDirectionApplicationOrdinal): JournalRecordKey =>
  JournalRecordKey.make(`control-direction:${ordinal}:applied`)

export const taskClaimReacquisitionDirectedRecordKey = (requestId: TaskClaimReacquisitionRequestId): JournalRecordKey =>
  JournalRecordKey.make(`task-claim-reacquisition:${requestId}:directed`)

export const attemptChoiceAppliedRecordKey = (requestId: AttemptChoiceRequestId): JournalRecordKey =>
  JournalRecordKey.make(`attempt-choice:${requestId.nonce}:applied`)

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

export const attemptPlanRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:plan`)

export const plannedAttemptExecutorWorkResponsibilityBeganRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:executor-work-responsibility-began`)

/** Stable key for one exact continuation authorization and its current-fact witnesses. */
export const plannedAttemptContinuationAuthorizedRecordKey = (
  attemptId: AttemptId,
  witnessOperationIds: ReadonlyArray<OperationId>
): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:continuation-authorized:${[...witnessOperationIds].toSorted().join(":")}`)

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

const integrationCandidateCorrelationKey = (correlation: IntegrationCandidateCorrelation): string =>
  `${correlation.runId}:${correlation.attemptId}:${correlation.candidateId}`

export const integrationCandidateConstructionIntentRecordKey = (
  correlation: IntegrationCandidateCorrelation
): JournalRecordKey =>
  JournalRecordKey.make(`integration-candidate:${integrationCandidateCorrelationKey(correlation)}:intent`)

export const integrationCandidateAgentReportRecordKey = (
  correlation: IntegrationCandidateCorrelation,
  ordinal: IntegrationCandidateAgentReportOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(
    `integration-candidate:${integrationCandidateCorrelationKey(correlation)}:agent-report:${ordinal}`
  )

export const integrationCandidateGitObservationRecordKey = (
  correlation: IntegrationCandidateCorrelation,
  submissionPosition: JournalPosition
): JournalRecordKey =>
  JournalRecordKey.make(
    `integration-candidate:${integrationCandidateCorrelationKey(correlation)}:submission:${submissionPosition}:git-observation`
  )

export const integrationCandidateConstructedRecordKey = (
  correlation: IntegrationCandidateCorrelation
): JournalRecordKey =>
  JournalRecordKey.make(`integration-candidate:${integrationCandidateCorrelationKey(correlation)}:constructed`)

export const integrationCandidateGitValidationFailureRecordKey = (
  correlation: IntegrationCandidateCorrelation,
  submissionPosition: JournalPosition,
  attemptOrdinal: IntegrationCandidateGitValidationAttemptOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(
    `integration-candidate:${integrationCandidateCorrelationKey(correlation)}:submission:${submissionPosition}:git-failure:${attemptOrdinal}`
  )

export const integrationCandidateCorrectionLimitReachedRecordKey = (
  correlation: IntegrationCandidateCorrelation
): JournalRecordKey =>
  JournalRecordKey.make(`integration-candidate:${integrationCandidateCorrelationKey(correlation)}:non-convergent`)

export const integrationCandidateContinuationLimitReachedRecordKey = (
  correlation: IntegrationCandidateCorrelation
): JournalRecordKey =>
  JournalRecordKey.make(`integration-candidate:${integrationCandidateCorrelationKey(correlation)}:continuation-limit`)

const targetVerificationRecordKeyPrefix = (requestId: TargetVerificationRequestId): string =>
  `target-verification:${requestId}`

export const targetVerificationIntentRecordKey = (requestId: TargetVerificationRequestId): JournalRecordKey =>
  JournalRecordKey.make(`${targetVerificationRecordKeyPrefix(requestId)}:intent`)

export const targetVerificationEvidenceSealedRecordKey = (requestId: TargetVerificationRequestId): JournalRecordKey =>
  JournalRecordKey.make(`${targetVerificationRecordKeyPrefix(requestId)}:evidence-sealed`)

export const targetVerificationCorrelationContradictedRecordKey = (
  requestId: TargetVerificationRequestId
): JournalRecordKey =>
  JournalRecordKey.make(`${targetVerificationRecordKeyPrefix(requestId)}:correlation-contradiction`)

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

/** Stable journal key for the one exact completion-claim deletion result. */
export const completionClaimDeletedRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`${completionClaimRecordKeyPrefix(operationId)}:deleted`)

/** Stable journal key for one task-scoped integration finality settlement. */
export const integrationFinalitySettledRecordKey = (requestId: TargetPromotionRequestId): JournalRecordKey =>
  JournalRecordKey.make(`integration-finality:${requestId}:settled`)
