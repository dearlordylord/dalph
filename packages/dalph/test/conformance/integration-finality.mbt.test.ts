import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { TaskRevision } from "@dalph/contracts"
import {
  CompletionClaimBoundary,
  CompletionClaimDeletionFailure,
  CompletionClaimReplacementFailure,
  CompletionTaskClaim,
  InRunJournal,
  completionClaimDeletionRequestFor,
  completionClaimReplacementRequestFor,
  completionClaimRequestLimit,
  completionTaskClaimEquals,
  deriveIntegrationFinalityStateFor,
  deriveRunFinalityDecision,
  FreshCompletedTaskObservation,
  JournalPosition,
  UnclaimedTask,
  runCompletionClaimDeletionProtocol,
  runCompletionClaimReplacementProtocol,
  outcomeRecordKey,
  targetPromotionObservedSuccessRecordKey,
  type WorkflowResponsibilityEntry,
  type WorkflowResponsibilityState,
  type CompletionClaimObservation,
  type JournalRecord
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import { integrationFinalityFixture } from "../../../orchestrator/src/workflow/protocols/integration-finality/fixtures.js"

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
const INTEGRATION_TARGET_A = 501n
const PROMOTION_CORRELATION_A = 601n
const TRACKER_COMPLETION_REQUEST_REVISION = 10n
const STALE_TRACKER_REVISION = 10n
const FRESH_TRACKER_REVISION = 11n
const COMPLETION_CLAIM_REQUEST_LIMIT = 3n

type Phase =
  | "PromotedProof"
  | "BlockedAfterPromotion"
  | "CompletionClaimBlocked"
  | "ReplacementIntentPending"
  | "ReplacementIntentRecorded"
  | "ReplacementRequested"
  | "ReplacementResponseLost"
  | "ReplacementRetryReady"
  | "ReplacementWait"
  | "ReplacementExhausted"
  | "CompletionClaimCurrent"
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
type MutationTarget = "NoMutation" | "OriginalClaimMutation" | "CompletionClaimMutation" | "ForeignClaimMutation"

type Proof = {
  runId: bigint
  taskId: bigint
  attemptId: bigint
  taskRevision: bigint
  candidateCommit: bigint
  expectedTargetHead: bigint
  integrationTarget: bigint
  promotionCorrelation: bigint
}

type CompletionClaim = {
  claimId: bigint
  runId: bigint
  taskId: bigint
  attemptId: bigint
  taskRevision: bigint
  predecessorClaimId: bigint
  promotionCorrelation: bigint
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
  candidateCommit: CANDIDATE_A,
  expectedTargetHead: EXPECTED_HEAD_A,
  integrationTarget: INTEGRATION_TARGET_A,
  promotionCorrelation: PROMOTION_CORRELATION_A
}

const emptyCompletionClaim: CompletionClaim = {
  claimId: 0n,
  runId: 0n,
  taskId: 0n,
  attemptId: 0n,
  taskRevision: 0n,
  predecessorClaimId: 0n,
  promotionCorrelation: 0n
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
    candidateCommit: 0n,
    expectedTargetHead: 0n,
    integrationTarget: 0n,
    promotionCorrelation: 0n
  },
  completionClaimDerived: false,
  completionClaim: emptyCompletionClaim,
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
  currentClaimId: ITFBigInt,
  deleteIntentRecorded: Schema.Boolean,
  deleteReadBeforeRetry: Schema.Boolean,
  deleteReads: ITFBigInt,
  deleteRequests: ITFBigInt,
  deletionFailureRecorded: Schema.Boolean,
  deletionOutcomeRecorded: Schema.Boolean,
  foreignMutationCount: ITFBigInt,
  freshTrackerSuccess: Schema.Boolean,
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
  trackerSuccessEver: Schema.Boolean
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

const normalizedProof = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return String(value)
  const fields = [
    "runId",
    "taskId",
    "attemptId",
    "taskRevision",
    "candidateCommit",
    "expectedTargetHead",
    "integrationTarget",
    "promotionCorrelation"
  ]
  return fields.map((field) => `${field}=${quintInt(Reflect.get(value, field))}`).join(",")
}

const normalizedCompletionClaim = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return String(value)
  const fields = [
    "claimId",
    "runId",
    "taskId",
    "attemptId",
    "taskRevision",
    "predecessorClaimId",
    "promotionCorrelation"
  ]
  return fields.map((field) => `${field}=${quintInt(Reflect.get(value, field))}`).join(",")
}

const normalizedSubject = (subject: Subject | Schema.Schema.Type<typeof SpecSubject>) => ({
  attemptId: quintInt(subject.attemptId),
  blockerPresent: subject.blockerPresent,
  claimState: variantTag(subject.claimState),
  completionClaim: normalizedCompletionClaim(subject.completionClaim),
  completionClaimDerived: subject.completionClaimDerived,
  currentClaimId: quintInt(subject.currentClaimId),
  deleteIntentRecorded: subject.deleteIntentRecorded,
  deleteReadBeforeRetry: subject.deleteReadBeforeRetry,
  deleteReads: quintInt(subject.deleteReads),
  deleteRequests: quintInt(subject.deleteRequests),
  deletionFailureRecorded: subject.deletionFailureRecorded,
  deletionOutcomeRecorded: subject.deletionOutcomeRecorded,
  foreignMutationCount: quintInt(subject.foreignMutationCount),
  freshTrackerSuccess: subject.freshTrackerSuccess,
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
  trackerSuccessEver: subject.trackerSuccessEver
})

const integrationAttempt = integrationFinalityFixture.plannedAttempt

const integrationResponsibility: WorkflowResponsibilityEntry = {
  _tag: "PlannedAttemptExecutorWorkResponsibility",
  beganAt: JournalPosition.make(1),
  plannedAttempt: integrationAttempt
}

const productionClaimIdentity: CompletionTaskClaim = integrationFinalityFixture.claim

type ProductionMutationDisposition = "Applied" | "Rejected"

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
  let successObservation: FreshCompletedTaskObservation | undefined

  const journal = InRunJournal.of({
    append: (runId, key, event) =>
      Effect.sync(() => {
        const existing = records.find((record) => record.key === key)
        if (existing !== undefined) return existing
        const record: JournalRecord = { event, key, position: JournalPosition.make(records.length + 1), runId }
        records = [...records, record]
        return record
      }),
    read: (runId) => Effect.sync(() => records.filter((record) => record.runId === runId))
  })

  const boundary = CompletionClaimBoundary.of({
    readTaskClaim: (taskId) =>
      Effect.sync(() =>
        taskId === productionClaimIdentity.plannedAttempt.taskId ? claimObservation : UnclaimedTask.make({ taskId })
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

  const appendObservedSuccess = (): void => {
    const event = integrationFinalityFixture.graphRecordEvent
    const key = outcomeRecordKey(event.operationId)
    const record = Effect.runSync(journal.append(productionClaimIdentity.plannedAttempt.runId, key, event))
    successObservation = FreshCompletedTaskObservation.make({
      ...integrationFinalityFixture.successObservation,
      observedAt: record.position
    })
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
    if (successObservation === undefined) throw new Error("production deletion requires observed tracker success")
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
          "IntegrationFinality.FreshTrackerSuccessRequired": () => Effect.void
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
  }

  const readState = () => deriveIntegrationFinalityStateFor(records, productionClaimIdentity)

  return {
    appendObservedSuccess,
    get records(): ReadonlyArray<JournalRecord> {
      return records
    },
    invokeDeletion,
    invokeReplacement,
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
  if (completionClaimRequestLimit !== Number(COMPLETION_CLAIM_REQUEST_LIMIT)) {
    throw new Error("model request bound diverges from production completion-claim request bound")
  }
  if (!completionTaskClaimEquals(productionClaimIdentity, productionClaimIdentity)) {
    throw new Error("production completion-claim equality rejected an identical exact claim")
  }
  const changedClaim = CompletionTaskClaim.make({
    ...productionClaimIdentity,
    plannedAttempt: { ...productionClaimIdentity.plannedAttempt, taskRevision: TaskRevision.make("changed") }
  })
  if (completionTaskClaimEquals(productionClaimIdentity, changedClaim)) {
    throw new Error("production completion-claim equality accepted a changed task revision")
  }

  const projected = productionState.readState()
  const projectedTag = projected?._tag
  if (projectedTag === "ReplacementPending" && current.promoted.replacementRequests === 0n) {
    throw new Error("production replacement protocol recorded a request before the model requested one")
  }
  if (projectedTag === "CompletionClaimReplaced" && !current.promoted.replacementOutcomeRecorded) {
    throw new Error("production replacement protocol settled before the model observed its response")
  }
  if (projectedTag === "DeletionPending" && !current.promoted.deleteIntentRecorded) {
    throw new Error("production deletion protocol recorded intent before the model recorded it")
  }
  if (
    (projectedTag === "CompletionClaimDeleted" || projectedTag === "IntegrationFinalitySettled") &&
    !current.promoted.deletionOutcomeRecorded
  ) {
    throw new Error("production deletion protocol settled before the model observed deletion")
  }
  if (current.promoted.settled && projectedTag !== "IntegrationFinalitySettled") {
    throw new Error("model settlement did not reach production integration finality")
  }

  const decision = deriveRunFinalityDecision(
    { explanations: [{ _tag: "IntegrationInProgress", plannedAttempt: integrationAttempt }], transitions: [] },
    { entries: [integrationResponsibility] } satisfies WorkflowResponsibilityState,
    false
  )
  if (current.unrelated.responsibilityHeld && decision._tag !== "RunMustRemainActive") {
    throw new Error("production Run finality seam terminated with an unrelated responsibility retained")
  }
}

const integrationFinalityDriver = defineDriver(
  {
    deriveCompletionClaim: {},
    init: {},
    loseCompletionClaimDeletionResponse: {},
    loseCompletionClaimReplacementResponse: {},
    markEmptyFrontier: {},
    observeCompletionClaimDeleted: {},
    observeCompletionClaimReplacement: {},
    observeFreshBlockerClear: {},
    observeFreshTrackerSuccess: {},
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
    rejectCompletionClaimDeletion: {},
    requestCompletionClaimDeletion: {},
    requestCompletionClaimReplacement: {},
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
            phase: subject.phase === "CompletionClaimBlocked" ? "CompletionClaimCurrent" : "PromotedProof",
            blockerPresent: false
          }))
        ),
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
              predecessorClaimId: subject.originalClaimId,
              promotionCorrelation: subject.proof.promotionCorrelation
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
      observeFreshTrackerSuccess: () =>
        Effect.sync(() => {
          productionState.appendObservedSuccess()
          updatePromoted((subject) => ({
            ...subject,
            phase: "DeleteIntentPending",
            trackerObservation: "FreshSuccess",
            trackerObservationRevision: FRESH_TRACKER_REVISION,
            freshTrackerSuccess: true,
            trackerSuccessEver: true
          }))
        }),
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
        spec.promoted.currentClaimId === implementation.promoted.currentClaimId &&
        spec.promoted.deleteIntentRecorded === implementation.promoted.deleteIntentRecorded &&
        spec.promoted.deleteReadBeforeRetry === implementation.promoted.deleteReadBeforeRetry &&
        spec.promoted.deleteReads === implementation.promoted.deleteReads &&
        spec.promoted.deleteRequests === implementation.promoted.deleteRequests &&
        spec.promoted.deletionFailureRecorded === implementation.promoted.deletionFailureRecorded &&
        spec.promoted.deletionOutcomeRecorded === implementation.promoted.deletionOutcomeRecorded &&
        spec.promoted.foreignMutationCount === implementation.promoted.foreignMutationCount &&
        spec.promoted.freshTrackerSuccess === implementation.promoted.freshTrackerSuccess &&
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
