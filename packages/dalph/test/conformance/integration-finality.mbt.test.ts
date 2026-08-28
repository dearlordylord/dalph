import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { AcceptedResultEvidenceManifest, TaskId, TaskRevision } from "@dalph/contracts"
import {
  CompletionClaimBoundary,
  CompletionClaimDeletionFailure,
  CompletionClaimReplacementFailure,
  CompletionTaskAcknowledgement,
  CompletionTaskAuthorizationWait,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskClaim,
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskRequestOrdinal,
  CompletionTaskRequestFailure,
  CompletionTaskRequestLookup,
  FocusedCompletedTaskObservation,
  FocusedTaskCompletionReadRequest,
  FocusedTaskCompletionReadFailure,
  InRunJournal,
  JournalStoreContradiction,
  JournalStorageUnavailable,
  OperationId,
  TaskLifecycle,
  TrackerRevision,
  completionClaimDeletionRequestFor,
  completionClaimReplacementRequestFor,
  completionClaimRequestLimit,
  completionTaskRequestLimit,
  completionTaskClaimEquals,
  describeJournalEvent,
  deriveIntegrationFinalityStateFor,
  deriveRunFinalityDecision,
  JournalPosition,
  UnclaimedTask,
  runCompletionClaimDeletionProtocol,
  runCompletionClaimReplacementProtocol,
  runCompletionTaskProtocol,
  taskTrackerReadIntent,
  outcomeRecordKey,
  targetPromotionObservedSuccessRecordKey,
  makeTrackerGraphObservationOperation,
  workflowJournalEventVersion,
  type WorkflowResponsibilityEntry,
  type WorkflowResponsibilityState,
  type CompletionClaimObservation,
  type CompletionSuccessObservation,
  type CompletionTaskBoundaryService,
  type JournalRecord,
  WorkflowJournalEvent
} from "@dalph/orchestrator"
import { Deferred, Effect, Fiber, Option, Schema } from "effect"
import {
  CompletionTaskFocusedReadPurpose,
  CompletionTaskIntendedEvent,
  completionTaskRequestFor
} from "../../../orchestrator/src/workflow/protocols/integration-finality/events.js"
import {
  authorizeCompletionTaskAttempt,
  completionTaskAuthorizationIssue,
  readCompletionCandidateAncestry,
  readCompletionFocusedFacts,
  rereadCompletionEvidence
} from "../../../orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.js"
import { integrationFinalityFixture } from "../../../orchestrator/src/workflow/protocols/integration-finality/fixtures.js"
import { IntegratorRunQualifiedCandidate } from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import {
  TargetPromotionGit,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  targetPromotionCorrelationFor,
  type TargetPromotionCorrelation
} from "../../../orchestrator/src/workflow/protocols/target-promotion/events.js"
import { EvidenceStore } from "../../../orchestrator/src/workflow/protocols/evidence-store.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservedEvent
} from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { TaskWorkCapacity } from "../../../orchestrator/src/coordination/admission/capacity.js"
import { TrackerGraphState } from "../../../orchestrator/src/coordination/delivery/relations.js"
import { frontierOf } from "../../../orchestrator/src/coordination/delivery/ticket-delivery-projection.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../../orchestrator/src/control/policy.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../orchestrator/test/journaled-graph-observation.js"

const RUN_ID = 141n
const TASK_A = 1n
const TASK_B = 2n
const ATTEMPT_A = 11n
const ATTEMPT_B = 22n
const TASK_REVISION_A = 7n
const TASK_REVISION_B = 8n
const ORIGINAL_CLAIM_A = 101n
const ORIGINAL_CLAIM_B = 102n
const COMPLETION_CLAIM_A = 201n
const CANDIDATE_A = 301n
const EXPECTED_HEAD_A = 401n
const ACCEPTED_RESULT_COMMIT_A = 302n
const INTEGRATOR_SESSION_A = 601n
const INTEGRATION_TARGET_A = 501n
const ACCEPTED_RESULT_EVIDENCE_A = 701n
const LEGACY_EVIDENCE_A = 703n
const TRACKER_COMPLETION_REQUEST_REVISION = 10n
const STALE_TRACKER_REVISION = 10n
const FRESH_TRACKER_REVISION = 11n
const COMPLETION_CLAIM_REQUEST_LIMIT = 3n

const failTest = (message: string): never => Effect.runSync(Effect.die(message))

type Phase =
  | "PromotedProof"
  | "BlockedAfterPromotion"
  | "PostPromotionAncestryPending"
  | "PostPromotionAncestryWait"
  | "CompletionClaimBlocked"
  | "ReplacementIntentPending"
  | "ReplacementIntentRecorded"
  | "ReplacementRequested"
  | "ReplacementResponseLost"
  | "ReplacementRetryReady"
  | "ReplacementWait"
  | "ReplacementExhausted"
  | "CompletionClaimCurrent"
  | "CompletionFactsObserved"
  | "CompletionAncestryObserved"
  | "CompletionEvidenceObserved"
  | "CompletionIntentRecorded"
  | "CompletionAttemptIntentRecorded"
  | "CompletionRequested"
  | "CompletionResponseLost"
  | "CompletionConfirmationObserved"
  | "CompletionAcknowledged"
  | "CompletionRetryReady"
  | "CompletionWait"
  | "DeleteIntentPending"
  | "DeleteIntentRecorded"
  | "DeleteRequested"
  | "DeleteResponseLost"
  | "DeleteRetryReady"
  | "DeleteResponseObserved"
  | "CleanupWait"
  | "Settled"
  | "UnrelatedPending"

type ClaimState = "OriginalClaim" | "CompletionClaim" | "ForeignClaim" | "AbsentClaim" | "UnreadableClaim"
type TrackerObservation = "NoTrackerObservation" | "StaleSuccess" | "FreshSuccess"
type MutationTarget =
  | "NoMutation"
  | "OriginalClaimMutation"
  | "CompletionClaimMutation"
  | "CompleteTaskMutation"
  | "ForeignClaimMutation"

type Proof = {
  runId: bigint
  taskId: bigint
  attemptId: bigint
  taskRevision: bigint
  integratorSession: bigint
  candidateCommit: bigint
  expectedTargetHead: bigint
  acceptedResultCommit: bigint
  candidateFirstParent: bigint
  candidateSecondParent: bigint
  integrationTarget: bigint
  acceptedResultEvidence: bigint
  integratorReturnedEvidenceRefs: ReadonlySet<bigint>
}

type CompletionClaim = {
  claimId: bigint
  runId: bigint
  taskId: bigint
  attemptId: bigint
  taskRevision: bigint
  integratorSession: bigint
  predecessorClaimId: bigint
  candidateCommit: bigint
  expectedTargetHead: bigint
  acceptedResultCommit: bigint
  candidateFirstParent: bigint
  candidateSecondParent: bigint
  acceptedResultEvidence: bigint
  integratorReturnedEvidenceRefs: ReadonlySet<bigint>
}

type Subject = {
  taskId: bigint
  attemptId: bigint
  taskRevision: bigint
  originalClaimId: bigint
  currentClaimId: bigint
  claimState: ClaimState
  phase: Phase
  proofPresent: boolean
  proof: Proof
  completionClaimDerived: boolean
  completionClaim: CompletionClaim
  legacyEvidenceForged: boolean
  replacementIntentRecorded: boolean
  replacementRequests: bigint
  replacementReads: bigint
  replacementReadBeforeRetry: boolean
  replacementOutcomeRecorded: boolean
  deleteIntentRecorded: boolean
  deleteRequests: bigint
  deleteReads: bigint
  deleteReadBeforeRetry: boolean
  deletionOutcomeRecorded: boolean
  deletionFailureRecorded: boolean
  trackerObservation: TrackerObservation
  trackerCompletionRequestRevision: bigint
  trackerObservationRevision: bigint
  freshTrackerSuccess: boolean
  trackerSuccessEver: boolean
  focusedSuccessRecorded: boolean
  successSource: string
  focusedFactsRecorded: boolean
  focusedFactsOpen: boolean
  focusedFactsNoBlocker: boolean
  completionAncestry: string
  completionEvidenceRecorded: boolean
  completionRequestId: bigint
  completionIntentRecorded: boolean
  completionAttemptIntents: bigint
  completionOpenConfirmationRecorded: boolean
  completionConfirmationViolationLookups: bigint
  completionRequests: bigint
  completionPremiseViolationCalls: bigint
  completionReads: bigint
  completionNotAppliedReads: bigint
  completionOutcome: string
  completeTaskAcknowledged: boolean
  completionConflict: string
  completeGraphObservation: string
  dependantEligible: boolean
  responsibilityHeld: boolean
  settled: boolean
  foreignMutationCount: bigint
  reintegrationCount: bigint
  lastMutation: MutationTarget
  blockerPresent: boolean
  reopenedAfterSuccess: boolean
}

type ModelState = {
  promoted: Subject
  unrelated: Subject
  frontierEmpty: boolean
  runTerminated: boolean
  completeTaskRequests: bigint
  dependantReleases: bigint
  reintegrationRequests: bigint
}

const proofForA: Proof = {
  runId: RUN_ID,
  taskId: TASK_A,
  attemptId: ATTEMPT_A,
  taskRevision: TASK_REVISION_A,
  integratorSession: INTEGRATOR_SESSION_A,
  candidateCommit: CANDIDATE_A,
  expectedTargetHead: EXPECTED_HEAD_A,
  acceptedResultCommit: ACCEPTED_RESULT_COMMIT_A,
  candidateFirstParent: EXPECTED_HEAD_A,
  candidateSecondParent: ACCEPTED_RESULT_COMMIT_A,
  integrationTarget: INTEGRATION_TARGET_A,
  acceptedResultEvidence: ACCEPTED_RESULT_EVIDENCE_A,
  integratorReturnedEvidenceRefs: new Set()
}

const emptyCompletionClaim: CompletionClaim = {
  claimId: 0n,
  runId: 0n,
  taskId: 0n,
  attemptId: 0n,
  taskRevision: 0n,
  integratorSession: 0n,
  predecessorClaimId: 0n,
  candidateCommit: 0n,
  expectedTargetHead: 0n,
  acceptedResultCommit: 0n,
  candidateFirstParent: 0n,
  candidateSecondParent: 0n,
  acceptedResultEvidence: 0n,
  integratorReturnedEvidenceRefs: new Set()
}

const subjectA = (): Subject => ({
  taskId: TASK_A,
  attemptId: ATTEMPT_A,
  taskRevision: TASK_REVISION_A,
  originalClaimId: ORIGINAL_CLAIM_A,
  currentClaimId: ORIGINAL_CLAIM_A,
  claimState: "OriginalClaim",
  phase: "PromotedProof",
  proofPresent: true,
  proof: proofForA,
  completionClaimDerived: false,
  completionClaim: emptyCompletionClaim,
  legacyEvidenceForged: false,
  replacementIntentRecorded: false,
  replacementRequests: 0n,
  replacementReads: 0n,
  replacementReadBeforeRetry: false,
  replacementOutcomeRecorded: false,
  deleteIntentRecorded: false,
  deleteRequests: 0n,
  deleteReads: 0n,
  deleteReadBeforeRetry: false,
  deletionOutcomeRecorded: false,
  deletionFailureRecorded: false,
  trackerObservation: "NoTrackerObservation",
  trackerCompletionRequestRevision: TRACKER_COMPLETION_REQUEST_REVISION,
  trackerObservationRevision: 0n,
  freshTrackerSuccess: false,
  trackerSuccessEver: false,
  focusedSuccessRecorded: false,
  successSource: "NoSuccess",
  focusedFactsRecorded: false,
  focusedFactsOpen: false,
  focusedFactsNoBlocker: false,
  completionAncestry: "NoCandidateAncestry",
  completionEvidenceRecorded: false,
  completionRequestId: 0n,
  completionIntentRecorded: false,
  completionAttemptIntents: 0n,
  completionOpenConfirmationRecorded: false,
  completionConfirmationViolationLookups: 0n,
  completionRequests: 0n,
  completionPremiseViolationCalls: 0n,
  completionReads: 0n,
  completionNotAppliedReads: 0n,
  completionOutcome: "NoCompletionOutcome",
  completeTaskAcknowledged: false,
  completionConflict: "NoCompletionConflict",
  completeGraphObservation: "NoCompleteGraph",
  dependantEligible: false,
  responsibilityHeld: true,
  settled: false,
  foreignMutationCount: 0n,
  reintegrationCount: 0n,
  lastMutation: "NoMutation",
  blockerPresent: false,
  reopenedAfterSuccess: false
})

const subjectB = (): Subject => ({
  taskId: TASK_B,
  attemptId: ATTEMPT_B,
  taskRevision: TASK_REVISION_B,
  originalClaimId: ORIGINAL_CLAIM_B,
  currentClaimId: ORIGINAL_CLAIM_B,
  claimState: "OriginalClaim",
  phase: "UnrelatedPending",
  proofPresent: false,
  proof: {
    runId: 0n,
    taskId: TASK_B,
    attemptId: ATTEMPT_B,
    taskRevision: TASK_REVISION_B,
    integratorSession: 0n,
    candidateCommit: 0n,
    expectedTargetHead: 0n,
    acceptedResultCommit: 0n,
    candidateFirstParent: 0n,
    candidateSecondParent: 0n,
    integrationTarget: 0n,
    acceptedResultEvidence: 0n,
    integratorReturnedEvidenceRefs: new Set()
  },
  completionClaimDerived: false,
  completionClaim: emptyCompletionClaim,
  legacyEvidenceForged: false,
  replacementIntentRecorded: false,
  replacementRequests: 0n,
  replacementReads: 0n,
  replacementReadBeforeRetry: false,
  replacementOutcomeRecorded: false,
  deleteIntentRecorded: false,
  deleteRequests: 0n,
  deleteReads: 0n,
  deleteReadBeforeRetry: false,
  deletionOutcomeRecorded: false,
  deletionFailureRecorded: false,
  trackerObservation: "NoTrackerObservation",
  trackerCompletionRequestRevision: 0n,
  trackerObservationRevision: 0n,
  freshTrackerSuccess: false,
  trackerSuccessEver: false,
  focusedSuccessRecorded: false,
  successSource: "NoSuccess",
  focusedFactsRecorded: false,
  focusedFactsOpen: false,
  focusedFactsNoBlocker: false,
  completionAncestry: "NoCandidateAncestry",
  completionEvidenceRecorded: false,
  completionRequestId: 0n,
  completionIntentRecorded: false,
  completionAttemptIntents: 0n,
  completionOpenConfirmationRecorded: false,
  completionConfirmationViolationLookups: 0n,
  completionRequests: 0n,
  completionPremiseViolationCalls: 0n,
  completionReads: 0n,
  completionNotAppliedReads: 0n,
  completionOutcome: "NoCompletionOutcome",
  completeTaskAcknowledged: false,
  completionConflict: "NoCompletionConflict",
  completeGraphObservation: "NoCompleteGraph",
  dependantEligible: false,
  responsibilityHeld: true,
  settled: false,
  foreignMutationCount: 0n,
  reintegrationCount: 0n,
  lastMutation: "NoMutation",
  blockerPresent: false,
  reopenedAfterSuccess: false
})

const initialState = (): ModelState => ({
  promoted: subjectA(),
  unrelated: subjectB(),
  frontierEmpty: false,
  runTerminated: false,
  completeTaskRequests: 0n,
  dependantReleases: 0n,
  reintegrationRequests: 0n
})

const SpecSubject = Schema.Struct({
  attemptId: ITFBigInt,
  blockerPresent: Schema.Boolean,
  claimState: Schema.Unknown,
  completionClaim: Schema.Unknown,
  completionClaimDerived: Schema.Boolean,
  completionAncestry: Schema.Unknown,
  legacyEvidenceForged: Schema.Boolean,
  completionAttemptIntents: ITFBigInt,
  completionOpenConfirmationRecorded: Schema.Boolean,
  completionConfirmationViolationLookups: ITFBigInt,
  completionConflict: Schema.Unknown,
  completionEvidenceRecorded: Schema.Boolean,
  completionIntentRecorded: Schema.Boolean,
  completionOutcome: Schema.Unknown,
  completionNotAppliedReads: ITFBigInt,
  completionReads: ITFBigInt,
  completionRequestId: ITFBigInt,
  completionPremiseViolationCalls: ITFBigInt,
  completionRequests: ITFBigInt,
  completeGraphObservation: Schema.Unknown,
  completeTaskAcknowledged: Schema.Boolean,
  dependantEligible: Schema.Boolean,
  currentClaimId: ITFBigInt,
  deleteIntentRecorded: Schema.Boolean,
  deleteReadBeforeRetry: Schema.Boolean,
  deleteReads: ITFBigInt,
  deleteRequests: ITFBigInt,
  deletionFailureRecorded: Schema.Boolean,
  deletionOutcomeRecorded: Schema.Boolean,
  foreignMutationCount: ITFBigInt,
  freshTrackerSuccess: Schema.Boolean,
  focusedFactsNoBlocker: Schema.Boolean,
  focusedFactsOpen: Schema.Boolean,
  focusedFactsRecorded: Schema.Boolean,
  focusedSuccessRecorded: Schema.Boolean,
  lastMutation: Schema.Unknown,
  phase: Schema.Unknown,
  proof: Schema.Unknown,
  proofPresent: Schema.Boolean,
  reopenedAfterSuccess: Schema.Boolean,
  reintegrationCount: ITFBigInt,
  replacementIntentRecorded: Schema.Boolean,
  replacementOutcomeRecorded: Schema.Boolean,
  replacementReadBeforeRetry: Schema.Boolean,
  replacementReads: ITFBigInt,
  replacementRequests: ITFBigInt,
  responsibilityHeld: Schema.Boolean,
  settled: Schema.Boolean,
  taskId: ITFBigInt,
  taskRevision: ITFBigInt,
  trackerCompletionRequestRevision: ITFBigInt,
  trackerObservation: Schema.Unknown,
  trackerObservationRevision: ITFBigInt,
  trackerSuccessEver: Schema.Boolean,
  successSource: Schema.Unknown
})

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    completeTaskRequests: ITFBigInt,
    dependantReleases: ITFBigInt,
    frontierEmpty: Schema.Boolean,
    promoted: SpecSubject,
    reintegrationRequests: ITFBigInt,
    runTerminated: Schema.Boolean,
    unrelated: Schema.Struct({
      phase: Schema.Unknown,
      responsibilityHeld: Schema.Boolean,
      settled: Schema.Boolean,
      taskId: ITFBigInt
    })
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

const quintInt = (value: unknown): bigint =>
  typeof value === "object" && value !== null && "#bigint" in value
    ? BigInt(String(value["#bigint"]))
    : BigInt(value as number)

const quintEvidenceSet = (value: unknown): string => {
  const entries =
    typeof value === "object" && value !== null && "#set" in value
      ? value["#set"]
      : value instanceof Set
        ? [...value]
        : undefined
  if (!Array.isArray(entries)) return String(value)
  return `{${entries
    .map(quintInt)
    .toSorted((left, right) => (left < right ? -1 : 1))
    .join("|")}}`
}

const normalizedProof = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return String(value)
  const fields = [
    "runId",
    "taskId",
    "attemptId",
    "taskRevision",
    "integratorSession",
    "candidateCommit",
    "expectedTargetHead",
    "acceptedResultCommit",
    "candidateFirstParent",
    "candidateSecondParent",
    "integrationTarget",
    "acceptedResultEvidence"
  ]
  return `${fields.map((field) => `${field}=${quintInt(Reflect.get(value, field))}`).join(",")},integratorReturnedEvidenceRefs=${quintEvidenceSet(Reflect.get(value, "integratorReturnedEvidenceRefs"))}`
}

const normalizedCompletionClaim = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return String(value)
  const fields = [
    "claimId",
    "runId",
    "taskId",
    "attemptId",
    "taskRevision",
    "integratorSession",
    "predecessorClaimId",
    "candidateCommit",
    "expectedTargetHead",
    "acceptedResultCommit",
    "candidateFirstParent",
    "candidateSecondParent",
    "acceptedResultEvidence"
  ]
  return `${fields.map((field) => `${field}=${quintInt(Reflect.get(value, field))}`).join(",")},integratorReturnedEvidenceRefs=${quintEvidenceSet(Reflect.get(value, "integratorReturnedEvidenceRefs"))}`
}

const normalizedSubject = (subject: Subject | Schema.Schema.Type<typeof SpecSubject>) => ({
  attemptId: quintInt(subject.attemptId),
  blockerPresent: subject.blockerPresent,
  claimState: variantTag(subject.claimState),
  completionClaim: normalizedCompletionClaim(subject.completionClaim),
  completionClaimDerived: subject.completionClaimDerived,
  completionAncestry: variantTag(subject.completionAncestry),
  legacyEvidenceForged: subject.legacyEvidenceForged,
  completionAttemptIntents: quintInt(subject.completionAttemptIntents),
  completionOpenConfirmationRecorded: subject.completionOpenConfirmationRecorded,
  completionConfirmationViolationLookups: quintInt(subject.completionConfirmationViolationLookups),
  completionConflict: variantTag(subject.completionConflict),
  completionEvidenceRecorded: subject.completionEvidenceRecorded,
  completionIntentRecorded: subject.completionIntentRecorded,
  completionOutcome: variantTag(subject.completionOutcome),
  completionNotAppliedReads: subject.completionNotAppliedReads,
  completionReads: quintInt(subject.completionReads),
  completionRequestId: quintInt(subject.completionRequestId),
  completionPremiseViolationCalls: subject.completionPremiseViolationCalls,
  completionRequests: quintInt(subject.completionRequests),
  completeGraphObservation: variantTag(subject.completeGraphObservation),
  completeTaskAcknowledged: subject.completeTaskAcknowledged,
  currentClaimId: quintInt(subject.currentClaimId),
  deleteIntentRecorded: subject.deleteIntentRecorded,
  deleteReadBeforeRetry: subject.deleteReadBeforeRetry,
  deleteReads: quintInt(subject.deleteReads),
  deleteRequests: quintInt(subject.deleteRequests),
  deletionFailureRecorded: subject.deletionFailureRecorded,
  deletionOutcomeRecorded: subject.deletionOutcomeRecorded,
  foreignMutationCount: quintInt(subject.foreignMutationCount),
  freshTrackerSuccess: subject.freshTrackerSuccess,
  focusedFactsNoBlocker: subject.focusedFactsNoBlocker,
  focusedFactsOpen: subject.focusedFactsOpen,
  focusedFactsRecorded: subject.focusedFactsRecorded,
  focusedSuccessRecorded: subject.focusedSuccessRecorded,
  lastMutation: variantTag(subject.lastMutation),
  phase: variantTag(subject.phase),
  proof: normalizedProof(subject.proof),
  proofPresent: subject.proofPresent,
  reopenedAfterSuccess: subject.reopenedAfterSuccess,
  reintegrationCount: quintInt(subject.reintegrationCount),
  replacementIntentRecorded: subject.replacementIntentRecorded,
  replacementOutcomeRecorded: subject.replacementOutcomeRecorded,
  replacementReadBeforeRetry: subject.replacementReadBeforeRetry,
  replacementReads: quintInt(subject.replacementReads),
  replacementRequests: quintInt(subject.replacementRequests),
  responsibilityHeld: subject.responsibilityHeld,
  settled: subject.settled,
  taskId: quintInt(subject.taskId),
  taskRevision: quintInt(subject.taskRevision),
  trackerCompletionRequestRevision: quintInt(subject.trackerCompletionRequestRevision),
  trackerObservation: variantTag(subject.trackerObservation),
  trackerObservationRevision: quintInt(subject.trackerObservationRevision),
  trackerSuccessEver: subject.trackerSuccessEver,
  dependantEligible: subject.dependantEligible
})

const integrationAttempt = integrationFinalityFixture.plannedAttempt

// Promotion and finality consume the outer Integrator's Git-qualified candidate
// and its derived TargetPromotionCorrelation. The candidate resource/text are
// retained only inside this correlation; finality rereads accepted-result bytes
// rather than any target-verification-owned manifests.
const productionQualifiedCandidate: IntegratorRunQualifiedCandidate = integrationFinalityFixture.qualifiedCandidate
const productionPromotionCorrelation: TargetPromotionCorrelation = integrationFinalityFixture.promotionCorrelation

const integrationResponsibility: WorkflowResponsibilityEntry = {
  _tag: "PlannedAttemptExecutorWorkResponsibility",
  beganAt: JournalPosition.make(1),
  plannedAttempt: integrationAttempt
}

const productionClaimIdentity: CompletionTaskClaim = integrationFinalityFixture.claim
const productionCompletionRequest = completionTaskRequestFor(productionClaimIdentity)

const encodeEvidence = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const productionEvidenceObjects = new Map([
  [
    productionCompletionRequest.claim.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult
      .evidenceManifest.digest,
    encodeEvidence(
      AcceptedResultEvidenceManifest.make({
        commit:
          productionCompletionRequest.claim.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult.commit,
        correlation: {
          attemptId: productionCompletionRequest.claim.plannedAttempt.attemptId,
          runId: productionCompletionRequest.claim.plannedAttempt.runId
        },
        formatVersion: 1,
        outcome: "Accepted",
        predecessor: null
      })
    )
  ]
] as const)

const dependantTaskId = TaskId.make("integration-finality-dependant")
const concurrentBlockerTaskId = TaskId.make("integration-finality-concurrent-blocker")

const completeGraphEvent = (outcome: "Blocked" | "Released", observationOrdinal: number) => {
  const observationIdentity = `${outcome}:${observationOrdinal}`
  const operationId = OperationId.make(`integration-finality-complete-graph:${observationIdentity}`)
  const graph = projectTrackerSnapshot({
    revision: TrackerRevision.make(`integration-finality-complete-graph:${observationIdentity}`),
    tasks: [
      {
        id: productionClaimIdentity.plannedAttempt.taskId,
        lifecycle: TaskLifecycle.cases.CompletedSuccessfully.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      },
      {
        id: concurrentBlockerTaskId,
        lifecycle:
          outcome === "Released"
            ? TaskLifecycle.cases.CompletedSuccessfully.make({})
            : TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      },
      {
        id: dependantTaskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: [productionClaimIdentity.plannedAttempt.taskId, concurrentBlockerTaskId]
      }
    ]
  })
  const snapshot = Option.getOrThrow(graph._tag === "Valid" ? Option.some(graph.snapshot) : Option.none())
  const operation = makeTrackerGraphObservationOperation(
    operationId,
    integrationFinalityFixture.target,
    [],
    [productionClaimIdentity.plannedAttempt.taskId, concurrentBlockerTaskId, dependantTaskId]
  )
  return {
    event: TaskTrackerFactsObservedEvent.make({
      observation: makeCompleteTaskTrackerFactsObserved(operation, snapshot),
      operationId,
      version: workflowJournalEventVersion
    }),
    operation,
    snapshot
  } as const
}

type ProductionMutationDisposition = "Applied" | "Rejected"
type CompletionMutationDisposition = "Acknowledged" | "DefinitelyRejected" | "ResponseLost"
type CompletionLookupDisposition = "Applied" | "NotApplied" | "Unreadable"
type CompletionAncestryDisposition = "Current" | "NotAncestor" | "Unreadable"

const workflowJournalEventsEqual = (left: WorkflowJournalEvent, right: WorkflowJournalEvent): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(left)) ===
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(right))

const promotionRecord = (): JournalRecord => ({
  event: integrationFinalityFixture.promotionSuccess,
  key: targetPromotionObservedSuccessRecordKey(productionClaimIdentity.promotionCorrelation.requestId),
  position: JournalPosition.make(1),
  runId: productionClaimIdentity.plannedAttempt.runId
})

// Every model trace owns one deterministic production journal and one tracker
// boundary. Protocol calls below append their own intents, attempts, outcomes,
// and settlement records; no finality records are reconstructed from model state.
const makeProductionState = () => {
  let records: ReadonlyArray<JournalRecord> = []
  let claimObservation: CompletionClaimObservation = productionClaimIdentity.originalClaim
  let replacementDisposition: ProductionMutationDisposition = "Rejected"
  let deletionDisposition: ProductionMutationDisposition = "Rejected"
  let successObservation: CompletionSuccessObservation | undefined
  let completionDisposition: CompletionMutationDisposition = "Acknowledged"
  let completionLookupDisposition: CompletionLookupDisposition = "Applied"
  let focusedLifecycle: "CompletedSuccessfully" | "Open" | "TerminalWithoutSuccess" = "Open"
  let focusedTaskId = productionCompletionRequest.taskId
  let focusedTaskRevision = productionCompletionRequest.taskRevision
  let completionAncestryDisposition: CompletionAncestryDisposition = "Current"
  let confirmationReadUnavailable = false
  let blockedAppendTag: JournalRecord["event"]["_tag"] | undefined
  let pauseCompletionAttemptIntent = false
  let completionAttemptIntentSignal = Deferred.makeUnsafe<void>()
  let completionAttemptIntentGate = Deferred.makeUnsafe<void>()
  let completionCallSignal = Deferred.makeUnsafe<void>()
  let completionResponse = Deferred.makeUnsafe<CompletionMutationDisposition>()
  let pendingCompletion: Fiber.Fiber<unknown, unknown> | undefined
  let completionBoundaryCalls = 0
  let completionEvidenceReads = 0

  const journal = InRunJournal.of({
    append: (runId, key, event) =>
      event._tag === blockedAppendTag
        ? Effect.fail(
            new JournalStorageUnavailable({
              detail: `conformance cut before ${event._tag}`,
              operation: "JournalStore.append"
            })
          )
        : Effect.suspend(() => {
            const existing = records.find((record) => record.runId === runId && record.key === key)
            if (existing !== undefined) {
              return workflowJournalEventsEqual(existing.event, event)
                ? Effect.succeed(existing)
                : Effect.fail(new JournalStoreContradiction({ existingPosition: existing.position, key, runId }))
            }
            const record: JournalRecord = { event, key, position: JournalPosition.make(records.length + 1), runId }
            records = [...records, record]
            return pauseCompletionAttemptIntent && event._tag === "CompletionTaskAttemptIntended"
              ? Effect.gen(function* () {
                  pauseCompletionAttemptIntent = false
                  yield* Deferred.succeed(completionAttemptIntentSignal, undefined)
                  yield* Deferred.await(completionAttemptIntentGate)
                  return record
                })
              : Effect.succeed(record)
          }),
    read: (runId) => Effect.sync(() => records.filter((record) => record.runId === runId))
  })

  const boundary = CompletionClaimBoundary.of({
    readTaskClaim: (request) =>
      Effect.sync(() =>
        request.taskId === productionClaimIdentity.plannedAttempt.taskId
          ? claimObservation
          : UnclaimedTask.make({ taskId: request.taskId })
      ),
    replaceTaskClaim: (request) =>
      replacementDisposition === "Applied"
        ? Effect.sync(() => {
            claimObservation = request.claim
            return request.claim
          })
        : Effect.fail(
            new CompletionClaimReplacementFailure({
              detail: "model boundary withheld the replacement response",
              outcome: "DefinitelyNotApplied",
              request
            })
          ),
    deleteTaskClaim: (request) =>
      deletionDisposition === "Applied"
        ? Effect.sync(() => {
            claimObservation = UnclaimedTask.make({ taskId: request.claim.plannedAttempt.taskId })
          })
        : Effect.fail(
            new CompletionClaimDeletionFailure({
              detail: "model boundary withheld the deletion response",
              outcome: "DefinitelyNotApplied",
              request
            })
          )
  })

  const completionBoundary: CompletionTaskBoundaryService = {
    readFocusedTaskCompletion: (readRequest) =>
      confirmationReadUnavailable && String(readRequest.operationId).includes(":confirmation:")
        ? Effect.fail(
            new FocusedTaskCompletionReadFailure({
              detail: "conformance cut after the lost completion response",
              taskId: readRequest.taskId
            })
          )
        : Effect.succeed({
            currentClaim: claimObservation,
            lifecycle: focusedLifecycle,
            operationId: readRequest.operationId,
            target: readRequest.target,
            targetMembership: "Member",
            taskId: focusedTaskId,
            taskRevision: focusedTaskRevision,
            trackerRevision: TrackerRevision.make(`completion-facts:${readRequest.operationId}`),
            unfinishedPrerequisiteTaskIds: []
          }),
    completeTask: (request) =>
      Effect.gen(function* () {
        completionBoundaryCalls += 1
        if (pendingCompletion !== undefined) {
          yield* Deferred.succeed(completionCallSignal, undefined)
          completionDisposition = yield* Deferred.await(completionResponse)
        }
        if (completionDisposition === "Acknowledged") {
          focusedLifecycle = "CompletedSuccessfully"
          return CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
        }
        return yield* new CompletionTaskRequestFailure({
          detail:
            completionDisposition === "ResponseLost"
              ? "conformance completion response lost"
              : "conformance completion request rejected",
          outcome: completionDisposition === "ResponseLost" ? "Unknown" : "DefinitelyNotApplied",
          request
        })
      }),
    readCompletionRequest: (request) =>
      Effect.succeed(
        completionLookupDisposition === "Unreadable"
          ? CompletionTaskRequestLookup.cases.Unreadable.make({
              detail: "conformance completion lookup unreadable",
              request
            })
          : CompletionTaskRequestLookup.cases[completionLookupDisposition].make({ request })
      )
  }

  const evidenceStore = EvidenceStore.of({
    put: () => Effect.die("completion conformance never publishes evidence"),
    read: (reference) => {
      completionEvidenceReads += 1
      const bytes = productionEvidenceObjects.get(reference.digest)
      return bytes === undefined ? Effect.die(`missing completion evidence ${reference.digest}`) : Effect.succeed(bytes)
    }
  })

  const promotionGit = TargetPromotionGit.of({
    compareAndSet: () => Effect.die("completion conformance never mutates Git"),
    read: (request) =>
      completionAncestryDisposition === "Unreadable"
        ? Effect.fail(
            new TargetPromotionGitReadFailure({
              candidateCommit: request.candidateCommit,
              detail: "conformance target ancestry is unreadable",
              target: request.integrationTarget
            })
          )
        : Effect.succeed(
            TargetPromotionGitReadObservation.cases[
              completionAncestryDisposition === "Current" ? "CandidateCurrent" : "CandidateNotInAncestry"
            ].make({ currentHeadSha: request.candidateCommit })
          )
  })

  const provideCompletionRuntime = <A, E>(
    effect: Effect.Effect<A, E, InRunJournal | EvidenceStore | TargetPromotionGit>
  ): Effect.Effect<A, E> =>
    effect.pipe(
      Effect.provideService(InRunJournal, journal),
      Effect.provideService(EvidenceStore, evidenceStore),
      Effect.provideService(TargetPromotionGit, promotionGit)
    )

  const completionAuthorization = (maximumOrdinal: number) => (ordinal: CompletionTaskRequestOrdinal) =>
    Number(ordinal) > maximumOrdinal
      ? Effect.fail(
          new CompletionTaskAuthorizationWait({
            detail: "conformance cut before the next numbered completion call",
            reason: "FocusedFactsUnavailable",
            request: productionCompletionRequest
          })
        )
      : authorizeCompletionTaskAttempt(
          completionBoundary,
          productionCompletionRequest,
          integrationFinalityFixture.target,
          ordinal
        )

  const productionCompletionEffect = (maximumOrdinal: number) =>
    provideCompletionRuntime(
      runCompletionTaskProtocol(
        completionBoundary,
        productionCompletionRequest,
        integrationFinalityFixture.target,
        completionAuthorization(maximumOrdinal)
      )
    )

  const runProductionCompletion = (maximumOrdinal: number): void => {
    Effect.runSyncExit(productionCompletionEffect(maximumOrdinal))
  }

  const observeFocusedAuthorization = (ordinal: number): void => {
    confirmationReadUnavailable = false
    const authorizationOrdinal =
      records.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadCompletionTaskFacts" &&
          event.operation.purpose._tag === "Authorization" &&
          Number(event.operation.purpose.attemptOrdinal) === ordinal
      ).length + 1
    Effect.runSync(
      provideCompletionRuntime(
        readCompletionFocusedFacts(
          completionBoundary,
          productionCompletionRequest,
          integrationFinalityFixture.target,
          CompletionTaskFocusedReadPurpose.cases.Authorization.make({
            attemptOrdinal: CompletionTaskRequestOrdinal.make(ordinal),
            authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(authorizationOrdinal)
          })
        )
      )
    )
  }

  const observeFocusedConflict = (kind: "ForeignTask" | "ReopenedTask" | "RevisionConflict", ordinal: number): void => {
    focusedTaskId =
      kind === "ForeignTask" ? TaskId.make("integration-finality-foreign-task") : productionCompletionRequest.taskId
    focusedTaskRevision =
      kind === "RevisionConflict"
        ? TaskRevision.make("integration-finality-conflicting-revision")
        : productionCompletionRequest.taskRevision
    focusedLifecycle = kind === "ReopenedTask" ? "TerminalWithoutSuccess" : "Open"
    const priorFocusedEvent = records.findLast(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.purpose._tag === "Authorization" &&
        Number(event.observation.purpose.attemptOrdinal) === ordinal
    )?.event
    if (
      priorFocusedEvent?._tag !== "TaskTrackerFactsObserved" ||
      priorFocusedEvent.observation._tag !== "FocusedTaskCompletionFacts"
    ) {
      return failTest("production conflict requires a durable focused task observation")
    }
    const focusedFacts =
      kind === "ForeignTask"
        ? Effect.runSync(
            completionBoundary.readFocusedTaskCompletion(
              FocusedTaskCompletionReadRequest.make({
                expectedClaim: productionCompletionRequest.claim,
                operationId: priorFocusedEvent.operationId,
                target: integrationFinalityFixture.target,
                taskId: productionCompletionRequest.taskId
              })
            )
          )
        : (() => {
            observeFocusedAuthorization(ordinal)
            const focusedEvent = records.findLast(
              ({ event }) =>
                event._tag === "TaskTrackerFactsObserved" &&
                event.observation._tag === "FocusedTaskCompletionFacts" &&
                event.observation.purpose._tag === "Authorization" &&
                Number(event.observation.purpose.attemptOrdinal) === ordinal
            )?.event
            if (
              focusedEvent?._tag !== "TaskTrackerFactsObserved" ||
              focusedEvent.observation._tag !== "FocusedTaskCompletionFacts"
            ) {
              return failTest("production conflict requires a durable focused task observation")
            }
            return focusedEvent.observation.facts
          })()
    const issue = completionTaskAuthorizationIssue(
      {
        candidateAncestry: "Current",
        focusedFacts,
        gitReadOperationId: OperationId.make("integration-finality-conflict-git-read"),
        target: integrationFinalityFixture.target
      },
      productionCompletionRequest
    )
    const expectedReason = kind === "ReopenedTask" ? "TaskLifecycleConflict" : "TaskIdentityOrRevisionChanged"
    if (issue?.reason !== expectedReason) {
      failTest(`production focused conflict ${kind} produced ${issue?.reason ?? "no conflict"}`)
    }
    focusedTaskId = productionCompletionRequest.taskId
    focusedTaskRevision = productionCompletionRequest.taskRevision
    focusedLifecycle = "Open"
  }

  const observeCompletionAncestry = (ordinal: number): void => {
    const purpose = records.findLast(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadCompletionTaskFacts" &&
        event.operation.purpose._tag === "Authorization" &&
        Number(event.operation.purpose.attemptOrdinal) === ordinal
    )?.event
    if (
      purpose?._tag !== "TaskTrackerReadIntentRecorded" ||
      purpose.operation._tag !== "ReadCompletionTaskFacts" ||
      purpose.operation.purpose._tag !== "Authorization"
    ) {
      return failTest("production ancestry read requires the matching focused authorization cycle")
    }
    Effect.runSync(
      provideCompletionRuntime(readCompletionCandidateAncestry(productionCompletionRequest, purpose.operation.purpose))
    )
  }

  const observeCompletionAncestryResult = (
    disposition: Exclude<CompletionAncestryDisposition, "Current">,
    ordinal: number
  ): void => {
    const purpose = records.findLast(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadCompletionTaskFacts" &&
        event.operation.purpose._tag === "Authorization" &&
        Number(event.operation.purpose.attemptOrdinal) === ordinal
    )?.event
    if (
      purpose?._tag !== "TaskTrackerReadIntentRecorded" ||
      purpose.operation._tag !== "ReadCompletionTaskFacts" ||
      purpose.operation.purpose._tag !== "Authorization"
    ) {
      return failTest("production ancestry read requires the matching focused authorization cycle")
    }
    completionAncestryDisposition = disposition
    const exit = Effect.runSyncExit(
      provideCompletionRuntime(readCompletionCandidateAncestry(productionCompletionRequest, purpose.operation.purpose))
    )
    completionAncestryDisposition = "Current"
    if (disposition === "Unreadable") {
      if (exit._tag !== "Failure") failTest("unreadable production ancestry unexpectedly succeeded")
      return
    }
    if (exit._tag !== "Success" || exit.value.observation._tag !== "CandidateNotInAncestry") {
      failTest("production ancestry did not preserve the candidate-not-ancestor result")
    }
  }

  const observeCompletionEvidence = (): void => {
    Effect.runSync(provideCompletionRuntime(rereadCompletionEvidence(productionCompletionRequest)))
  }

  const recordCompletionIntentCutPoint = (ordinal: number): void => {
    blockedAppendTag = "CompletionTaskAttemptIntended"
    runProductionCompletion(ordinal)
    blockedAppendTag = undefined
  }

  const recordCompletionAttemptIntentCutPoint = (ordinal: number) =>
    Effect.gen(function* () {
      completionAttemptIntentSignal = Deferred.makeUnsafe<void>()
      completionAttemptIntentGate = Deferred.makeUnsafe<void>()
      completionCallSignal = Deferred.makeUnsafe<void>()
      completionResponse = Deferred.makeUnsafe<CompletionMutationDisposition>()
      pauseCompletionAttemptIntent = true
      pendingCompletion = yield* productionCompletionEffect(ordinal).pipe(Effect.forkDetach({ startImmediately: true }))
      yield* Deferred.await(completionAttemptIntentSignal)
    })

  const crossCompletionBoundaryCutPoint = () =>
    Deferred.succeed(completionAttemptIntentGate, undefined).pipe(
      Effect.andThen(Deferred.await(completionCallSignal)),
      Effect.asVoid
    )

  const observeFocusedCompletionOpenAfterLossCutPoint = (ordinal: number): void => {
    focusedLifecycle = "Open"
    confirmationReadUnavailable = false
    blockedAppendTag = "CompletionTaskRequestLookupIntended"
    runProductionCompletion(ordinal)
    blockedAppendTag = undefined
    if (
      !records.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskCompletionFacts" &&
          event.observation.purpose._tag === "Confirmation" &&
          Number(event.observation.purpose.attemptOrdinal) === ordinal &&
          event.observation.facts.lifecycle === "Open"
      )
    ) {
      failTest(`production did not retain open completion confirmation ${ordinal}`)
    }
  }

  const invokeCompletion = (disposition: CompletionMutationDisposition, maximumOrdinal: number) =>
    Effect.gen(function* () {
      completionDisposition = disposition
      confirmationReadUnavailable = disposition === "ResponseLost"
      if (pendingCompletion === undefined) {
        runProductionCompletion(maximumOrdinal)
      } else {
        yield* Deferred.succeed(completionResponse, disposition)
        yield* Fiber.await(pendingCompletion)
        pendingCompletion = undefined
      }
      confirmationReadUnavailable = false
    })

  const reconcileCompletion = (disposition: CompletionLookupDisposition, attemptedOrdinal: number): void => {
    completionLookupDisposition = disposition
    focusedLifecycle = "Open"
    focusedTaskId = productionCompletionRequest.taskId
    focusedTaskRevision = productionCompletionRequest.taskRevision
    confirmationReadUnavailable = false
    runProductionCompletion(attemptedOrdinal)
  }

  const observeFocusedCompletionSuccess = (observation: CompletionClaimObservation): void => {
    claimObservation = observation
    focusedLifecycle = "CompletedSuccessfully"
    if (
      !records.some(
        ({ event }) =>
          event._tag === "CompletionTaskIntended" &&
          event.request.operationId === productionCompletionRequest.operationId
      )
    ) {
      const intent = CompletionTaskIntendedEvent.make({
        request: productionCompletionRequest,
        version: workflowJournalEventVersion
      })
      Effect.runSync(
        journal.append(productionClaimIdentity.plannedAttempt.runId, describeJournalEvent(intent).expectedKey, intent)
      )
    }
    const attemptedOrdinal = Math.max(
      1,
      records.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended").length
    )
    const confirmationOrdinal =
      records.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadCompletionTaskFacts" &&
          event.operation.purpose._tag === "Confirmation" &&
          event.operation.purpose.attemptOrdinal === attemptedOrdinal
      ).length + 1
    const focused = Effect.runSync(
      provideCompletionRuntime(
        readCompletionFocusedFacts(
          completionBoundary,
          productionCompletionRequest,
          integrationFinalityFixture.target,
          CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
            attemptOrdinal: CompletionTaskRequestOrdinal.make(attemptedOrdinal),
            confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(confirmationOrdinal)
          })
        )
      )
    )
    const observationRecord = FocusedCompletedTaskObservation.make({
      claim: productionCompletionRequest.claim,
      lifecycle: "CompletedSuccessfully",
      observedAt: focused.observedAt,
      operationId: focused.operationId,
      taskId: productionCompletionRequest.taskId,
      taskRevision: productionCompletionRequest.taskRevision,
      trackerRevision: focused.facts.trackerRevision,
      target: focused.facts.target
    })
    successObservation = observationRecord
  }

  const appendCompleteGraph = (outcome: "Blocked" | "Released"): boolean => {
    const observationOrdinal = records.filter(({ event }) => event._tag === "TaskTrackerFactsObserved").length + 1
    const { event, operation, snapshot } = completeGraphEvent(outcome, observationOrdinal)
    const intent = taskTrackerReadIntent(operation)
    const observed = Effect.runSync(
      Effect.gen(function* () {
        yield* journal.append(
          productionClaimIdentity.plannedAttempt.runId,
          describeJournalEvent(intent).expectedKey,
          intent
        )
        return yield* journal.append(
          productionClaimIdentity.plannedAttempt.runId,
          outcomeRecordKey(event.operationId),
          event
        )
      })
    )
    const graph = TrackerGraphState.cases.GraphEstablished.make({
      observation: makeTestJournaledTrackerGraphObservation({
        operationId: operation.operationId,
        recordedAt: observed.position,
        snapshot
      })
    })
    const frontier = frontierOf({
      exactEvidence: [],
      graph,
      policy: RunControlPolicy.make({
        revision: initialRunPolicyRevision,
        taskExecutionCapacity: TaskWorkCapacity.make(1)
      })
    })
    return frontier.standings.some(({ _tag, taskId }) => _tag === "Eligible" && taskId === dependantTaskId)
  }

  const appendObservedSuccess = (): void => {
    observeFocusedCompletionSuccess(productionClaimIdentity)
  }

  const invokeReplacement = (disposition: ProductionMutationDisposition): void => {
    replacementDisposition = disposition
    Effect.runSync(
      runCompletionClaimReplacementProtocol(
        boundary,
        completionClaimReplacementRequestFor(productionClaimIdentity)
      ).pipe(
        Effect.provideService(InRunJournal, journal),
        Effect.catchTags({
          "IntegrationFinality.CompletionClaimDidNotConverge": () => Effect.void,
          "IntegrationFinality.CompletionClaimOwnershipConflict": () => Effect.void,
          "IntegrationFinality.CompletionClaimReadFailure": () => Effect.void,
          "IntegrationFinality.CompletionClaimReplacementFailure": () => Effect.void
        }),
        Effect.orDie
      )
    )
  }

  const invokeDeletion = (disposition: ProductionMutationDisposition): void => {
    deletionDisposition = disposition
    if (successObservation === undefined) {
      return failTest("production deletion requires a focused task-completion observation")
    }
    Effect.runSync(
      runCompletionClaimDeletionProtocol(
        boundary,
        completionClaimDeletionRequestFor(productionClaimIdentity, successObservation),
        completionClaimReplacementRequestFor(productionClaimIdentity).operationId
      ).pipe(
        Effect.provideService(InRunJournal, journal),
        Effect.catchTags({
          "IntegrationFinality.CompletionClaimDeletionFailure": () => Effect.void,
          "IntegrationFinality.CompletionClaimDidNotConverge": () => Effect.void,
          "IntegrationFinality.CompletionClaimOwnershipConflict": () => Effect.void,
          "IntegrationFinality.CompletionClaimPremiseContradiction": () => Effect.void,
          "IntegrationFinality.CompletionClaimReadFailure": () => Effect.void,
          "IntegrationFinality.FocusedTaskCompletionSuccessRequired": () => Effect.void
        }),
        Effect.orDie
      )
    )
  }

  const reset = (): void => {
    records = [promotionRecord()]
    claimObservation = productionClaimIdentity.originalClaim
    replacementDisposition = "Rejected"
    deletionDisposition = "Rejected"
    successObservation = undefined
    completionDisposition = "Acknowledged"
    completionLookupDisposition = "Applied"
    completionAncestryDisposition = "Current"
    focusedLifecycle = "Open"
    focusedTaskId = productionCompletionRequest.taskId
    focusedTaskRevision = productionCompletionRequest.taskRevision
    confirmationReadUnavailable = false
    blockedAppendTag = undefined
    pauseCompletionAttemptIntent = false
    pendingCompletion = undefined
    completionBoundaryCalls = 0
    completionEvidenceReads = 0
  }

  const readState = () => deriveIntegrationFinalityStateFor(records, productionClaimIdentity)

  return {
    appendCompleteGraph,
    appendObservedSuccess,
    get completionBoundaryCalls(): number {
      return completionBoundaryCalls
    },
    get completionEvidenceReads(): number {
      return completionEvidenceReads
    },
    get records(): ReadonlyArray<JournalRecord> {
      return records
    },
    invokeDeletion,
    invokeCompletion,
    invokeReplacement,
    observeCompletionAncestry,
    observeCompletionAncestryResult,
    observeCompletionEvidence,
    observeFocusedAuthorization,
    observeFocusedConflict,
    observeFocusedCompletionSuccess,
    observeFocusedCompletionOpenAfterLossCutPoint,
    reconcileCompletion,
    recordCompletionIntentCutPoint,
    recordCompletionAttemptIntentCutPoint,
    crossCompletionBoundaryCutPoint,
    readState,
    reset,
    setClaimObservation: (observation: CompletionClaimObservation): void => {
      claimObservation = observation
    }
  }
}

type ProductionState = ReturnType<typeof makeProductionState>

// Every model step is checked against production protocol history, then
// against production Run finality with an unrelated responsibility held.
const assertProductionFinality = (current: ModelState, productionState: ProductionState): void => {
  if (
    productionPromotionCorrelation.qualifiedCandidate.candidateCommit !==
      productionQualifiedCandidate.candidateCommit ||
    productionPromotionCorrelation.qualifiedCandidate.candidateText !== productionQualifiedCandidate.candidateText ||
    productionPromotionCorrelation.qualifiedCandidate.qualifiedAt !== productionQualifiedCandidate.qualifiedAt ||
    productionQualifiedCandidate.directParents[0] !== productionQualifiedCandidate.run.session.expectedTargetHead ||
    productionQualifiedCandidate.directParents[1] !== productionQualifiedCandidate.run.session.acceptedResult.commit
  ) {
    failTest("production finality fixture lost the outer Integrator candidate qualification")
  }
  if (completionClaimRequestLimit !== Number(COMPLETION_CLAIM_REQUEST_LIMIT)) {
    failTest("model request bound diverges from production completion-claim request bound")
  }
  if (completionTaskRequestLimit !== Number(COMPLETION_CLAIM_REQUEST_LIMIT)) {
    failTest("model request bound diverges from production complete-task request bound")
  }
  if (!completionTaskClaimEquals(productionClaimIdentity, productionClaimIdentity)) {
    failTest("production completion-claim equality rejected an identical exact claim")
  }
  const changedPlannedAttempt = {
    ...productionClaimIdentity.plannedAttempt,
    taskRevision: TaskRevision.make("changed")
  }
  const changedCandidate = IntegratorRunQualifiedCandidate.make({
    ...productionQualifiedCandidate,
    run: {
      ...productionQualifiedCandidate.run,
      session: { ...productionQualifiedCandidate.run.session, plannedAttempt: changedPlannedAttempt }
    }
  })
  const changedClaim = CompletionTaskClaim.make({
    ...productionClaimIdentity,
    plannedAttempt: changedPlannedAttempt,
    promotionCorrelation: targetPromotionCorrelationFor(changedCandidate)
  })
  if (completionTaskClaimEquals(productionClaimIdentity, changedClaim)) {
    failTest("production completion-claim equality accepted a changed task revision")
  }

  const projected = productionState.readState()
  const projectedTag = projected?._tag
  if (projectedTag === "ReplacementPending" && current.promoted.replacementRequests === 0n) {
    failTest("production replacement protocol recorded a request before the model requested one")
  }
  if (projectedTag === "CompletionClaimReplaced" && !current.promoted.replacementOutcomeRecorded) {
    failTest("production replacement protocol settled before the model observed its response")
  }
  if (projectedTag === "DeletionPending" && !current.promoted.deleteIntentRecorded) {
    failTest("production deletion protocol recorded intent before the model recorded it")
  }
  if (
    (projectedTag === "CompletionClaimDeleted" || projectedTag === "IntegrationFinalitySettled") &&
    !current.promoted.deletionOutcomeRecorded
  ) {
    failTest("production deletion protocol settled before the model observed deletion")
  }
  if (current.promoted.settled && projectedTag !== "IntegrationFinalitySettled") {
    failTest("model settlement did not reach production integration finality")
  }

  const completionEvents = productionState.records.map(({ event }) => event._tag)
  const focusedFactsRecorded = productionState.records.some(
    ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskCompletionFacts"
  )
  if (current.promoted.focusedFactsRecorded && !focusedFactsRecorded) {
    failTest("model focused facts did not cross the production focused-read journal seam")
  }
  if (
    current.promoted.completionAncestry === "CandidateAncestor" &&
    !completionEvents.includes("CompletionTaskCandidateAncestryObserved")
  ) {
    failTest("model ancestry did not cross the production Git-read journal seam")
  }
  if (current.promoted.completionEvidenceRecorded && productionState.completionEvidenceReads < 1) {
    failTest("model evidence observation did not reread the accepted-result evidence")
  }
  if (current.promoted.completionIntentRecorded && !completionEvents.includes("CompletionTaskIntended")) {
    failTest("model Q intent was not durable in the production journal")
  }
  const modelCompletionCalls = Number(current.completeTaskRequests)
  const productionCompletionCalls = productionState.completionBoundaryCalls
  const requestCrossingIsPending = current.promoted.phase === "CompletionRequested"
  if (
    productionCompletionCalls !== modelCompletionCalls &&
    !(requestCrossingIsPending && productionCompletionCalls + 1 === modelCompletionCalls)
  ) {
    failTest("model complete-task calls diverged from the production tracker boundary")
  }
  if (current.promoted.focusedSuccessRecorded) {
    const focusedSuccessAt = productionState.records.findLastIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.facts.lifecycle === "CompletedSuccessfully"
    )
    if (focusedSuccessAt < 0) {
      failTest("model focused success was not durable in the production journal")
    }
    if (
      current.promoted.completeGraphObservation === "GraphBlocked" ||
      current.promoted.completeGraphObservation === "GraphReleased"
    ) {
      const graphAt = productionState.records.findLastIndex(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.operationId !== integrationFinalityFixture.graphOperation.operationId
      )
      if (graphAt <= focusedSuccessAt) {
        failTest("model dependant graph was not durably observed after focused success")
      }
    }
  }

  const decision = deriveRunFinalityDecision(
    { explanations: [{ _tag: "IntegrationInProgress", plannedAttempt: integrationAttempt }], transitions: [] },
    { entries: [integrationResponsibility] } satisfies WorkflowResponsibilityState,
    false
  )
  if (current.unrelated.responsibilityHeld && decision._tag !== "RunMustRemainActive") {
    failTest("production Run finality seam terminated with an unrelated responsibility retained")
  }
}

const integrationFinalityDriver = defineDriver(
  {
    deriveCompletionClaim: {},
    forgeLegacyEvidenceForFinality: {},
    init: {},
    observeCompletionEvidence: {},
    observeCompleteTaskAcknowledgement: {},
    observeFocusedCompletionFacts: {},
    observeFocusedCompletionForeignTaskConflict: {},
    observeFocusedCompletionHumanSuccessWithAbsentClaim: {},
    observeFocusedCompletionHumanSuccessWithForeignClaim: {},
    observeFocusedCompletionReopenedConflict: {},
    observeFocusedCompletionRevisionConflict: {},
    observeFocusedCompletionSuccess: {},
    observeLaterCompleteGraphBlocked: {},
    observeLaterCompleteGraphReleased: {},
    observeLaterCompleteGraphUnreadable: {},
    observePromotedCandidateAncestry: {},
    observePromotedCandidateAncestryUnreadable: {},
    observePromotedCandidateNotAncestor: {},
    observePostPromotionCandidateCurrentAncestry: {},
    observePostPromotionCandidateAncestorAncestry: {},
    observePostPromotionCandidateNotAncestor: {},
    observePostPromotionCandidateAncestryUnreadable: {},
    lookupCompletionRequestApplied: {},
    lookupCompletionRequestNotApplied: {},
    lookupCompletionRequestUnreadable: {},
    loseCompleteTaskResponse: {},
    observeFocusedCompletionOpenAfterLoss: {},
    loseCompletionClaimDeletionResponse: {},
    loseCompletionClaimReplacementResponse: {},
    markEmptyFrontier: {},
    observeCompletionClaimDeleted: {},
    observeCompletionClaimReplacement: {},
    observeFreshBlockerClear: {},
    observeFocusedCompletionHumanSuccessWithExactClaim: {},
    observePostPromotionBlocker: {},
    observeStaleTrackerSuccess: {},
    reconcileDeletionAsAbsent: {},
    reconcileDeletionAsCurrentCompletionClaim: {},
    reconcileDeletionAsForeignClaim: {},
    reconcileDeletionAsUnreadableClaim: {},
    reconcileReplacementAsCurrentCompletionClaim: {},
    reconcileReplacementAsForeignClaim: {},
    reconcileReplacementAsOriginalClaim: {},
    reconcileReplacementAsUnreadableClaim: {},
    recordCompletionClaimDeletionIntent: {},
    recordCompletionClaimReplacementIntent: {},
    recordCompleteTaskIntent: {},
    recordCompletionAttemptIntent: {},
    rejectCompletionClaimDeletion: {},
    requestCompletionClaimDeletion: {},
    requestCompletionClaimReplacement: {},
    requestCompleteTask: {},
    refreshCompletionPremisesForRetry: {},
    retryCompletionClaimDeletion: {},
    retryCompletionClaimReplacement: {},
    settlePromotedTask: {}
  },
  () => {
    let current = initialState()
    const productionState = makeProductionState()
    const updatePromoted = (update: (subject: Subject) => Subject) => {
      current = { ...current, promoted: update(current.promoted) }
    }
    return {
      init: () =>
        Effect.sync(() => {
          current = initialState()
          productionState.reset()
        }),
      forgeLegacyEvidenceForFinality: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase: "ReplacementIntentPending",
            proof: {
              ...subject.proof,
              acceptedResultEvidence: 0n,
              integratorReturnedEvidenceRefs: new Set([LEGACY_EVIDENCE_A])
            },
            completionClaimDerived: true,
            completionClaim: {
              claimId: COMPLETION_CLAIM_A,
              runId: subject.proof.runId,
              taskId: subject.proof.taskId,
              attemptId: subject.proof.attemptId,
              taskRevision: subject.proof.taskRevision,
              integratorSession: subject.proof.integratorSession,
              predecessorClaimId: subject.originalClaimId,
              candidateCommit: subject.proof.candidateCommit,
              expectedTargetHead: subject.proof.expectedTargetHead,
              acceptedResultCommit: subject.proof.acceptedResultCommit,
              candidateFirstParent: subject.proof.candidateFirstParent,
              candidateSecondParent: subject.proof.candidateSecondParent,
              acceptedResultEvidence: 0n,
              integratorReturnedEvidenceRefs: new Set([LEGACY_EVIDENCE_A])
            },
            legacyEvidenceForged: true
          }))
        ),
      observePostPromotionBlocker: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase: subject.phase === "CompletionClaimCurrent" ? "CompletionClaimBlocked" : "BlockedAfterPromotion",
            blockerPresent: true
          }))
        ),
      observeFreshBlockerClear: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase:
              subject.phase === "CompletionClaimBlocked" ? "CompletionClaimCurrent" : "PostPromotionAncestryPending",
            blockerPresent: false
          }))
        ),
      observePostPromotionCandidateCurrentAncestry: () =>
        Effect.sync(() => updatePromoted((subject) => ({ ...subject, phase: "PromotedProof" }))),
      observePostPromotionCandidateAncestorAncestry: () =>
        Effect.sync(() => updatePromoted((subject) => ({ ...subject, phase: "PromotedProof" }))),
      observePostPromotionCandidateNotAncestor: () =>
        Effect.sync(() => updatePromoted((subject) => ({ ...subject, phase: "PostPromotionAncestryWait" }))),
      observePostPromotionCandidateAncestryUnreadable: () =>
        Effect.sync(() => updatePromoted((subject) => ({ ...subject, phase: "PostPromotionAncestryWait" }))),
      deriveCompletionClaim: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase: "ReplacementIntentPending",
            completionClaimDerived: true,
            completionClaim: {
              claimId: COMPLETION_CLAIM_A,
              runId: subject.proof.runId,
              taskId: subject.proof.taskId,
              attemptId: subject.proof.attemptId,
              taskRevision: subject.proof.taskRevision,
              integratorSession: subject.proof.integratorSession,
              predecessorClaimId: subject.originalClaimId,
              candidateCommit: subject.proof.candidateCommit,
              expectedTargetHead: subject.proof.expectedTargetHead,
              acceptedResultCommit: subject.proof.acceptedResultCommit,
              candidateFirstParent: subject.proof.candidateFirstParent,
              candidateSecondParent: subject.proof.candidateSecondParent,
              acceptedResultEvidence: subject.proof.acceptedResultEvidence,
              integratorReturnedEvidenceRefs: subject.proof.integratorReturnedEvidenceRefs
            }
          }))
        ),
      recordCompletionClaimReplacementIntent: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase: "ReplacementIntentRecorded",
            replacementIntentRecorded: true
          }))
        ),
      requestCompletionClaimReplacement: () =>
        Effect.sync(() => {
          productionState.invokeReplacement("Rejected")
          updatePromoted((subject) => ({
            ...subject,
            phase: "ReplacementRequested",
            replacementRequests: subject.replacementRequests + 1n,
            lastMutation: "OriginalClaimMutation"
          }))
        }),
      observeCompletionClaimReplacement: () =>
        Effect.sync(() => {
          productionState.setClaimObservation(productionClaimIdentity)
          productionState.invokeReplacement("Applied")
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionClaimCurrent",
            claimState: "CompletionClaim",
            currentClaimId: subject.completionClaim.claimId,
            replacementOutcomeRecorded: true
          }))
        }),
      loseCompletionClaimReplacementResponse: () =>
        Effect.sync(() => updatePromoted((subject) => ({ ...subject, phase: "ReplacementResponseLost" }))),
      reconcileReplacementAsCurrentCompletionClaim: () =>
        Effect.sync(() => {
          productionState.setClaimObservation(productionClaimIdentity)
          productionState.invokeReplacement("Applied")
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionClaimCurrent",
            claimState: "CompletionClaim",
            currentClaimId: subject.completionClaim.claimId,
            replacementReads: subject.replacementReads + 1n,
            replacementReadBeforeRetry: true,
            replacementOutcomeRecorded: true
          }))
        }),
      reconcileReplacementAsOriginalClaim: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase:
              subject.replacementRequests < COMPLETION_CLAIM_REQUEST_LIMIT
                ? "ReplacementRetryReady"
                : "ReplacementExhausted",
            claimState: "OriginalClaim",
            currentClaimId: subject.originalClaimId,
            replacementReads: subject.replacementReads + 1n,
            replacementReadBeforeRetry: true
          }))
        ),
      reconcileReplacementAsForeignClaim: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase: "ReplacementWait",
            claimState: "ForeignClaim",
            currentClaimId: 999n,
            replacementReads: subject.replacementReads + 1n,
            replacementReadBeforeRetry: true
          }))
        ),
      reconcileReplacementAsUnreadableClaim: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase: "ReplacementWait",
            claimState: "UnreadableClaim",
            replacementReads: subject.replacementReads + 1n,
            replacementReadBeforeRetry: true
          }))
        ),
      retryCompletionClaimReplacement: () =>
        Effect.sync(() => {
          productionState.invokeReplacement("Rejected")
          updatePromoted((subject) => ({
            ...subject,
            phase: "ReplacementRequested",
            replacementRequests: subject.replacementRequests + 1n,
            lastMutation: "OriginalClaimMutation"
          }))
        }),
      observeStaleTrackerSuccess: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            trackerObservation: "StaleSuccess",
            trackerObservationRevision: STALE_TRACKER_REVISION
          }))
        ),
      observeFocusedCompletionHumanSuccessWithExactClaim: () =>
        Effect.sync(() => {
          productionState.appendObservedSuccess()
          updatePromoted((subject) => ({
            ...subject,
            phase: "DeleteIntentPending",
            trackerObservation: "FreshSuccess",
            trackerObservationRevision: FRESH_TRACKER_REVISION,
            freshTrackerSuccess: true,
            trackerSuccessEver: true,
            focusedSuccessRecorded: true,
            successSource: "ExternalFocusedSuccess"
          }))
        }),
      observeFocusedCompletionFacts: () =>
        Effect.sync(() => {
          productionState.observeFocusedAuthorization(Number(current.promoted.completionRequests) + 1)
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionFactsObserved",
            focusedFactsRecorded: true,
            focusedFactsOpen: true,
            focusedFactsNoBlocker: true,
            completionConflict: "NoCompletionConflict"
          }))
        }),
      observeFocusedCompletionHumanSuccessWithAbsentClaim: () =>
        Effect.sync(() => {
          productionState.observeFocusedCompletionSuccess(
            UnclaimedTask.make({ taskId: productionClaimIdentity.plannedAttempt.taskId })
          )
          updatePromoted((subject) => ({
            ...subject,
            phase: "DeleteIntentPending",
            claimState: "AbsentClaim",
            currentClaimId: 0n,
            trackerObservation: "FreshSuccess",
            trackerObservationRevision: FRESH_TRACKER_REVISION,
            freshTrackerSuccess: true,
            trackerSuccessEver: true,
            focusedSuccessRecorded: true,
            successSource: "ExternalFocusedSuccess",
            completionConflict: "NoCompletionConflict"
          }))
        }),
      observeFocusedCompletionHumanSuccessWithForeignClaim: () =>
        Effect.sync(() => {
          productionState.observeFocusedCompletionSuccess(productionClaimIdentity.originalClaim)
          updatePromoted((subject) => ({
            ...subject,
            phase: "DeleteIntentPending",
            claimState: "ForeignClaim",
            currentClaimId: 999n,
            trackerObservation: "FreshSuccess",
            trackerObservationRevision: FRESH_TRACKER_REVISION,
            freshTrackerSuccess: true,
            trackerSuccessEver: true,
            focusedSuccessRecorded: true,
            successSource: "ExternalFocusedSuccess",
            completionConflict: "NoCompletionConflict"
          }))
        }),
      observeFocusedCompletionForeignTaskConflict: () =>
        Effect.sync(() => {
          productionState.observeFocusedConflict("ForeignTask", Number(current.promoted.completionRequests) + 1)
          updatePromoted((subject) => ({ ...subject, phase: "CompletionWait", completionConflict: "ForeignTask" }))
        }),
      observeFocusedCompletionRevisionConflict: () =>
        Effect.sync(() => {
          productionState.observeFocusedConflict("RevisionConflict", Number(current.promoted.completionRequests) + 1)
          updatePromoted((subject) => ({ ...subject, phase: "CompletionWait", completionConflict: "RevisionConflict" }))
        }),
      observeFocusedCompletionReopenedConflict: () =>
        Effect.sync(() => {
          productionState.observeFocusedConflict("ReopenedTask", Number(current.promoted.completionRequests) + 1)
          updatePromoted((subject) => ({ ...subject, phase: "CompletionWait", completionConflict: "ReopenedTask" }))
        }),
      observePromotedCandidateAncestry: () =>
        Effect.sync(() => {
          productionState.observeCompletionAncestry(Number(current.promoted.completionRequests) + 1)
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionAncestryObserved",
            completionAncestry: "CandidateAncestor"
          }))
        }),
      observePromotedCandidateNotAncestor: () =>
        Effect.sync(() => {
          productionState.observeCompletionAncestryResult(
            "NotAncestor",
            Number(current.promoted.completionRequests) + 1
          )
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionWait",
            completionAncestry: "CandidateNotAncestor"
          }))
        }),
      observePromotedCandidateAncestryUnreadable: () =>
        Effect.sync(() => {
          productionState.observeCompletionAncestryResult("Unreadable", Number(current.promoted.completionRequests) + 1)
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionWait",
            completionAncestry: "UnreadableAncestry"
          }))
        }),
      observeCompletionEvidence: () =>
        Effect.sync(() => {
          productionState.observeCompletionEvidence()
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionEvidenceObserved",
            completionEvidenceRecorded: true
          }))
        }),
      recordCompleteTaskIntent: () =>
        Effect.sync(() => {
          productionState.recordCompletionIntentCutPoint(Number(current.promoted.completionRequests) + 1)
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionIntentRecorded",
            completionIntentRecorded: true,
            completionRequestId: 801n
          }))
        }),
      recordCompletionAttemptIntent: () =>
        Effect.gen(function* () {
          yield* productionState.recordCompletionAttemptIntentCutPoint(Number(current.promoted.completionRequests) + 1)
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionAttemptIntentRecorded",
            completionAttemptIntents: subject.completionAttemptIntents + 1n
          }))
        }),
      requestCompleteTask: () =>
        productionState.crossCompletionBoundaryCutPoint().pipe(
          Effect.andThen(
            Effect.sync(() =>
              updatePromoted((subject) => ({
                ...subject,
                phase: "CompletionRequested",
                completionRequests: subject.completionRequests + 1n,
                completionPremiseViolationCalls: subject.completionPremiseViolationCalls,
                completeTaskAcknowledged: false,
                completionOutcome: "NoCompletionOutcome",
                lastMutation: "CompleteTaskMutation"
              }))
            )
          ),
          Effect.tap(() =>
            Effect.sync(() => {
              current = { ...current, completeTaskRequests: current.completeTaskRequests + 1n }
            })
          )
        ),
      observeCompleteTaskAcknowledgement: () =>
        Effect.gen(function* () {
          yield* productionState.invokeCompletion("Acknowledged", Number(current.promoted.completionRequests))
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionAcknowledged",
            completionOutcome: "Applied",
            completeTaskAcknowledged: true
          }))
        }),
      loseCompleteTaskResponse: () =>
        Effect.gen(function* () {
          yield* productionState.invokeCompletion("ResponseLost", Number(current.promoted.completionRequests))
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionResponseLost",
            completionOpenConfirmationRecorded: false
          }))
        }),
      observeFocusedCompletionOpenAfterLoss: () =>
        Effect.sync(() => {
          productionState.observeFocusedCompletionOpenAfterLossCutPoint(Number(current.promoted.completionRequests))
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionConfirmationObserved",
            completionOpenConfirmationRecorded: true
          }))
        }),
      lookupCompletionRequestApplied: () =>
        Effect.sync(() => {
          productionState.reconcileCompletion("Applied", Number(current.promoted.completionRequests))
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionAcknowledged",
            completionReads: subject.completionReads + 1n,
            completionOutcome: "Applied",
            completeTaskAcknowledged: true
          }))
        }),
      lookupCompletionRequestNotApplied: () =>
        Effect.sync(() => {
          productionState.reconcileCompletion("NotApplied", Number(current.promoted.completionRequests))
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionRetryReady",
            completionReads: subject.completionReads + 1n,
            completionOutcome: "NotApplied",
            completionNotAppliedReads: subject.completionNotAppliedReads + 1n
          }))
        }),
      lookupCompletionRequestUnreadable: () =>
        Effect.sync(() => {
          productionState.reconcileCompletion("Unreadable", Number(current.promoted.completionRequests))
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionWait",
            completionReads: subject.completionReads + 1n,
            completionOutcome: "UnreadableCompletionOutcome"
          }))
        }),
      refreshCompletionPremisesForRetry: () =>
        Effect.sync(() => {
          productionState.observeFocusedAuthorization(Number(current.promoted.completionRequests) + 1)
          updatePromoted((subject) => ({
            ...subject,
            phase: "CompletionFactsObserved",
            completionOutcome: "NoCompletionOutcome",
            completeTaskAcknowledged: false,
            completionOpenConfirmationRecorded: false
          }))
        }),
      observeFocusedCompletionSuccess: () =>
        Effect.sync(() => {
          productionState.observeFocusedCompletionSuccess(productionClaimIdentity)
          updatePromoted((subject) => ({
            ...subject,
            phase: "DeleteIntentPending",
            trackerObservation: "FreshSuccess",
            trackerObservationRevision: FRESH_TRACKER_REVISION,
            freshTrackerSuccess: true,
            trackerSuccessEver: true,
            focusedSuccessRecorded: true,
            successSource: "PostRequestFocusedSuccess"
          }))
        }),
      observeLaterCompleteGraphBlocked: () =>
        Effect.sync(() => {
          const dependantEligible = productionState.appendCompleteGraph("Blocked")
          if (dependantEligible) failTest("production graph projection released B while its blocker remained open")
          updatePromoted((subject) => ({ ...subject, completeGraphObservation: "GraphBlocked", dependantEligible }))
        }),
      observeLaterCompleteGraphReleased: () =>
        Effect.sync(() => {
          const dependantEligible = productionState.appendCompleteGraph("Released")
          if (!dependantEligible) failTest("production graph projection kept B blocked after G1 released it")
          updatePromoted((subject) => ({ ...subject, completeGraphObservation: "GraphReleased", dependantEligible }))
        }),
      observeLaterCompleteGraphUnreadable: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            completeGraphObservation: "UnreadableGraph",
            dependantEligible: false
          }))
        ),
      recordCompletionClaimDeletionIntent: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({ ...subject, phase: "DeleteIntentRecorded", deleteIntentRecorded: true }))
        ),
      requestCompletionClaimDeletion: () =>
        Effect.sync(() => {
          productionState.invokeDeletion("Rejected")
          updatePromoted((subject) => ({
            ...subject,
            phase: "DeleteRequested",
            deleteRequests: subject.deleteRequests + 1n,
            lastMutation: "CompletionClaimMutation"
          }))
        }),
      observeCompletionClaimDeleted: () =>
        Effect.sync(() => {
          productionState.setClaimObservation(
            UnclaimedTask.make({ taskId: productionClaimIdentity.plannedAttempt.taskId })
          )
          productionState.invokeDeletion("Applied")
          updatePromoted((subject) => ({
            ...subject,
            phase: "DeleteResponseObserved",
            claimState: "AbsentClaim",
            currentClaimId: 0n,
            deletionOutcomeRecorded: true
          }))
        }),
      loseCompletionClaimDeletionResponse: () =>
        Effect.sync(() => updatePromoted((subject) => ({ ...subject, phase: "DeleteResponseLost" }))),
      reconcileDeletionAsAbsent: () =>
        Effect.sync(() => {
          productionState.setClaimObservation(
            UnclaimedTask.make({ taskId: productionClaimIdentity.plannedAttempt.taskId })
          )
          productionState.invokeDeletion("Applied")
          updatePromoted((subject) => ({
            ...subject,
            phase: "DeleteResponseObserved",
            claimState: "AbsentClaim",
            currentClaimId: 0n,
            deleteReads: subject.deleteReads + 1n,
            deleteReadBeforeRetry: true,
            deletionOutcomeRecorded: true
          }))
        }),
      reconcileDeletionAsCurrentCompletionClaim: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase: subject.deleteRequests < COMPLETION_CLAIM_REQUEST_LIMIT ? "DeleteRetryReady" : "CleanupWait",
            claimState: "CompletionClaim",
            currentClaimId: subject.completionClaim.claimId,
            deleteReads: subject.deleteReads + 1n,
            deleteReadBeforeRetry: true
          }))
        ),
      reconcileDeletionAsForeignClaim: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase: "CleanupWait",
            claimState: "ForeignClaim",
            currentClaimId: 998n,
            deleteReads: subject.deleteReads + 1n,
            deleteReadBeforeRetry: true
          }))
        ),
      reconcileDeletionAsUnreadableClaim: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({
            ...subject,
            phase: "CleanupWait",
            claimState: "UnreadableClaim",
            deleteReads: subject.deleteReads + 1n,
            deleteReadBeforeRetry: true
          }))
        ),
      retryCompletionClaimDeletion: () =>
        Effect.sync(() => {
          productionState.invokeDeletion("Rejected")
          updatePromoted((subject) => ({
            ...subject,
            phase: "DeleteRequested",
            deleteRequests: subject.deleteRequests + 1n,
            lastMutation: "CompletionClaimMutation"
          }))
        }),
      rejectCompletionClaimDeletion: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({ ...subject, phase: "CleanupWait", deletionFailureRecorded: true }))
        ),
      settlePromotedTask: () =>
        Effect.sync(() =>
          updatePromoted((subject) => ({ ...subject, phase: "Settled", responsibilityHeld: false, settled: true }))
        ),
      markEmptyFrontier: () =>
        Effect.sync(() => {
          current = { ...current, frontierEmpty: true }
        }),
      getState: () =>
        Effect.sync(() => {
          assertProductionFinality(current, productionState)
          return {
            completeTaskRequests: current.completeTaskRequests,
            dependantReleases: current.dependantReleases,
            frontierEmpty: current.frontierEmpty,
            promoted: normalizedSubject(current.promoted),
            reintegrationRequests: current.reintegrationRequests,
            runTerminated: current.runTerminated,
            unrelated: {
              phase: current.unrelated.phase,
              responsibilityHeld: current.unrelated.responsibilityHeld,
              settled: current.unrelated.settled,
              taskId: current.unrelated.taskId
            }
          }
        })
    }
  }
)

quintIt(
  it.effect,
  "replays promoted-task completion settlement through production claim protocols and Run finality",
  {
    backend: "typescript",
    driverFactory: integrationFinalityDriver,
    maxSteps: 20,
    nTraces: 100,
    seed: "141",
    spec: "specs/integrationFinality.qnt",
    stateCheck: stateCheck(
      (raw) =>
        Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
          Effect.map(({ state }) => ({
            completeTaskRequests: quintInt(state.completeTaskRequests),
            dependantReleases: quintInt(state.dependantReleases),
            frontierEmpty: state.frontierEmpty,
            promoted: normalizedSubject(state.promoted),
            reintegrationRequests: quintInt(state.reintegrationRequests),
            runTerminated: state.runTerminated,
            unrelated: {
              phase: variantTag(state.unrelated.phase),
              responsibilityHeld: state.unrelated.responsibilityHeld,
              settled: state.unrelated.settled,
              taskId: quintInt(state.unrelated.taskId)
            }
          })),
          Effect.orDie
        ),
      (spec, implementation) =>
        spec.completeTaskRequests === implementation.completeTaskRequests &&
        spec.dependantReleases === implementation.dependantReleases &&
        spec.frontierEmpty === implementation.frontierEmpty &&
        spec.promoted.attemptId === implementation.promoted.attemptId &&
        spec.promoted.blockerPresent === implementation.promoted.blockerPresent &&
        spec.promoted.claimState === implementation.promoted.claimState &&
        spec.promoted.completionClaim === implementation.promoted.completionClaim &&
        spec.promoted.completionClaimDerived === implementation.promoted.completionClaimDerived &&
        spec.promoted.completionAncestry === implementation.promoted.completionAncestry &&
        spec.promoted.legacyEvidenceForged === implementation.promoted.legacyEvidenceForged &&
        spec.promoted.completionAttemptIntents === implementation.promoted.completionAttemptIntents &&
        spec.promoted.completionOpenConfirmationRecorded ===
          implementation.promoted.completionOpenConfirmationRecorded &&
        spec.promoted.completionConfirmationViolationLookups ===
          implementation.promoted.completionConfirmationViolationLookups &&
        spec.promoted.completionConflict === implementation.promoted.completionConflict &&
        spec.promoted.completionEvidenceRecorded === implementation.promoted.completionEvidenceRecorded &&
        spec.promoted.completionIntentRecorded === implementation.promoted.completionIntentRecorded &&
        spec.promoted.completionOutcome === implementation.promoted.completionOutcome &&
        spec.promoted.completionNotAppliedReads === implementation.promoted.completionNotAppliedReads &&
        spec.promoted.completionReads === implementation.promoted.completionReads &&
        spec.promoted.completionRequestId === implementation.promoted.completionRequestId &&
        spec.promoted.completionPremiseViolationCalls === implementation.promoted.completionPremiseViolationCalls &&
        spec.promoted.completionRequests === implementation.promoted.completionRequests &&
        spec.promoted.completeGraphObservation === implementation.promoted.completeGraphObservation &&
        spec.promoted.completeTaskAcknowledged === implementation.promoted.completeTaskAcknowledged &&
        spec.promoted.currentClaimId === implementation.promoted.currentClaimId &&
        spec.promoted.deleteIntentRecorded === implementation.promoted.deleteIntentRecorded &&
        spec.promoted.deleteReadBeforeRetry === implementation.promoted.deleteReadBeforeRetry &&
        spec.promoted.deleteReads === implementation.promoted.deleteReads &&
        spec.promoted.deleteRequests === implementation.promoted.deleteRequests &&
        spec.promoted.deletionFailureRecorded === implementation.promoted.deletionFailureRecorded &&
        spec.promoted.deletionOutcomeRecorded === implementation.promoted.deletionOutcomeRecorded &&
        spec.promoted.foreignMutationCount === implementation.promoted.foreignMutationCount &&
        spec.promoted.freshTrackerSuccess === implementation.promoted.freshTrackerSuccess &&
        spec.promoted.focusedFactsNoBlocker === implementation.promoted.focusedFactsNoBlocker &&
        spec.promoted.focusedFactsOpen === implementation.promoted.focusedFactsOpen &&
        spec.promoted.focusedFactsRecorded === implementation.promoted.focusedFactsRecorded &&
        spec.promoted.focusedSuccessRecorded === implementation.promoted.focusedSuccessRecorded &&
        spec.promoted.lastMutation === implementation.promoted.lastMutation &&
        spec.promoted.phase === implementation.promoted.phase &&
        spec.promoted.proof === implementation.promoted.proof &&
        spec.promoted.proofPresent === implementation.promoted.proofPresent &&
        spec.promoted.reopenedAfterSuccess === implementation.promoted.reopenedAfterSuccess &&
        spec.promoted.reintegrationCount === implementation.promoted.reintegrationCount &&
        spec.promoted.replacementIntentRecorded === implementation.promoted.replacementIntentRecorded &&
        spec.promoted.replacementOutcomeRecorded === implementation.promoted.replacementOutcomeRecorded &&
        spec.promoted.replacementReadBeforeRetry === implementation.promoted.replacementReadBeforeRetry &&
        spec.promoted.replacementReads === implementation.promoted.replacementReads &&
        spec.promoted.replacementRequests === implementation.promoted.replacementRequests &&
        spec.promoted.responsibilityHeld === implementation.promoted.responsibilityHeld &&
        spec.promoted.settled === implementation.promoted.settled &&
        spec.promoted.taskId === implementation.promoted.taskId &&
        spec.promoted.taskRevision === implementation.promoted.taskRevision &&
        spec.promoted.trackerCompletionRequestRevision === implementation.promoted.trackerCompletionRequestRevision &&
        spec.promoted.trackerObservation === implementation.promoted.trackerObservation &&
        spec.promoted.trackerObservationRevision === implementation.promoted.trackerObservationRevision &&
        spec.promoted.trackerSuccessEver === implementation.promoted.trackerSuccessEver &&
        spec.promoted.dependantEligible === implementation.promoted.dependantEligible &&
        spec.reintegrationRequests === implementation.reintegrationRequests &&
        spec.runTerminated === implementation.runTerminated &&
        spec.unrelated.phase === implementation.unrelated.phase &&
        spec.unrelated.responsibilityHeld === implementation.unrelated.responsibilityHeld &&
        spec.unrelated.settled === implementation.unrelated.settled &&
        spec.unrelated.taskId === implementation.unrelated.taskId
    )
  },
  120_000
)
