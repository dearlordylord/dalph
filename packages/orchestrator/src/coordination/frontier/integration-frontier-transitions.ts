/* eslint-disable max-lines -- Retry authorization and changed-head disposition remain one frontier algebra owner. */
import { Option } from "effect"
import { plannedAttemptExecutorCorrelation, type AttemptId, type TaskId } from "@dalph/contracts"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import { latestReconstructedTaskGraph } from "../reconstruction/graph-knowledge.js"
import type { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import { deriveTargetPromotionStateFor } from "../../workflow/protocols/target-promotion/protocol.js"
import {
  integrationFinalityExplanationFor,
  integrationFinalityTransitionsFor
} from "./integration-finality-frontier.js"
import {
  FrontierExplanation,
  RunnableFrontierTransition,
  type RunnableFrontierTransition as RunnableFrontierTransitionType
} from "./frontier.js"
import type { IntegrationFrontierRuntimeFacts } from "./integration-frontier.js"
import {
  deriveCurrentIntegratorState,
  integratorRunQualifiedCandidateFromState,
  type CurrentIntegratorState
} from "../../workflow/protocols/integrator/state.js"
import {
  integratorInitialRunCorrelationFor,
  integratorRunCorrelationForSession
} from "../../workflow/protocols/integrator/session.js"
import type { IntegratorSuccessorPreparationInput } from "../../workflow/protocols/integrator/session.js"
import {
  IntegratorRunProtocolResult,
  integratorRetryRunOrdinal,
  integratorRunCorrelationsEqual,
  type IntegratorRunCorrelation
} from "../../workflow/protocols/integrator/events.js"
import { integratorRunTwoAuthorizationIssue } from "../../workflow/protocols/integrator/retry-authorization.js"
import {
  deriveIntegrationQuarantineState,
  type IntegrationQuarantineState
} from "../../workflow/protocols/integration-quarantine/state.js"
import { IntegrationQuarantineBasis } from "../../workflow/protocols/integration-quarantine/events.js"
import { targetPromotionCorrelationEquals } from "../../workflow/protocols/target-promotion/events.js"
import type { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { integrationQuarantinedRecordKey } from "../../workflow-journal/record-key.js"
import {
  validateProviderRunActivityAbsent,
  type ProviderRunFailureQuarantineInput
} from "../../workflow/protocols/integration-quarantine/provider-failure.js"
import {
  promotionStaleQuarantineEvidenceIssue,
  type PromotionStaleIntegrationQuarantineInput
} from "../../workflow/protocols/integration-quarantine/promotion-stale.js"

type ClaimSubject = { readonly plannedAttempt: { readonly attemptId: AttemptId; readonly taskId: TaskId } }
type PromotionState = ReturnType<typeof deriveTargetPromotionStateFor>
type SucceededPromotion = Extract<PromotionState, { readonly _tag: "PromotionSucceeded" }>

interface StartedResponsibilityAnalysis {
  readonly trackerFactsAreCurrentFor: (responsibility: {
    readonly plannedAttempt: { readonly taskId: TaskId }
  }) => boolean
  readonly claimIsExactFor: (responsibility: ClaimSubject) => boolean
  readonly claimConstraintFor: (
    responsibility: ClaimSubject
  ) => Exclude<ReturnType<typeof claimAuthorityFor>, { readonly _tag: "Exact" }> | undefined
  readonly succeededPromotionFor: (
    responsibility: StartedIntegrationResponsibility
  ) => Extract<ReturnType<typeof deriveTargetPromotionStateFor>, { readonly _tag: "PromotionSucceeded" }> | undefined
  readonly explanationForStarted: (responsibility: StartedIntegrationResponsibility) => FrontierExplanation
  readonly transitions: () => ReadonlyArray<RunnableFrontierTransitionType>
}

const claimAuthorityFor = (runtimeFacts: IntegrationFrontierRuntimeFacts, responsibility: ClaimSubject) =>
  runtimeFacts.taskClaimAuthorityByAttemptId.get(responsibility.plannedAttempt.attemptId) ?? {
    _tag: "Unobserved" as const
  }

const unsatisfiedPrerequisites = (
  runState: ReconstructedRunState,
  responsibility: StartedIntegrationResponsibility
): ReadonlyArray<TaskId> => {
  const graph = latestReconstructedTaskGraph(runState.graphKnowledge)
  if (Option.isNone(graph)) return []
  return graph.value
    .prerequisitesOf(responsibility.plannedAttempt.taskId)
    .filter((taskId) => Option.getOrUndefined(graph.value.lifecycleOf(taskId))?._tag !== "CompletedSuccessfully")
}

interface DurableTargetLineage {
  readonly observation: TargetLineageObservation
  readonly observedAt: JournalPosition
}

/** One retry decision derived from the durable quarantine and target-lineage chronology. */
type RetryIntegratorProgress =
  | { readonly _tag: "NotApplicable" }
  | { readonly _tag: "Blocked" }
  | { readonly _tag: "AwaitingLineage" }
  | { readonly _tag: "SuccessorReady"; readonly input: IntegratorSuccessorPreparationInput }
  | { readonly _tag: "Authorized"; readonly lineage: DurableTargetLineage; readonly run: IntegratorRunCorrelation }
  | {
      /** Fresh Git evidence proves Retry cannot use the session's fixed head. */
      readonly _tag: "TargetHeadChanged"
      readonly directionAppliedAt: JournalPosition
      readonly lineage: DurableTargetLineage
      readonly priorQuarantineAt: JournalPosition
      readonly session: IntegratorRunCorrelation["session"]
    }

const targetLineageEqual = (left: TargetLineageObservation, right: TargetLineageObservation): boolean =>
  left.plannedBaseIsAncestorOfTargetHead === right.plannedBaseIsAncestorOfTargetHead &&
  left.plannedBaseSha === right.plannedBaseSha &&
  left.targetHeadSha === right.targetHeadSha

const durableTargetLineageFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  afterPosition?: JournalPosition
): DurableTargetLineage | undefined => {
  const current = runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId)
  if (current === undefined) return undefined
  const record = runState.workflowHistory.records.findLast(
    ({ event, position }) =>
      event._tag === "TargetLineageObserved" &&
      (afterPosition === undefined || position > afterPosition) &&
      event.plannedAttempt.attemptId === responsibility.plannedAttempt.attemptId &&
      event.plannedAttempt.runId === responsibility.plannedAttempt.runId &&
      targetLineageEqual(event.observation, current)
  )
  return record?.event._tag === "TargetLineageObserved"
    ? { observation: record.event.observation, observedAt: record.position }
    : undefined
}

const nextJournalPositionFor = (runState: ReconstructedRunState): JournalPosition =>
  JournalPosition.make(
    runState.workflowHistory.records.reduce((latest, record) => Math.max(latest, Number(record.position)), 0) + 1
  )

const runBoundIntegratorStateFor = (
  state: CurrentIntegratorState
): Extract<CurrentIntegratorState, { readonly run: IntegratorRunCorrelation }> | undefined =>
  "run" in state ? state : undefined

const conclusiveQuarantineResultFor = (
  state: CurrentIntegratorState
): Extract<IntegratorRunProtocolResult, { readonly _tag: "NotPrepared" | "CandidateRejected" }> | undefined => {
  if (state._tag === "NotPrepared") {
    return IntegratorRunProtocolResult.cases.NotPrepared.make({ detail: state.detail, run: state.run })
  }
  if (state._tag === "CandidateRejected") {
    return IntegratorRunProtocolResult.cases.CandidateRejected.make({
      candidateText: state.candidateText,
      observation: state.observation,
      run: state.run
    })
  }
  return undefined
}

const promotionStaleQuarantineFor = (
  runState: ReconstructedRunState,
  integratorState: CurrentIntegratorState,
  promotion: PromotionState
): PromotionStaleIntegrationQuarantineInput | undefined => {
  if (promotion?._tag !== "PromotionStale") return undefined
  const runBoundState = runBoundIntegratorStateFor(integratorState)
  if (runBoundState === undefined) return undefined
  const quarantine = deriveIntegrationQuarantineState(
    runState.workflowHistory.records,
    runBoundState.run.session.sessionId
  )
  if (quarantine._tag !== "NoQuarantine") return undefined
  const stale = runState.workflowHistory.records.findLast(
    (record) =>
      record.event._tag === "TargetPromotionStale" &&
      targetPromotionCorrelationEquals(record.event.correlation, promotion.correlation)
  )
  return stale === undefined ||
    promotionStaleQuarantineEvidenceIssue(runState.workflowHistory.records, stale) !== undefined
    ? undefined
    : { correlation: promotion.correlation, targetPromotionStaleAt: stale.position }
}

/** Finds exact provider-absence evidence whose dependent initial Q append was interrupted. */
const providerRunFailureQuarantineFor = (
  runState: ReconstructedRunState,
  integratorState: CurrentIntegratorState
): ProviderRunFailureQuarantineInput | undefined => {
  if (
    integratorState._tag !== "RunUnfinished" ||
    (integratorState.run.ordinal !== 1 && integratorState.run.ordinal !== integratorRetryRunOrdinal)
  ) {
    return undefined
  }
  const { run } = integratorState
  const records = runState.workflowHistory.records
  const validAbsences = records.flatMap((record) => {
    if (record.event._tag !== "IntegrationProviderRunActivityAbsent") return []
    const validation = validateProviderRunActivityAbsent(records, record)
    return validation._tag === "Valid" && integratorRunCorrelationsEqual(validation.run, run) ? [validation.record] : []
  })
  if (validAbsences.length !== 1) return undefined
  const absence = validAbsences[0]
  /* v8 ignore next -- @preserve A one-element array cannot lack its first element; this keeps indexed access fail-closed. */
  if (absence === undefined) return undefined
  const basis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
    detail: absence.event.detail,
    ownedActivityProvenAbsentAt: absence.position
  })
  const quarantineKey = integrationQuarantinedRecordKey(run.session.sessionId, basis)
  return records.some((record) => record.key === quarantineKey) ? undefined : { detail: absence.event.detail, run }
}

/** Finds a conclusive modern run-1 result whose Q append was interrupted or never dispatched. */
const initialConclusiveQuarantineFor = (
  runState: ReconstructedRunState,
  integratorState: CurrentIntegratorState
): Extract<IntegratorRunProtocolResult, { readonly _tag: "NotPrepared" | "CandidateRejected" }> | undefined => {
  const runBoundState = runBoundIntegratorStateFor(integratorState)
  if (runBoundState === undefined || runBoundState.run.ordinal !== 1) return undefined
  const result = conclusiveQuarantineResultFor(integratorState)
  if (result === undefined) return undefined
  const quarantine = deriveIntegrationQuarantineState(
    runState.workflowHistory.records,
    runBoundState.run.session.sessionId
  )
  return quarantine._tag === "NoQuarantine" ? result : undefined
}

/** Finds an authorized run-2 conclusive result whose fresh Q2 append is absent. */
const retryConclusiveQuarantineFor = (
  runState: ReconstructedRunState,
  integratorState: CurrentIntegratorState
): Extract<IntegratorRunProtocolResult, { readonly _tag: "NotPrepared" | "CandidateRejected" }> | undefined => {
  const runBoundState = runBoundIntegratorStateFor(integratorState)
  if (runBoundState === undefined || runBoundState.run.ordinal !== integratorRetryRunOrdinal) return undefined
  const result = conclusiveQuarantineResultFor(integratorState)
  if (result === undefined) return undefined
  const quarantine = deriveIntegrationQuarantineState(
    runState.workflowHistory.records,
    runBoundState.run.session.sessionId
  )
  return quarantine._tag === "DirectionApplied" && quarantine.application.fingerprint.direction === "Retry"
    ? result
    : undefined
}

const currentQuarantineStateFor = (
  runState: ReconstructedRunState,
  integratorState: CurrentIntegratorState
): IntegrationQuarantineState | undefined => {
  const runBoundState = runBoundIntegratorStateFor(integratorState)
  /* v8 ignore next -- @preserve retryIntegratorProgressFor returns before calling this helper when no run is bound. */
  return runBoundState === undefined
    ? undefined
    : deriveIntegrationQuarantineState(runState.workflowHistory.records, runBoundState.run.session.sessionId)
}

/**
 * Derives the only frontier permission that may start Retry's ordinal-two
 * run. A terminal or provider-absence quarantine blocks the old run until a
 * winning Retry direction and a fresh unchanged target-lineage pair exist.
 */
// eslint-disable-next-line complexity -- One closed Q/D/L decision must retain its precedence and exact authority checks.
const retryIntegratorProgressFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  integratorState: CurrentIntegratorState
): RetryIntegratorProgress => {
  const runBoundState = runBoundIntegratorStateFor(integratorState)
  if (runBoundState === undefined) {
    return { _tag: "NotApplicable" }
  }

  const quarantine = currentQuarantineStateFor(runState, integratorState)
  if (quarantine === undefined || quarantine._tag === "NoQuarantine") {
    return { _tag: "NotApplicable" }
  }
  if (quarantine._tag === "Contradiction" || quarantine._tag === "Quarantined") {
    return { _tag: "Blocked" }
  }
  if (runtimeFacts.targetLineageRefreshRequiredAttemptIds?.has(responsibility.plannedAttempt.attemptId) === true) {
    return { _tag: "AwaitingLineage" }
  }

  const lineage = durableTargetLineageFor(runState, runtimeFacts, responsibility, quarantine.applicationAt)
  if (lineage === undefined) {
    return { _tag: "AwaitingLineage" }
  }
  if (quarantine.application.fingerprint.direction === "Retry" && runBoundState.run.ordinal !== 1) {
    /* v8 ignore next -- @preserve Integrator history rejects ordinals above the single bounded Retry before frontier derivation. */
    if (runBoundState.run.ordinal !== integratorRetryRunOrdinal) return { _tag: "Blocked" }
    if (integratorState._tag === "GitQualifiedPrepared") return { _tag: "NotApplicable" }
    const authorizationIssue = integratorRunTwoAuthorizationIssue(runState.workflowHistory.records, runBoundState.run, {
      beforePosition: nextJournalPositionFor(runState),
      requiredTargetLineageObservedAt: lineage.observedAt
    })
    return authorizationIssue === undefined
      ? { _tag: "Authorized", lineage, run: runBoundState.run }
      : { _tag: "Blocked" }
  }
  if (quarantine.application.fingerprint.direction === "FullRerun") {
    return targetLineageIsIncompatible(lineage.observation, responsibility)
      ? { _tag: "Blocked" }
      : {
          _tag: "SuccessorReady",
          input: {
            directionAppliedAt: quarantine.applicationAt,
            predecessor: runBoundState.run.session,
            quarantineAt: quarantine.quarantineAt,
            targetLineage: lineage.observation,
            targetLineageObservedAt: lineage.observedAt
          }
        }
  }
  if (lineage.observation.targetHeadSha !== runBoundState.run.session.expectedTargetHead) {
    return lineage.observation.plannedBaseSha === responsibility.plannedAttempt.baseSha
      ? {
          _tag: "TargetHeadChanged",
          directionAppliedAt: quarantine.applicationAt,
          lineage,
          priorQuarantineAt: quarantine.quarantineAt,
          session: runBoundState.run.session
        }
      : { _tag: "Blocked" }
  }
  if (targetLineageIsIncompatible(lineage.observation, responsibility)) {
    return { _tag: "Blocked" }
  }

  const run = integratorRunCorrelationForSession(runBoundState.run.session, integratorRetryRunOrdinal)
  const authorizationIssue = integratorRunTwoAuthorizationIssue(runState.workflowHistory.records, run, {
    beforePosition: nextJournalPositionFor(runState),
    requiredTargetLineageObservedAt: lineage.observedAt
  })
  return authorizationIssue === undefined ? { _tag: "Authorized", lineage, run } : { _tag: "Blocked" }
}

const fixedTargetLineageFor = (
  state: Exclude<CurrentIntegratorState, { readonly _tag: "Absent" | "Contradiction" }>
): DurableTargetLineage => ({
  observation: {
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: state.run.session.plannedAttempt.baseSha,
    targetHeadSha: state.run.session.expectedTargetHead
  },
  observedAt: state.run.session.targetLineageObservedAt
})

const targetLineageIsIncompatible = (
  lineage: TargetLineageObservation,
  responsibility: StartedIntegrationResponsibility
): boolean =>
  lineage.plannedBaseSha !== responsibility.plannedAttempt.baseSha || !lineage.plannedBaseIsAncestorOfTargetHead

const fixedIntegratorSessionLineageChanged = (
  state: CurrentIntegratorState,
  lineage: TargetLineageObservation,
  responsibility: StartedIntegrationResponsibility
): boolean =>
  state._tag !== "Absent" &&
  state._tag !== "Contradiction" &&
  (lineage.targetHeadSha !== state.run.session.expectedTargetHead ||
    targetLineageIsIncompatible(lineage, responsibility))

const releaseStartedIntegrationTargetFor = (
  responsibility: StartedIntegrationResponsibility,
  held: boolean
): ReadonlyArray<RunnableFrontierTransitionType> =>
  held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []

const explanationAfterPrerequisitesFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  integratorState: CurrentIntegratorState,
  promotion: PromotionState
): FrontierExplanation => {
  if (promotion?._tag === "PromotionSucceeded") {
    return integrationFinalityExplanationFor(runState.workflowHistory.records, responsibility, promotion, runtimeFacts)
  }
  if (integratorState._tag === "GitQualifiedPrepared" && runtimeFacts.targetPromotionConfigured !== true) {
    return FrontierExplanation.TargetPromotionConfigurationWait({
      plannedAttempt: responsibility.plannedAttempt,
      wakeCondition: "TargetPromotionRuntimeConfigured"
    })
  }
  const lineage = runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId)
  if (lineage === undefined)
    return FrontierExplanation.IntegrationInProgress({ plannedAttempt: responsibility.plannedAttempt })
  if (targetLineageIsIncompatible(lineage, responsibility)) {
    return FrontierExplanation.PlannedAttemptGitConstraint({
      correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt),
      gitState: "TargetRewrite",
      taskId: responsibility.plannedAttempt.taskId,
      wakeCondition: "GitFactsObserved"
    })
  }
  return FrontierExplanation.IntegrationInProgress({ plannedAttempt: responsibility.plannedAttempt })
}

const promotionSucceededTransitionsFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  promotion: SucceededPromotion,
  held: boolean,
  waiting: boolean,
  trackerFactsAreCurrent: boolean
): ReadonlyArray<RunnableFrontierTransitionType> => {
  /* v8 ignore next -- @preserve The promotion action releases its exact target in ensuring; this defends same-process retained ownership. */
  if (held) return [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })]
  if (!trackerFactsAreCurrent || waiting) return []
  return integrationFinalityTransitionsFor(runState.workflowHistory.records, responsibility, promotion, runtimeFacts)
}

const integratorStateBlocksProgress = (state: CurrentIntegratorState, promotion: PromotionState): boolean => {
  if (state._tag === "Contradiction" || state._tag === "NotPrepared" || state._tag === "CandidateRejected") return true
  return promotion?._tag === "PromotionStale" || promotion?._tag === "PromotionNonConvergent"
}

const targetPromotionConfigurationIsMissing = (
  state: CurrentIntegratorState,
  runtimeFacts: IntegrationFrontierRuntimeFacts
): boolean => state._tag === "GitQualifiedPrepared" && runtimeFacts.targetPromotionConfigured !== true

const fixedLineageRequiresRelease = (
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  state: CurrentIntegratorState
): boolean => {
  if (state._tag !== "GitQualifiedPrepared") return false
  const lineage = runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId)
  return lineage !== undefined && fixedIntegratorSessionLineageChanged(state, lineage, responsibility)
}

/** An unmatched compare-and-set must read the target it may already have moved before fresh lineage can reject it. */
const promotionAttemptNeedsReconciliationRead = (promotion: PromotionState): boolean =>
  promotion?._tag === "PromotionPending" && promotion.retry._tag === "NeedReconciliationRead"

const settledIntegrationMustReleaseTarget = (
  waiting: boolean,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  integratorState: CurrentIntegratorState,
  promotion: PromotionState
): boolean =>
  waiting ||
  integratorStateBlocksProgress(integratorState, promotion) ||
  targetPromotionConfigurationIsMissing(integratorState, runtimeFacts) ||
  (fixedLineageRequiresRelease(runtimeFacts, responsibility, integratorState) &&
    !promotionAttemptNeedsReconciliationRead(promotion))

// eslint-disable-next-line complexity -- Started integration admission is one ordered authority gate over tracker, claim, quarantine, and target ownership.
const transitionsBeforeStartedIntegrationAdmission = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  waiting: boolean,
  held: boolean,
  integratorState: CurrentIntegratorState,
  promotion: PromotionState,
  retryProgress: RetryIntegratorProgress,
  trackerFactsAreCurrentFor: (responsibility: { readonly plannedAttempt: { readonly taskId: TaskId } }) => boolean,
  claimIsExactFor: (responsibility: ClaimSubject) => boolean
): ReadonlyArray<RunnableFrontierTransitionType> | undefined => {
  if (promotion?._tag === "PromotionSucceeded") {
    return promotionSucceededTransitionsFor(
      runState,
      runtimeFacts,
      responsibility,
      promotion,
      held,
      waiting,
      trackerFactsAreCurrentFor(responsibility)
    )
  }
  const initialConclusiveResult = initialConclusiveQuarantineFor(runState, integratorState)
  if (initialConclusiveResult !== undefined) {
    return [
      RunnableFrontierTransition.RecordInitialConclusiveIntegrationQuarantine({
        result: initialConclusiveResult,
        responsibility
      })
    ]
  }
  const providerRunFailure = providerRunFailureQuarantineFor(runState, integratorState)
  if (providerRunFailure !== undefined) {
    return [
      RunnableFrontierTransition.RecordProviderRunFailureIntegrationQuarantine({
        input: providerRunFailure,
        responsibility
      })
    ]
  }
  const retryConclusiveResult = retryConclusiveQuarantineFor(runState, integratorState)
  if (retryConclusiveResult !== undefined) {
    return [
      RunnableFrontierTransition.RecordRetryConclusiveIntegrationQuarantine({
        responsibility,
        result: retryConclusiveResult
      })
    ]
  }
  const promotionStale = promotionStaleQuarantineFor(runState, integratorState, promotion)
  if (promotionStale !== undefined) {
    return [
      RunnableFrontierTransition.RecordPromotionStaleIntegrationQuarantine({ input: promotionStale, responsibility })
    ]
  }
  if (!trackerFactsAreCurrentFor(responsibility)) return releaseStartedIntegrationTargetFor(responsibility, held)
  if (!claimIsExactFor(responsibility)) return []
  if (waiting) return releaseStartedIntegrationTargetFor(responsibility, held)
  if (retryProgress._tag === "Blocked") return releaseStartedIntegrationTargetFor(responsibility, held)
  if (
    retryProgress._tag === "AwaitingLineage" ||
    retryProgress._tag === "SuccessorReady" ||
    retryProgress._tag === "Authorized" ||
    retryProgress._tag === "TargetHeadChanged"
  ) {
    return undefined
  }
  if (settledIntegrationMustReleaseTarget(waiting, runtimeFacts, responsibility, integratorState, promotion)) {
    return releaseStartedIntegrationTargetFor(responsibility, held)
  }
  return undefined
}

const absentIntegratorProgressTransitionsFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  held: boolean
): ReadonlyArray<RunnableFrontierTransitionType> => {
  if (runtimeFacts.targetLineageRefreshRequiredAttemptIds?.has(responsibility.plannedAttempt.attemptId) === true) {
    return []
  }
  const lineage = durableTargetLineageFor(runState, runtimeFacts, responsibility)
  if (lineage === undefined) return []
  if (targetLineageIsIncompatible(lineage.observation, responsibility)) {
    return releaseStartedIntegrationTargetFor(responsibility, held)
  }
  return [
    RunnableFrontierTransition.RunIntegrator({
      lineage: lineage.observation,
      lineageObservedAt: lineage.observedAt,
      run: integratorInitialRunCorrelationFor({
        responsibility,
        targetLineage: lineage.observation,
        targetLineageObservedAt: lineage.observedAt
      }),
      responsibility
    })
  ]
}

const qualifiedIntegratorProgressTransitionsFor = (
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  state: Extract<CurrentIntegratorState, { readonly _tag: "GitQualifiedPrepared" }>,
  promotion: PromotionState
): ReadonlyArray<RunnableFrontierTransitionType> =>
  runtimeFacts.targetLineageRefreshRequiredAttemptIds?.has(responsibility.plannedAttempt.attemptId) === true &&
  !promotionAttemptNeedsReconciliationRead(promotion)
    ? []
    : [
        RunnableFrontierTransition.RunTargetPromotion({
          candidate: integratorRunQualifiedCandidateFromState(state),
          responsibility
        })
      ]

const explicitRetryProgressTransitionsFor = (
  responsibility: StartedIntegrationResponsibility,
  retryProgress: RetryIntegratorProgress
): ReadonlyArray<RunnableFrontierTransitionType> | undefined => {
  if (retryProgress._tag === "AwaitingLineage") return []
  if (retryProgress._tag === "SuccessorReady") {
    return [RunnableFrontierTransition.FixIntegratorSuccessorSession({ input: retryProgress.input, responsibility })]
  }
  if (retryProgress._tag === "TargetHeadChanged") {
    return [
      RunnableFrontierTransition.RecordChangedHeadRetryQuarantine({
        request: {
          directionAppliedAt: retryProgress.directionAppliedAt,
          priorQuarantineAt: retryProgress.priorQuarantineAt,
          session: retryProgress.session,
          targetLineage: retryProgress.lineage.observation,
          targetLineageObservedAt: retryProgress.lineage.observedAt
        },
        responsibility
      })
    ]
  }
  return retryProgress._tag === "Authorized"
    ? [
        RunnableFrontierTransition.RunIntegrator({
          lineage: retryProgress.lineage.observation,
          lineageObservedAt: retryProgress.lineage.observedAt,
          responsibility,
          run: retryProgress.run
        })
      ]
    : undefined
}

const startedIntegrationProgressTransitionFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  integratorState: CurrentIntegratorState,
  promotion: PromotionState,
  held: boolean,
  retryProgress: RetryIntegratorProgress
): ReadonlyArray<RunnableFrontierTransitionType> => {
  // A fixed Integrator session or qualified candidate may outlive a released
  // process-local target position. The unfinished outer boundary reuses S's
  // durable H; only later promotion requires current target authority.
  if (!held) return [RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })]
  const retryTransitions = explicitRetryProgressTransitionsFor(responsibility, retryProgress)
  if (retryTransitions !== undefined) return retryTransitions
  if (integratorState._tag === "GitQualifiedPrepared") {
    return qualifiedIntegratorProgressTransitionsFor(runtimeFacts, responsibility, integratorState, promotion)
  }
  if (integratorState._tag === "Absent") {
    return absentIntegratorProgressTransitionsFor(runState, runtimeFacts, responsibility, held)
  }
  /* v8 ignore next -- @preserve Contradictory state is released by the ordered admission gate before progress derivation. */
  if (integratorState._tag === "Contradiction") return []
  const lineage = fixedTargetLineageFor(integratorState)
  return [
    RunnableFrontierTransition.RunIntegrator({
      lineage: lineage.observation,
      lineageObservedAt: lineage.observedAt,
      run: integratorState.run,
      responsibility
    })
  ]
}

/** Derives current started-responsibility authority, explanations, and transitions in precedence order. */
export const deriveStartedIntegrationFrontier = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  started: ReadonlyArray<StartedIntegrationResponsibility>
): StartedResponsibilityAnalysis => {
  const trackerFactsAreCurrentFor = (responsibility: { readonly plannedAttempt: { readonly taskId: TaskId } }) =>
    runtimeFacts.currentTrackerTaskIds.has(responsibility.plannedAttempt.taskId)
  const claimIsExactFor = (responsibility: ClaimSubject) =>
    claimAuthorityFor(runtimeFacts, responsibility)._tag === "Exact"
  const claimConstraintFor = (responsibility: ClaimSubject) => {
    const authority = claimAuthorityFor(runtimeFacts, responsibility)
    return authority._tag === "Exact" ? undefined : authority
  }
  const integratorStateFor = (responsibility: StartedIntegrationResponsibility) =>
    deriveCurrentIntegratorState(runState.workflowHistory.records, responsibility)
  const promotionFor = (state: CurrentIntegratorState) =>
    state._tag === "GitQualifiedPrepared"
      ? deriveTargetPromotionStateFor(runState.workflowHistory.records, integratorRunQualifiedCandidateFromState(state))
      : undefined
  const succeededPromotionFor = (responsibility: StartedIntegrationResponsibility) => {
    const promotion = promotionFor(integratorStateFor(responsibility))
    return promotion?._tag === "PromotionSucceeded" ? promotion : undefined
  }
  const explanationForStarted = (responsibility: StartedIntegrationResponsibility) => {
    const prerequisiteTaskIds = unsatisfiedPrerequisites(runState, responsibility)
    if (prerequisiteTaskIds.length > 0) {
      return FrontierExplanation.IntegrationDependencyWait({
        plannedAttempt: responsibility.plannedAttempt,
        prerequisiteTaskIds,
        wakeCondition: "TaskTrackerFactsObserved"
      })
    }
    const integratorState = integratorStateFor(responsibility)
    return explanationAfterPrerequisitesFor(
      runState,
      runtimeFacts,
      responsibility,
      integratorState,
      promotionFor(integratorState)
    )
  }
  const transitions = started.flatMap<RunnableFrontierTransitionType>((responsibility) => {
    /* v8 ignore next -- @preserve The serialized coordinator cannot select a responsibility while its scoped Integrator effect is active. */
    if (runtimeFacts.activeResponsibilityPositions?.has(responsibility.queuedAt)) return []
    const waiting = unsatisfiedPrerequisites(runState, responsibility).length > 0
    const held = runtimeFacts.heldResponsibilityPositions.has(responsibility.queuedAt)
    const integratorState = integratorStateFor(responsibility)
    const promotion = promotionFor(integratorState)
    const retryProgress = retryIntegratorProgressFor(runState, runtimeFacts, responsibility, integratorState)
    const earlyTransition = transitionsBeforeStartedIntegrationAdmission(
      runState,
      runtimeFacts,
      responsibility,
      waiting,
      held,
      integratorState,
      promotion,
      retryProgress,
      trackerFactsAreCurrentFor,
      claimIsExactFor
    )
    return (
      earlyTransition ??
      startedIntegrationProgressTransitionFor(
        runState,
        runtimeFacts,
        responsibility,
        integratorState,
        promotion,
        held,
        retryProgress
      )
    )
  })
  return {
    trackerFactsAreCurrentFor,
    claimIsExactFor,
    claimConstraintFor,
    succeededPromotionFor,
    explanationForStarted,
    transitions: () => transitions
  }
}
