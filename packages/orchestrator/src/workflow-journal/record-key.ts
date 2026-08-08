import { type AttemptId } from "@dalph/contracts"
import { type OperationId } from "../workflow/identity.js"
import { type JournalPosition, JournalRecordKey } from "./identity.js"
import type { PlannedAttemptExecutorReportOrdinal } from "../workflow/protocols/planned-attempt-executor-work/events.js"
import type { RunPolicyRevision } from "../control/policy.js"
import type { ControlDirectionApplicationOrdinal } from "../workflow/protocols/control-direction-application/events.js"
import type { TaskClaimReacquisitionRequestId } from "../workflow/protocols/task-claim-reacquisition/events.js"
import type {
  IntegrationCandidateAgentReportOrdinal,
  IntegrationCandidateCorrelation,
  IntegrationCandidateGitValidationAttemptOrdinal
} from "../workflow/protocols/integration-candidate-construction/events.js"
import type { TargetVerificationRequestId } from "../workflow/protocols/target-verification/events.js"

export const workflowRunBeganRecordKey = JournalRecordKey.make("run:began")

export const workflowRunTerminatedRecordKey = JournalRecordKey.make("run:terminated")

export const controlDirectionAppliedRecordKey = (ordinal: ControlDirectionApplicationOrdinal): JournalRecordKey =>
  JournalRecordKey.make(`control-direction:${ordinal}:applied`)

export const taskClaimReacquisitionDirectedRecordKey = (requestId: TaskClaimReacquisitionRequestId): JournalRecordKey =>
  JournalRecordKey.make(`task-claim-reacquisition:${requestId}:directed`)

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

export const plannedAttemptExecutorWorkReportedRecordKey = (
  attemptId: AttemptId,
  ordinal: PlannedAttemptExecutorReportOrdinal
): JournalRecordKey => JournalRecordKey.make(`attempt:${attemptId}:executor-work-report:${ordinal}`)

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
