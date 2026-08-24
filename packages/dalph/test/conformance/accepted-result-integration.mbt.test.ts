/* eslint-disable functional/no-mixed-types -- The executable Quint driver exposes imperative action controls. */
import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFMap, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { Effect, Schema } from "effect"
import type { AcceptedResult } from "@dalph/contracts"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../orchestrator/src/coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../orchestrator/src/control/policy.js"
import { acceptedResultFixture } from "../../../orchestrator/test/support/evidence.js"
import { TargetLineageObservation } from "../../../orchestrator/src/authorities/git/target-lineage.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import { makeWorkflowRunBeganRecord } from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"
import {
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import {
  GitReadIntentRecordedEvent,
  TargetLineageObservedEvent
} from "../../../orchestrator/src/workflow/registry/event.js"
import { describeJournalEvent } from "../../../orchestrator/src/workflow/registry/event-descriptor.js"
import { makeTargetLineageObservationOperation } from "../../../orchestrator/src/workflow/registry/operation.js"
import type { JournalRecordKey } from "../../../orchestrator/src/workflow-journal/identity.js"
import { JournalPosition } from "../../../orchestrator/src/workflow-journal/identity.js"
import {
  InRunJournal,
  type AppendableWorkflowJournalEvent,
  type JournalRecord
} from "../../../orchestrator/src/workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../../orchestrator/src/workflow/protocols/integration-admission/events.js"
import { StartedIntegrationResponsibility } from "../../../orchestrator/src/workflow/protocols/integration-admission/protocol.js"
import {
  ApplyIntegrationQuarantineDirectionRequest,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId
} from "../../../orchestrator/src/workflow/protocols/integration-quarantine/events.js"
import { makeIntegrationQuarantineDirectionControl } from "../../../orchestrator/src/workflow/protocols/integration-quarantine/control.js"
import { appendChangedHeadRetryQuarantine } from "../../../orchestrator/src/workflow/protocols/integration-quarantine/changed-head-retry.js"
import {
  Integrator,
  IntegratorCallFailure,
  IntegratorGit,
  IntegratorGitReadFailure,
  IntegratorPreparationInput,
  IntegratorRequest,
  deriveIntegratorRunState,
  integratorCorrelationFor,
  integratorRunCorrelationForSession,
  prepareIntegrationCandidateRun
} from "../../../orchestrator/src/workflow/protocols/integrator/protocol.js"
import {
  appendIntegratorSuccessorSessionIfNeeded,
  type IntegratorSuccessorSessionFixedRecord
} from "../../../orchestrator/src/workflow/protocols/integrator/successor-session.js"
import { appendInitialConclusiveIntegrationQuarantine } from "../../../orchestrator/src/workflow/protocols/integration-quarantine/initial-conclusive.js"
import { appendRetryConclusiveIntegrationQuarantine } from "../../../orchestrator/src/workflow/protocols/integration-quarantine/retry-conclusive.js"
import {
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorResponsibilityFacts,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent,
  type IntegratorSessionCorrelation,
  type IntegratorRunProtocolResult,
  type IntegratorRunState
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import { IntegratorSuccessorPreparationInput } from "../../../orchestrator/src/workflow/protocols/integrator/session.js"

const runId = RunId.make("accepted-result-integration-model-run")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/accepted-result-integration.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const independentTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/accepted-result-integration-independent.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})

const commitOf = (value: bigint | number): GitCommitSha =>
  GitCommitSha.make(BigInt(value).toString(16).padStart(40, "0"))

const numericCommit = (value: GitCommitSha): bigint => BigInt(`0x${value}`)

const attempts = new Map(
  [1n, 2n].map((id) => [
    id,
    PlannedTaskAttempt.make({
      attemptId: AttemptId.make(`accepted-result-integration-attempt-${id}`),
      baseSha: commitOf(id),
      branch: TaskBranchRef.make(`refs/heads/dalph/accepted-result-integration-${id}`),
      executor: TaskExecutorLocator.make("executor:model"),
      runId,
      taskId: TaskId.make(`accepted-result-integration-task-${id}`),
      taskRevision: TaskRevision.make(`accepted-result-integration-revision-${id}`),
      worktree: WorktreeLocator.make(`/worktrees/accepted-result-integration-${id}`)
    })
  ])
)

const acceptedResultOf = (id: bigint): AcceptedResult => acceptedResultFixture(commitOf(id + 20n))

const candidateTextOf = (candidate: bigint): IntegratorCandidateText =>
  IntegratorCandidateText.make(`M-reported-candidate-${candidate}`)

const notPreparedDetail = IntegratorNotPreparedDetail.make("outer Integrator reached a conclusive NotPrepared result")

type Phase =
  | "NoAcceptedResult"
  | "AcceptedResult"
  | "LateAcceptedEvidence"
  | "Queued"
  | "Started"
  | "DependencyWait"
  | "IntegratorSessionFixed"
  | "IntegratorInFlight"
  | "IntegratorResponseLost"
  | "IntegratorNotPrepared"
  | "IntegratorRunResultRecorded"
  | "RetrySelected"
  | "RetryInFlight"
  | "RetryNotApplicable"
  | "FullRerunSelected"
  | "SuccessorSessionFixed"
  | "SuccessorInFlight"
  | "SuccessorResponseLost"
  | "CandidateGitReadIntent"
  | "CandidateGitReadPending"
  | "CandidateReady"
  | "CandidateRejected"
  | "Quarantined"
  | "PromotionPremise"
  | "PromotionIntent"
  | "PromotionAttemptIntended"
  | "PromotionInFlight"
  | "PromotionResponseLost"
  | "PromotionReconciliation"
  | "PromotionRetryReady"
  | "PromotionReadPending"
  | "PromotionSucceeded"
  | "PromotionStale"
  | "PromotionExhausted"

type IntegratorOutcome = "NoIntegratorOutcome" | "NotPrepared" | "PreparedCandidate"

type QuarantineDirection = "NoQuarantineDirection" | "RetryDirection" | "FullRerunDirection"

type QuarantineCause =
  | "NoQuarantineCause"
  | "NotPreparedQuarantine"
  | "CandidateRejectedQuarantine"
  | "RetryHeadChangedQuarantine"
  | "SuccessorNotPreparedQuarantine"

type CandidateGitObservation =
  | "NoCandidateGitObservation"
  | "CandidateMissing"
  | "CandidateNonCommit"
  | "CandidateWrongParents"
  | "CandidateExactParents"

type PromotionGitObservation =
  | "NoPromotionGitObservation"
  | "PromotionExactExpectedHead"
  | "PromotionCandidateCurrent"
  | "PromotionCandidateAncestor"
  | "PromotionOtherHead"
  | "PromotionUnreadableHead"

type ModelResult = {
  readonly phase: Phase
  readonly restartChoiceCommittedBeforeTerminal: boolean
  readonly acceptedEvidencePreserved: boolean
  readonly integrationResponsibilityRecorded: boolean
  readonly integrationResponsibilityCount: bigint
  readonly queuePosition: bigint
  readonly integrationTarget: bigint
  readonly preIntegrationCancellation: boolean
  readonly targetHeld: boolean
  readonly integrationSession: bigint
  readonly candidateResource: bigint
  readonly resourceBoundTarget: bigint
  readonly resourceBoundHead: bigint
  readonly resourceBoundCommit: bigint
  readonly plannedTargetHead: bigint
  readonly expectedTargetHead: bigint
  readonly acceptedResultCommit: bigint
  readonly lineageCompatible: boolean
  readonly sessionFixed: boolean
  readonly integratorInvocationCount: bigint
  readonly integratorResumeCount: bigint
  readonly integratorOutcome: IntegratorOutcome
  readonly integratorRunResultRecorded: boolean
  readonly candidateReported: boolean
  readonly integratorResponseAmbiguous: boolean
  readonly submittedCandidate: bigint
  readonly candidateJournalPosition: bigint
  readonly candidateGitReadIntentRecorded: boolean
  readonly candidateGitReadCount: bigint
  readonly candidateGitResponseAmbiguous: boolean
  readonly candidateGitObservation: CandidateGitObservation
  readonly candidateQualificationProven: boolean
  readonly observedFirstParent: bigint
  readonly observedSecondParent: bigint
  readonly resourceHeadCandidate: bigint
  readonly processSuccessObserved: boolean
  readonly legacyVerificationEvidence: boolean
  readonly promotionAuthorized: boolean
  readonly promotionIntentRecorded: boolean
  readonly promotionAttemptCount: bigint
  readonly promotionLastAttempt: bigint
  readonly promotionFreshExactHeadReads: bigint
  readonly promotionFreshExactHeadObservation: boolean
  readonly promotionTargetFactsCurrent: boolean
  readonly promotionExpectedHeadVerified: boolean
  readonly promotionGitObservation: PromotionGitObservation
  readonly promotionObservedTargetHead: bigint
  readonly promotionCandidateAncestryProven: boolean
  readonly promotionResultRecorded: boolean
  readonly promotionResponseAmbiguous: boolean
  readonly promotionCompareAndSetRequested: boolean
  readonly promotionForceRequested: boolean
  readonly promotionEquivalentContentAccepted: boolean
  readonly quarantineRecorded: boolean
  readonly quarantineOccurrenceCount: bigint
  readonly quarantinePosition: bigint
  readonly quarantineCause: QuarantineCause
  readonly quarantineDirection: QuarantineDirection
  readonly quarantineDirectionSession: bigint
  readonly quarantineDirectionPosition: bigint
  readonly quarantineDirectionCount: bigint
  readonly quarantineRedeliveryCount: bigint
  readonly quarantineConflictCount: bigint
  readonly retryRunCount: bigint
  readonly integratorRunOrdinal: bigint
  readonly integratorRunSession: bigint
  readonly lastRecoveryRunSession: bigint
  readonly lastRecoveryRunOrdinal: bigint
  readonly retryNotApplicableCount: bigint
  readonly retryFreshQuarantineCount: bigint
  readonly predecessorPreserved: boolean
  readonly successorSession: bigint
  readonly successorResource: bigint
  readonly successorTargetHead: bigint
  readonly successorFixed: boolean
  readonly successorRunCount: bigint
  readonly successorRunOrdinal: bigint
  readonly successorHeadFreshlyObserved: boolean
  readonly successorIntegratorInvocationCount: bigint
  readonly lastDirection: QuarantineDirection
  readonly lastDirectionSession: bigint
  readonly lastDirectionPosition: bigint
}

const initialResult = (id: bigint): ModelResult => ({
  phase: "NoAcceptedResult",
  restartChoiceCommittedBeforeTerminal: false,
  acceptedEvidencePreserved: false,
  integrationResponsibilityRecorded: false,
  integrationResponsibilityCount: 0n,
  queuePosition: 0n,
  integrationTarget: 1n,
  preIntegrationCancellation: false,
  targetHeld: false,
  integrationSession: 0n,
  candidateResource: 0n,
  resourceBoundTarget: 0n,
  resourceBoundHead: 0n,
  resourceBoundCommit: 0n,
  plannedTargetHead: id + 10n,
  expectedTargetHead: 0n,
  acceptedResultCommit: id + 20n,
  lineageCompatible: true,
  sessionFixed: false,
  integratorInvocationCount: 0n,
  integratorResumeCount: 0n,
  integratorOutcome: "NoIntegratorOutcome",
  integratorRunResultRecorded: false,
  candidateReported: false,
  integratorResponseAmbiguous: false,
  submittedCandidate: 0n,
  candidateJournalPosition: 0n,
  candidateGitReadIntentRecorded: false,
  candidateGitReadCount: 0n,
  candidateGitResponseAmbiguous: false,
  candidateGitObservation: "NoCandidateGitObservation",
  candidateQualificationProven: false,
  observedFirstParent: 0n,
  observedSecondParent: 0n,
  resourceHeadCandidate: 0n,
  processSuccessObserved: false,
  legacyVerificationEvidence: false,
  promotionAuthorized: false,
  promotionIntentRecorded: false,
  promotionAttemptCount: 0n,
  promotionLastAttempt: 0n,
  promotionFreshExactHeadReads: 0n,
  promotionFreshExactHeadObservation: false,
  promotionTargetFactsCurrent: false,
  promotionExpectedHeadVerified: false,
  promotionGitObservation: "NoPromotionGitObservation",
  promotionObservedTargetHead: 0n,
  promotionCandidateAncestryProven: false,
  promotionResultRecorded: false,
  promotionResponseAmbiguous: false,
  promotionCompareAndSetRequested: false,
  promotionForceRequested: false,
  promotionEquivalentContentAccepted: false,
  quarantineRecorded: false,
  quarantineOccurrenceCount: 0n,
  quarantinePosition: 0n,
  quarantineCause: "NoQuarantineCause",
  quarantineDirection: "NoQuarantineDirection",
  quarantineDirectionSession: 0n,
  quarantineDirectionPosition: 0n,
  quarantineDirectionCount: 0n,
  quarantineRedeliveryCount: 0n,
  quarantineConflictCount: 0n,
  retryRunCount: 0n,
  integratorRunOrdinal: 0n,
  integratorRunSession: 0n,
  lastRecoveryRunSession: 0n,
  lastRecoveryRunOrdinal: 0n,
  retryNotApplicableCount: 0n,
  retryFreshQuarantineCount: 0n,
  predecessorPreserved: false,
  successorSession: 0n,
  successorResource: 0n,
  successorTargetHead: 0n,
  successorFixed: false,
  successorRunCount: 0n,
  successorRunOrdinal: 0n,
  successorHeadFreshlyObserved: false,
  successorIntegratorInvocationCount: 0n,
  lastDirection: "NoQuarantineDirection",
  lastDirectionSession: 0n,
  lastDirectionPosition: 0n
})

const SpecResult = Schema.Struct({
  acceptedEvidencePreserved: Schema.Boolean,
  acceptedResultCommit: ITFBigInt,
  candidateGitObservation: Schema.Unknown,
  candidateGitReadCount: ITFBigInt,
  candidateGitReadIntentRecorded: Schema.Boolean,
  candidateGitResponseAmbiguous: Schema.Boolean,
  candidateJournalPosition: ITFBigInt,
  candidateQualificationProven: Schema.Boolean,
  candidateReported: Schema.Boolean,
  candidateResource: ITFBigInt,
  expectedTargetHead: ITFBigInt,
  integrationResponsibilityCount: ITFBigInt,
  integrationResponsibilityRecorded: Schema.Boolean,
  integrationSession: ITFBigInt,
  integrationTarget: ITFBigInt,
  integratorInvocationCount: ITFBigInt,
  integratorOutcome: Schema.Unknown,
  integratorResponseAmbiguous: Schema.Boolean,
  integratorRunResultRecorded: Schema.Boolean,
  integratorResumeCount: ITFBigInt,
  lineageCompatible: Schema.Boolean,
  sessionFixed: Schema.Boolean,
  observedFirstParent: ITFBigInt,
  observedSecondParent: ITFBigInt,
  phase: Schema.Unknown,
  plannedTargetHead: ITFBigInt,
  preIntegrationCancellation: Schema.Boolean,
  processSuccessObserved: Schema.Boolean,
  promotionAttemptCount: ITFBigInt,
  promotionAuthorized: Schema.Boolean,
  promotionCandidateAncestryProven: Schema.Boolean,
  promotionCompareAndSetRequested: Schema.Boolean,
  promotionEquivalentContentAccepted: Schema.Boolean,
  promotionExpectedHeadVerified: Schema.Boolean,
  promotionForceRequested: Schema.Boolean,
  promotionFreshExactHeadObservation: Schema.Boolean,
  promotionFreshExactHeadReads: ITFBigInt,
  promotionGitObservation: Schema.Unknown,
  promotionIntentRecorded: Schema.Boolean,
  promotionLastAttempt: ITFBigInt,
  promotionObservedTargetHead: ITFBigInt,
  promotionResponseAmbiguous: Schema.Boolean,
  promotionResultRecorded: Schema.Boolean,
  promotionTargetFactsCurrent: Schema.Boolean,
  predecessorPreserved: Schema.Boolean,
  quarantineCause: Schema.Unknown,
  quarantineConflictCount: ITFBigInt,
  quarantineDirection: Schema.Unknown,
  quarantineDirectionCount: ITFBigInt,
  quarantineDirectionPosition: ITFBigInt,
  quarantineDirectionSession: ITFBigInt,
  quarantineOccurrenceCount: ITFBigInt,
  quarantinePosition: ITFBigInt,
  quarantineRecorded: Schema.Boolean,
  quarantineRedeliveryCount: ITFBigInt,
  queuePosition: ITFBigInt,
  resourceBoundCommit: ITFBigInt,
  resourceBoundHead: ITFBigInt,
  resourceBoundTarget: ITFBigInt,
  restartChoiceCommittedBeforeTerminal: Schema.Boolean,
  resourceHeadCandidate: ITFBigInt,
  retryFreshQuarantineCount: ITFBigInt,
  retryNotApplicableCount: ITFBigInt,
  retryRunCount: ITFBigInt,
  submittedCandidate: ITFBigInt,
  successorFixed: Schema.Boolean,
  successorHeadFreshlyObserved: Schema.Boolean,
  successorIntegratorInvocationCount: ITFBigInt,
  successorResource: ITFBigInt,
  successorRunCount: ITFBigInt,
  successorRunOrdinal: ITFBigInt,
  successorSession: ITFBigInt,
  successorTargetHead: ITFBigInt,
  targetHeld: Schema.Boolean,
  legacyVerificationEvidence: Schema.Boolean,
  integratorRunOrdinal: ITFBigInt,
  integratorRunSession: ITFBigInt,
  lastDirection: Schema.Unknown,
  lastDirectionPosition: ITFBigInt,
  lastDirectionSession: ITFBigInt,
  lastRecoveryRunOrdinal: ITFBigInt,
  lastRecoveryRunSession: ITFBigInt
})

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    nextJournalPosition: ITFBigInt,
    recovered: Schema.Boolean,
    restartCount: ITFBigInt,
    results: ITFMap(ITFBigInt, SpecResult),
    targetFactsCurrent: Schema.Boolean,
    targetHeadProof: ITFBigInt,
    targetReacquisitionRequired: Schema.Boolean,
    trackerFactsCurrent: Schema.Boolean
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

type GitMode = "Exact" | "Missing" | "NonCommit" | "WrongParents"

type RuntimeState = {
  readonly journal: InRunJournal["Service"]
  readonly readRecords: () => ReadonlyArray<JournalRecord>
  readonly runProtocol: (id: bigint) => Effect.Effect<IntegratorRunProtocolResult, unknown>
  readonly runProtocolFor: (
    input: IntegratorPreparationInput,
    run: IntegratorRunCorrelation
  ) => Effect.Effect<IntegratorRunProtocolResult, unknown>
  readonly integrator: Integrator["Service"]
  readonly setGitMode: (mode: GitMode) => void
  readonly failNextGitRead: () => void
  readonly failNextIntegratorCall: () => void
  readonly reset: () => void
  readonly updateTargetLineageTarget: (id: bigint, integrationTarget: IntegrationTarget) => void
  readonly integratorCallCount: () => number
}

const rejectImpossibleTransition = (detail: string): never => Effect.runSync(Effect.die(new Error(detail)))

const targetLineagePositionFor = (id: bigint): JournalPosition => JournalPosition.make(id === 1n ? 3 : 5)

const queuedAtFor = (id: bigint): JournalPosition => JournalPosition.make(id === 1n ? 6 : 7)

const startedAtFor = (id: bigint): JournalPosition => JournalPosition.make(id === 1n ? 8 : 9)

const attemptFor = (id: bigint): PlannedTaskAttempt => {
  const attempt = attempts.get(id)
  if (attempt === undefined) return rejectImpossibleTransition(`unknown model attempt ${id}`)
  return attempt
}

const targetFor = (id: bigint, modelResults: ReadonlyMap<bigint, ModelResult>): IntegrationTarget =>
  modelResults.get(id)?.integrationTarget === 2n ? independentTarget : target

const makeTargetRecords = (): ReadonlyArray<JournalRecord> => [
  makeWorkflowRunBeganRecord(
    runId,
    FixtureTarget.make("accepted-result-integration-model-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
  ),
  ...[1n, 2n].flatMap((id) => {
    const attempt = attemptFor(id)
    const operationId = OperationId.make(`accepted-result-integration-target-lineage-${id}`)
    const operation = makeTargetLineageObservationOperation({
      integrationTarget: target,
      operationId,
      plannedAttempt: attempt,
      predecessorOperationIds: []
    })
    const intent = GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation,
      version: workflowJournalEventVersion
    })
    const observation = TargetLineageObservedEvent.make({
      observation: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: attempt.baseSha,
        targetHeadSha: commitOf(id + 10n)
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId,
      plannedAttempt: attempt,
      version: workflowJournalEventVersion
    })
    return [
      {
        event: intent,
        key: describeJournalEvent(intent).expectedKey,
        position: JournalPosition.make(id === 1n ? 2 : 4),
        runId
      },
      {
        event: observation,
        key: describeJournalEvent(observation).expectedKey,
        position: targetLineagePositionFor(id),
        runId
      }
    ]
  })
]

const makeResponsibility = (
  id: bigint,
  modelResults: ReadonlyMap<bigint, ModelResult>,
  records: ReadonlyArray<JournalRecord> = []
): StartedIntegrationResponsibility =>
  (() => {
    const attempt = attemptFor(id)
    const queued = records.find(
      (record) =>
        record.event._tag === "IntegrationResponsibilityBegan" &&
        record.event.plannedAttempt.attemptId === attempt.attemptId
    )
    const started = records.find(
      (record) =>
        record.event._tag === "IntegrationStarted" && record.event.plannedAttempt.attemptId === attempt.attemptId
    )
    return StartedIntegrationResponsibility.make({
      acceptedResult: acceptedResultOf(id),
      integrationTarget: targetFor(id, modelResults),
      plannedAttempt: attempt,
      queuedAt: queued?.position ?? queuedAtFor(id),
      startedAt: started?.position ?? startedAtFor(id)
    })
  })()

const makeInput = (
  id: bigint,
  modelResults: ReadonlyMap<bigint, ModelResult>,
  records: ReadonlyArray<JournalRecord> = []
): IntegratorPreparationInput => {
  const responsibility = makeResponsibility(id, modelResults, records)
  const result = modelResults.get(id)
  if (result === undefined) return rejectImpossibleTransition(`unknown model result ${id}`)
  return IntegratorPreparationInput.make({
    responsibility,
    targetLineage: TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: result.lineageCompatible,
      plannedBaseSha: responsibility.plannedAttempt.baseSha,
      targetHeadSha: commitOf(result.expectedTargetHead === 0n ? result.plannedTargetHead : result.expectedTargetHead)
    }),
    targetLineageObservedAt: targetLineagePositionFor(id)
  })
}

const candidateObservationFor = (
  mode: GitMode,
  targetHead: GitCommitSha,
  acceptedCommit: GitCommitSha,
  candidateText: IntegratorCandidateText,
  candidate: bigint
): IntegratorGitObservation => {
  if (mode === "Missing") return IntegratorGitObservation.cases.Missing.make({ candidateText })
  if (mode === "NonCommit") {
    return IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType: "tree" })
  }
  const directParents = mode === "WrongParents" ? [acceptedCommit, targetHead] : [targetHead, acceptedCommit]
  return IntegratorGitObservation.cases.Commit.make({ candidateText, commit: commitOf(candidate), directParents })
}

const resultCorrelation = (
  id: bigint,
  records: ReadonlyArray<JournalRecord>,
  modelResults: ReadonlyMap<bigint, ModelResult>
): IntegratorSessionCorrelation => {
  const facts = IntegratorResponsibilityFacts.make(makeResponsibility(id, modelResults, records))
  const key = integratorSessionFixedRecordKey(facts)
  const session = records.find(
    (record): record is JournalRecord & { readonly event: typeof IntegratorSessionFixedEvent.Type } =>
      record.key === key && record.event._tag === "IntegratorSessionFixed"
  )
  return session?.event.correlation ?? integratorCorrelationFor(makeInput(id, modelResults, records))
}

const initialRunFor = (input: IntegratorPreparationInput): IntegratorRunCorrelation =>
  IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: integratorCorrelationFor(input) })

type ReconstructedIntegratorState = IntegratorRunState

const isIntegratorResultState = (state: ReconstructedIntegratorState): boolean =>
  state._tag === "NotPrepared" ||
  state._tag === "PreparedAwaitingGit" ||
  state._tag === "CandidateRejected" ||
  state._tag === "GitQualifiedPrepared"

const candidateTextFromState = (state: ReconstructedIntegratorState): IntegratorCandidateText | undefined => {
  if (
    state._tag === "PreparedAwaitingGit" ||
    state._tag === "CandidateRejected" ||
    state._tag === "GitQualifiedPrepared"
  ) {
    return state.candidateText
  }
  return undefined
}

const candidateObservationFromState = (state: ReconstructedIntegratorState): IntegratorGitObservation | undefined =>
  state._tag === "CandidateRejected"
    ? state.observation
    : state._tag === "GitQualifiedPrepared"
      ? IntegratorGitObservation.cases.Commit.make({
          candidateText: state.candidateText,
          commit: state.candidateCommit,
          directParents: state.observation.directParents
        })
      : undefined

const candidateNumberFromText = (text: IntegratorCandidateText | undefined): bigint | undefined => {
  if (text === undefined) return undefined
  const match = /^M-reported-candidate-(\d+)$/.exec(text)
  return match?.[1] === undefined ? undefined : BigInt(match[1])
}

const candidateObservationTag = (
  observation: IntegratorGitObservation | undefined,
  expectedTargetHead: GitCommitSha,
  acceptedResultCommit: GitCommitSha
): CandidateGitObservation => {
  if (observation === undefined) return "NoCandidateGitObservation"
  if (observation._tag === "Missing") return "CandidateMissing"
  if (observation._tag === "NonCommit") return "CandidateNonCommit"
  return observation.directParents.length === 2 &&
    observation.directParents[0] === expectedTargetHead &&
    observation.directParents[1] === acceptedResultCommit
    ? "CandidateExactParents"
    : "CandidateWrongParents"
}

const phaseNeedsSession = (phase: Phase): boolean =>
  !new Set<Phase>([
    "NoAcceptedResult",
    "AcceptedResult",
    "LateAcceptedEvidence",
    "Queued",
    "Started",
    "DependencyWait"
  ]).has(phase)

const phaseNeedsResult = (phase: Phase): boolean =>
  new Set<Phase>([
    "IntegratorNotPrepared",
    "IntegratorRunResultRecorded",
    "RetrySelected",
    "RetryInFlight",
    "RetryNotApplicable",
    "FullRerunSelected",
    "SuccessorSessionFixed",
    "SuccessorInFlight",
    "SuccessorResponseLost",
    "CandidateGitReadIntent",
    "CandidateGitReadPending",
    "CandidateReady",
    "CandidateRejected",
    "Quarantined",
    "PromotionPremise",
    "PromotionIntent",
    "PromotionAttemptIntended",
    "PromotionInFlight",
    "PromotionResponseLost",
    "PromotionReconciliation",
    "PromotionRetryReady",
    "PromotionReadPending",
    "PromotionSucceeded",
    "PromotionStale",
    "PromotionExhausted"
  ]).has(phase)

const phaseNeedsPreparedResult = (phase: Phase): boolean =>
  new Set<Phase>([
    "IntegratorRunResultRecorded",
    "CandidateGitReadIntent",
    "CandidateGitReadPending",
    "CandidateReady",
    "CandidateRejected",
    "PromotionPremise",
    "PromotionIntent",
    "PromotionAttemptIntended",
    "PromotionInFlight",
    "PromotionResponseLost",
    "PromotionReconciliation",
    "PromotionRetryReady",
    "PromotionReadPending",
    "PromotionSucceeded",
    "PromotionStale",
    "PromotionExhausted"
  ]).has(phase)

const makeRuntime = (
  modelResultsRef: () => ReadonlyMap<bigint, ModelResult>,
  modelResultFor: (id: bigint) => ModelResult
): RuntimeState => {
  let records: ReadonlyArray<JournalRecord> = makeTargetRecords()
  let gitMode: GitMode = "Exact"
  let failNextGit = false
  let integratorCalls = 0
  let failNextIntegrator = false

  const appendRecord = (requestedRunId: RunId, key: JournalRecordKey, event: AppendableWorkflowJournalEvent) =>
    Effect.sync(() => {
      const existing = records.find((record) => record.key === key)
      if (existing !== undefined) return existing
      const lastPosition = records.reduce((maximum, record) => Math.max(maximum, record.position), 0)
      const record: JournalRecord = {
        event,
        key,
        position: JournalPosition.make(lastPosition + 1),
        runId: requestedRunId
      }
      records = [...records, record]
      return record
    })

  const journal = InRunJournal.of({
    append: appendRecord,
    read: (requestedRunId) => Effect.succeed(records.filter((record) => record.runId === requestedRunId))
  })

  const integrator = Integrator.of({
    prepare: (request) => {
      integratorCalls += 1
      if (failNextIntegrator) {
        failNextIntegrator = false
        return Effect.fail(
          new IntegratorCallFailure({ correlation: request.correlation, detail: "controlled response lost" })
        )
      }
      return Effect.succeed(
        IntegratorResult.cases.PreparedCandidate.make({
          candidateText: candidateTextOf(
            modelResultFor(1n).submittedCandidate === 0n ? 31n : modelResultFor(1n).submittedCandidate
          ),
          correlation: request.correlation
        })
      )
    }
  })

  const git = IntegratorGit.of({
    readCandidate: (requestedTarget, candidateText) => {
      if (failNextGit) {
        failNextGit = false
        return Effect.fail(
          new IntegratorGitReadFailure({
            candidateText,
            detail: "controlled Git read response lost",
            target: requestedTarget
          })
        )
      }
      const id = [...modelResultsRef()].find(([, result]) => result.submittedCandidate !== 0n)?.[0] ?? 1n
      const result = modelResultFor(id)
      return Effect.succeed(
        candidateObservationFor(
          gitMode,
          commitOf(result.expectedTargetHead),
          commitOf(result.acceptedResultCommit),
          candidateText,
          result.submittedCandidate === 0n ? 31n : result.submittedCandidate
        )
      )
    }
  })

  const runProtocol = (id: bigint) => {
    const input = makeInput(id, modelResultsRef(), records)
    return prepareIntegrationCandidateRun({ preparation: input, run: initialRunFor(input) }).pipe(
      Effect.provideService(InRunJournal, journal),
      Effect.provideService(Integrator, integrator),
      Effect.provideService(IntegratorGit, git)
    )
  }

  const runProtocolFor = (input: IntegratorPreparationInput, run: IntegratorRunCorrelation) =>
    prepareIntegrationCandidateRun({ preparation: input, run }).pipe(
      Effect.provideService(InRunJournal, journal),
      Effect.provideService(Integrator, integrator),
      Effect.provideService(IntegratorGit, git)
    )

  const updateTargetLineageTarget = (id: bigint, integrationTarget: IntegrationTarget): void => {
    const operationId = OperationId.make(`accepted-result-integration-target-lineage-${id}`)
    const operation = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId,
      plannedAttempt: attemptFor(id),
      predecessorOperationIds: []
    })
    records = records.map((record) => {
      if (
        record.event._tag !== "GitReadIntentRecorded" ||
        record.event.operation._tag !== "ReadTargetLineage" ||
        record.event.operation.operationId !== operationId
      ) {
        return record
      }
      const event = GitReadIntentRecordedEvent.make({
        initiatedBy: record.event.initiatedBy,
        occurrenceClassification: record.event.occurrenceClassification,
        operation,
        version: record.event.version
      })
      return { ...record, event, key: describeJournalEvent(event).expectedKey }
    })
  }

  const reset = (): void => {
    records = makeTargetRecords()
    gitMode = "Exact"
    failNextGit = false
    integratorCalls = 0
    failNextIntegrator = false
  }

  return {
    journal,
    readRecords: () => records,
    runProtocol,
    runProtocolFor,
    integrator,
    setGitMode: (mode) => {
      gitMode = mode
    },
    failNextGitRead: () => {
      failNextGit = true
    },
    failNextIntegratorCall: () => {
      failNextIntegrator = true
    },
    reset,
    updateTargetLineageTarget,
    integratorCallCount: () => integratorCalls
  }
}

const acceptedResultIntegrationDriver = defineDriver(
  {
    acceptResultOne: {},
    acceptResultTwo: {},
    assignResultTwoIndependentTargetOne: {},
    chooseFullRerunOne: {},
    chooseRetryOne: {},
    fixIntegratorSessionOne: {},
    fixIntegratorSessionTwo: {},
    init: {},
    invokeIntegratorOne: {},
    loseCandidateGitResponseOne: {},
    loseCandidateGitResponseTwo: {},
    loseIntegratorResponseOne: {},
    losePromotionAttemptResponseOne: {},
    loseSuccessorResponseOne: {},
    observeAppliedRestartBeforeAcceptedOne: {},
    observeExactCandidateOne: {},
    observeIncompatibleTargetLineageOne: {},
    observeMissingCandidateOne: {},
    observeNonCommitCandidateOne: {},
    observePromotionCandidateAncestorOne: {},
    observePromotionCandidateCurrentOne: {},
    observePromotionExactExpectedHeadOne: {},
    observePromotionGitUnreadableOne: {},
    observePromotionOtherHeadOne: {},
    observeSuccessorTargetHeadOne: {},
    readCandidateGitOne: {},
    observeTargetFactsOne: {},
    observeTargetFactsTwo: {},
    observeTrackerFactsStep: {},
    observeWrongParentCandidateOne: {},
    offerPromotionPremiseOne: {},
    queueAcceptedResultOne: {},
    queueAcceptedResultTwo: {},
    reacquireIntegrationTargetOne: {},
    recoverCoordinatorStep: {},
    recordCandidateGitReadIntentOne: {},
    reportIntegratorCandidateOne31: {},
    reportIntegratorCandidateOne32: {},
    reportIntegratorNotPreparedOne: {},
    redeliverFullRerunOne: {},
    redeliverRetryOne: {},
    rejectConflictingFullRerunOne: {},
    recordQuarantineOne: {},
    recordRetryNotApplicableOne: {},
    recordPromotionAttemptIntentOne: {},
    recordPromotionIntentOne: {},
    reconcileCandidateGitOne: {},
    reconcilePromotionOne: {},
    resumeIntegratorOne: {},
    sendPromotionAttemptOne: {},
    startFullRerunOne: {},
    startIntegrationOne: {},
    startIntegrationTwo: {},
    startRetryOne: {},
    startSuccessorIntegratorOne: {},
    waitOnDependencyOne: {}
  },
  () => {
    let modelResults = new Map<bigint, ModelResult>([1n, 2n].map((id) => [id, initialResult(id)]))
    let modelNextJournalPosition = 1n
    let modelRestartCount = 0n
    let recovered = false
    let trackerFactsCurrent = true
    let targetFactsCurrent = true
    let targetHeadProof = 0n
    let targetReacquisitionRequired = false

    const modelResultFor = (id: bigint): ModelResult => {
      const result = modelResults.get(id)
      if (result === undefined) return rejectImpossibleTransition(`unknown model result ${id}`)
      return result
    }

    const updateModelResult = (id: bigint, update: (result: ModelResult) => ModelResult): void => {
      modelResults = new Map(modelResults).set(id, update(modelResultFor(id)))
    }

    const updateModelResults = (update: (result: ModelResult) => ModelResult): void => {
      modelResults = new Map([...modelResults].map(([id, result]) => [id, update(result)]))
    }

    const runtime: RuntimeState = makeRuntime(
      () => modelResults,
      (id) => modelResultFor(id)
    )

    const appendEvent = (key: JournalRecordKey, event: AppendableWorkflowJournalEvent) =>
      runtime.journal.append(runId, key, event)

    const correlationFor = (id: bigint): IntegratorSessionCorrelation =>
      resultCorrelation(id, runtime.readRecords(), modelResults)

    const runFor = (id: bigint, ordinal?: bigint): IntegratorRunCorrelation => {
      const session = correlationFor(id)
      const runOrdinal =
        ordinal ?? (modelResultFor(id).integratorRunOrdinal === 0n ? 1n : modelResultFor(id).integratorRunOrdinal)
      return integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(Number(runOrdinal)))
    }

    const currentRunFor = (id: bigint): IntegratorRunCorrelation => {
      const predecessor = correlationFor(id)
      const successor = runtime
        .readRecords()
        .findLast(
          (record) =>
            record.event._tag === "IntegratorSuccessorSessionFixed" &&
            record.event.predecessor.sessionId === predecessor.sessionId
        )
      const session =
        successor?.event._tag === "IntegratorSuccessorSessionFixed" ? successor.event.successor : predecessor
      const started = runtime
        .readRecords()
        .findLast(
          (record) =>
            record.event._tag === "IntegratorRunStarted" && record.event.run.session.sessionId === session.sessionId
        )
      return IntegratorRunCorrelation.make({
        ordinal:
          started?.event._tag === "IntegratorRunStarted"
            ? started.event.run.ordinal
            : IntegratorRunOrdinal.make(
                modelResultFor(id).integratorRunOrdinal === 0n ? 1 : Number(modelResultFor(id).integratorRunOrdinal)
              ),
        session
      })
    }

    const responsibilityFor = (id: bigint): StartedIntegrationResponsibility =>
      makeResponsibility(id, modelResults, runtime.readRecords())

    const appendSession = (id: bigint) => {
      const input = makeInput(id, modelResults, runtime.readRecords())
      const correlation = integratorCorrelationFor(input)
      const facts = IntegratorResponsibilityFacts.make(responsibilityFor(id))
      return appendEvent(
        integratorSessionFixedRecordKey(facts),
        IntegratorSessionFixedEvent.make({ correlation, version: workflowJournalEventVersion })
      )
    }

    const appendRunStart = (run: IntegratorRunCorrelation) => {
      const key = integratorRunStartedRecordKey(run)
      return runtime.readRecords().some((record) => record.key === key)
        ? Effect.void
        : appendEvent(key, IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion }))
    }

    const appendIntegratorResult = (id: bigint, result: IntegratorResult) => {
      const run = runFor(id)
      return Effect.gen(function* () {
        yield* appendRunStart(run)
        yield* appendEvent(
          integratorRunResultRecordedRecordKey(run),
          IntegratorRunResultRecordedEvent.make({ result, run, version: workflowJournalEventVersion })
        )
      })
    }

    const appendCandidateIntent = (id: bigint) => {
      const run = runFor(id)
      const candidateText = candidateTextOf(modelResultFor(id).submittedCandidate)
      return Effect.gen(function* () {
        yield* appendRunStart(run)
        yield* appendEvent(
          integratorRunCandidateGitReadIntendedRecordKey(run, candidateText),
          IntegratorRunCandidateGitReadIntendedEvent.make({ candidateText, run, version: workflowJournalEventVersion })
        )
      })
    }

    const appendResponsibility = (id: bigint) =>
      appendEvent(
        integrationResponsibilityBeganRecordKey(attemptFor(id).attemptId),
        IntegrationResponsibilityBeganEvent.make({
          acceptedResult: acceptedResultOf(id),
          integrationTarget: targetFor(id, modelResults),
          plannedAttempt: attemptFor(id),
          version: workflowJournalEventVersion
        })
      )

    const appendIntegrationStart = (id: bigint) => {
      const responsibility = responsibilityFor(id)
      return appendEvent(
        integrationStartedRecordKey(attemptFor(id).attemptId),
        IntegrationStartedEvent.make({
          acceptedResult: responsibility.acceptedResult,
          integrationTarget: responsibility.integrationTarget,
          plannedAttempt: responsibility.plannedAttempt,
          responsibilityBeganAt: responsibility.queuedAt,
          version: workflowJournalEventVersion
        })
      )
    }

    const latestQuarantineRecord = (id: bigint): JournalRecord => {
      const session = correlationFor(id).sessionId
      const record = runtime
        .readRecords()
        .filter(
          (candidate) =>
            candidate.event._tag === "IntegrationQuarantined" && candidate.event.correlation.sessionId === session
        )
        .toSorted((left, right) => left.position - right.position)
        .at(-1)
      return record ?? rejectImpossibleTransition(`missing quarantine record for Integrator session ${session}`)
    }

    const directionRecordFor = (id: bigint, direction: "Retry" | "FullRerun"): JournalRecord => {
      const quarantine = latestQuarantineRecord(id)
      const record = runtime
        .readRecords()
        .find(
          (candidate) =>
            candidate.event._tag === "IntegrationQuarantineDirectionApplied" &&
            candidate.event.fingerprint.direction === direction &&
            candidate.event.fingerprint.quarantineAt === quarantine.position &&
            candidate.event.fingerprint.sessionId === correlationFor(id).sessionId
        )
      return (
        record ??
        rejectImpossibleTransition(`missing ${direction} direction record for session ${correlationFor(id).sessionId}`)
      )
    }

    const applyDirection = (id: bigint, direction: "Retry" | "FullRerun", nonce: string) => {
      const quarantine = latestQuarantineRecord(id)
      const fingerprint = IntegrationQuarantineDirectionFingerprint.make({
        direction,
        quarantineAt: quarantine.position,
        sessionId: correlationFor(id).sessionId
      })
      const request = ApplyIntegrationQuarantineDirectionRequest.make({
        fingerprint,
        requestId: IntegrationQuarantineDirectionRequestId.make({ nonce, runId })
      })
      return Effect.gen(function* () {
        const control = yield* makeIntegrationQuarantineDirectionControl(runtime.journal)
        return yield* control.apply(request)
      })
    }

    const redeliverDirection = (id: bigint, direction: "Retry" | "FullRerun") => {
      const record = directionRecordFor(id, direction)
      if (record.event._tag !== "IntegrationQuarantineDirectionApplied") {
        return Effect.die(`direction record for ${direction} is malformed`)
      }
      const request = ApplyIntegrationQuarantineDirectionRequest.make({
        fingerprint: record.event.fingerprint,
        requestId: record.event.requestId
      })
      return Effect.gen(function* () {
        const control = yield* makeIntegrationQuarantineDirectionControl(runtime.journal)
        return yield* control.apply(request)
      })
    }

    const appendFreshTargetLineage = (id: bigint, targetHead: bigint, purpose: "retry" | "successor") => {
      const operationId = OperationId.make(`accepted-result-integration-${purpose}-target-lineage-${id}`)
      const operation = makeTargetLineageObservationOperation({
        integrationTarget: targetFor(id, modelResults),
        operationId,
        plannedAttempt: attemptFor(id),
        predecessorOperationIds: []
      })
      const intent = GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation,
        version: workflowJournalEventVersion
      })
      const observation = TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: attemptFor(id).baseSha,
          targetHeadSha: commitOf(targetHead)
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId,
        plannedAttempt: attemptFor(id),
        version: workflowJournalEventVersion
      })
      return Effect.gen(function* () {
        yield* appendEvent(describeJournalEvent(intent).expectedKey, intent)
        return yield* appendEvent(describeJournalEvent(observation).expectedKey, observation)
      })
    }

    const assertLostRun = (run: IntegratorRunCorrelation, outcome: { readonly _tag: string }): void => {
      if (outcome._tag !== "Failure") {
        return rejectImpossibleTransition(
          `Integrator run ${run.ordinal} unexpectedly completed instead of losing its response`
        )
      }
      const started = runtime.readRecords().find((record) => record.key === integratorRunStartedRecordKey(run))
      if (started === undefined || started.event._tag !== "IntegratorRunStarted") {
        return rejectImpossibleTransition(`Integrator run ${run.ordinal} lost its response without a durable run-start`)
      }
      if (runtime.readRecords().some((record) => record.key === integratorRunResultRecordedRecordKey(run))) {
        return rejectImpossibleTransition(`Integrator run ${run.ordinal} lost its response but recorded a result`)
      }
    }

    const successorPreparationFor = (id: bigint): IntegratorSuccessorPreparationInput => {
      const predecessor = correlationFor(id)
      const quarantine = latestQuarantineRecord(id)
      const direction = directionRecordFor(id, "FullRerun")
      const lineage = runtime
        .readRecords()
        .filter(
          (record) =>
            record.event._tag === "TargetLineageObserved" &&
            record.position > direction.position &&
            record.event.plannedAttempt.attemptId === predecessor.plannedAttempt.attemptId
        )
        .toSorted((left, right) => left.position - right.position)
        .at(-1)
      if (lineage === undefined || lineage.event._tag !== "TargetLineageObserved") {
        return rejectImpossibleTransition("FullRerun successor lacks its fresh target-lineage observation")
      }
      return IntegratorSuccessorPreparationInput.make({
        directionAppliedAt: direction.position,
        predecessor,
        quarantineAt: quarantine.position,
        targetLineage: lineage.event.observation,
        targetLineageObservedAt: lineage.position
      })
    }

    const modelObserveCandidate = (id: bigint, observation: CandidateGitObservation): void => {
      const result = modelResultFor(id)
      const candidateJournalPosition = modelNextJournalPosition
      modelNextJournalPosition += 1n
      const exact = observation === "CandidateExactParents"
      const firstParent = exact
        ? result.expectedTargetHead
        : observation === "CandidateWrongParents"
          ? result.acceptedResultCommit
          : 0n
      const secondParent = exact
        ? result.acceptedResultCommit
        : observation === "CandidateWrongParents"
          ? result.expectedTargetHead
          : 0n
      updateModelResult(id, (current) => ({
        ...current,
        phase: exact ? "CandidateReady" : "CandidateRejected",
        targetHeld: exact ? false : true,
        candidateGitObservation: observation,
        candidateJournalPosition,
        observedFirstParent: firstParent,
        observedSecondParent: secondParent,
        candidateQualificationProven: exact,
        promotionAuthorized: exact,
        candidateGitResponseAmbiguous: false
      }))
    }

    const modelReset = (): void => {
      modelResults = new Map([1n, 2n].map((id) => [id, initialResult(id)]))
      modelNextJournalPosition = 1n
      modelRestartCount = 0n
      recovered = false
      trackerFactsCurrent = true
      targetFactsCurrent = true
      targetHeadProof = 0n
      targetReacquisitionRequired = false
      runtime.reset()
    }

    const modelAccept = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: result.restartChoiceCommittedBeforeTerminal ? "LateAcceptedEvidence" : "AcceptedResult",
        acceptedEvidencePreserved: true
      }))

    const modelQueue = (id: bigint): void => {
      const queuePosition = modelNextJournalPosition
      modelNextJournalPosition += 1n
      updateModelResult(id, (result) => ({
        ...result,
        phase: "Queued",
        integrationResponsibilityRecorded: true,
        integrationResponsibilityCount: 1n,
        queuePosition,
        preIntegrationCancellation: true
      }))
    }

    const targetReacquisitionPhase = (phase: Phase): boolean =>
      new Set<Phase>([
        "Started",
        "IntegratorSessionFixed",
        "IntegratorInFlight",
        "IntegratorResponseLost",
        "IntegratorRunResultRecorded",
        "CandidateGitReadIntent",
        "CandidateGitReadPending",
        "CandidateReady",
        "PromotionPremise"
      ]).has(phase)

    const modelStart = (id: bigint): void => {
      const expectedTargetHead = id + 10n
      updateModelResult(id, (result) => ({
        ...result,
        phase: "Started",
        preIntegrationCancellation: false,
        targetHeld: true,
        integrationSession: id,
        expectedTargetHead
      }))
      targetHeadProof = expectedTargetHead
      targetReacquisitionRequired = [...modelResults].some(
        ([other, result]) => other !== id && !result.targetHeld && targetReacquisitionPhase(result.phase)
      )
    }

    const modelWait = (id: bigint): void =>
      updateModelResult(id, (result) => ({ ...result, phase: "DependencyWait", targetHeld: false }))

    const modelFixSession = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "IntegratorSessionFixed",
        sessionFixed: true,
        candidateResource: id + 100n,
        resourceBoundTarget: result.integrationTarget,
        resourceBoundHead: result.expectedTargetHead,
        resourceBoundCommit: result.acceptedResultCommit
      }))

    const modelLoseIntegrator = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "IntegratorResponseLost",
        targetHeld: false,
        integratorResponseAmbiguous: true
      }))
      trackerFactsCurrent = false
      targetFactsCurrent = false
      targetHeadProof = 0n
      targetReacquisitionRequired = true
    }

    const modelResume = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "IntegratorInFlight",
        integratorInvocationCount: result.integratorInvocationCount === 0n ? 1n : result.integratorInvocationCount,
        integratorResumeCount: result.integratorResumeCount + 1n,
        integratorResponseAmbiguous: false
      }))
      targetReacquisitionRequired = false
    }

    const modelNotPrepared = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "IntegratorNotPrepared",
        targetHeld: true,
        integratorOutcome: "NotPrepared",
        integratorRunResultRecorded: true,
        candidateReported: false,
        promotionAuthorized: false,
        integratorResponseAmbiguous: false
      }))

    const modelChooseDirection = (id: bigint, direction: QuarantineDirection): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: direction === "RetryDirection" ? "RetrySelected" : "FullRerunSelected",
        quarantineDirection: direction,
        quarantineDirectionSession: result.integrationSession,
        quarantineDirectionPosition: result.quarantinePosition,
        quarantineDirectionCount: result.quarantineDirectionCount + 1n,
        lastDirection: direction,
        lastDirectionSession: result.integrationSession,
        lastDirectionPosition: result.quarantinePosition
      }))

    const modelRedeliverDirection = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        quarantineRedeliveryCount: result.quarantineRedeliveryCount + 1n
      }))

    const modelRejectConflictingDirection = (id: bigint): void =>
      updateModelResult(id, (result) => ({ ...result, quarantineConflictCount: result.quarantineConflictCount + 1n }))

    const modelStartRetry = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "RetryInFlight",
        targetHeld: true,
        retryRunCount: result.retryRunCount === 0n ? 1n : result.retryRunCount,
        integratorInvocationCount:
          result.retryRunCount === 0n ? result.integratorInvocationCount + 1n : result.integratorInvocationCount,
        integratorRunOrdinal:
          result.retryRunCount === 0n ? result.integratorRunOrdinal + 1n : result.integratorRunOrdinal,
        integratorRunSession: result.integrationSession,
        lastRecoveryRunSession: result.retryRunCount === 0n ? 0n : result.lastRecoveryRunSession,
        lastRecoveryRunOrdinal: result.retryRunCount === 0n ? 0n : result.lastRecoveryRunOrdinal
      }))

    const modelRetryNotApplicable = (id: bigint): void => {
      const quarantinePosition = modelNextJournalPosition
      modelNextJournalPosition += 1n
      updateModelResult(id, (result) => ({
        ...result,
        phase: "RetryNotApplicable",
        targetHeld: false,
        quarantineRecorded: true,
        quarantineOccurrenceCount: result.quarantineOccurrenceCount + 1n,
        quarantinePosition,
        quarantineCause: "RetryHeadChangedQuarantine",
        quarantineDirection: "NoQuarantineDirection",
        quarantineDirectionSession: 0n,
        quarantineDirectionPosition: 0n,
        quarantineConflictCount: 0n,
        retryNotApplicableCount: result.retryNotApplicableCount + 1n,
        retryFreshQuarantineCount: result.retryFreshQuarantineCount + 1n
      }))
    }

    const modelObserveSuccessorTargetHead = (id: bigint): void => {
      const result = modelResultFor(id)
      updateModelResult(id, (current) => ({ ...current, successorHeadFreshlyObserved: true }))
      targetFactsCurrent = true
      targetHeadProof = result.expectedTargetHead
      targetReacquisitionRequired = false
    }

    const modelStartFullRerun = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "SuccessorSessionFixed",
        targetHeld: true,
        predecessorPreserved: true,
        successorSession: id + 1000n,
        successorResource: id + 1100n,
        successorTargetHead: targetHeadProof,
        successorFixed: true,
        successorRunCount: 1n,
        successorRunOrdinal: 1n,
        lastRecoveryRunSession: 0n,
        lastRecoveryRunOrdinal: 0n
      }))

    const modelStartSuccessor = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "SuccessorInFlight",
        successorIntegratorInvocationCount: 1n
      }))

    const modelLoseSuccessor = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, phase: "SuccessorResponseLost", targetHeld: false }))
      trackerFactsCurrent = false
      targetFactsCurrent = false
      targetHeadProof = 0n
      targetReacquisitionRequired = true
    }

    const modelRecordQuarantine = (id: bigint): void => {
      const result = modelResultFor(id)
      const quarantineCause: QuarantineCause =
        result.phase === "IntegratorNotPrepared" ? "NotPreparedQuarantine" : "CandidateRejectedQuarantine"
      const quarantinePosition = modelNextJournalPosition
      modelNextJournalPosition += 1n
      updateModelResult(id, (current) => ({
        ...current,
        phase: "Quarantined",
        targetHeld: false,
        quarantineRecorded: true,
        quarantineOccurrenceCount: current.quarantineOccurrenceCount + 1n,
        quarantinePosition,
        quarantineCause,
        quarantineDirection: "NoQuarantineDirection",
        quarantineDirectionSession: 0n,
        quarantineDirectionPosition: 0n,
        quarantineRedeliveryCount: 0n,
        retryNotApplicableCount: 0n,
        retryFreshQuarantineCount: 0n
      }))
    }

    const modelCandidate = (id: bigint, candidate: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "IntegratorRunResultRecorded",
        integratorOutcome: "PreparedCandidate",
        integratorRunResultRecorded: true,
        candidateReported: true,
        submittedCandidate: candidate,
        candidateGitObservation: "NoCandidateGitObservation",
        candidateQualificationProven: false,
        candidateGitReadIntentRecorded: false,
        candidateGitReadCount: 0n,
        candidateJournalPosition: 0n,
        observedFirstParent: 0n,
        observedSecondParent: 0n,
        promotionAuthorized: false
      }))

    const modelRecordGitIntent = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "CandidateGitReadIntent",
        candidateGitReadIntentRecorded: true,
        candidateGitResponseAmbiguous: false
      }))

    const modelReadGit = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "CandidateGitReadPending",
        candidateGitReadCount: result.candidateGitReadCount + 1n,
        candidateGitResponseAmbiguous: false
      }))

    const modelLoseGit = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, targetHeld: false, candidateGitResponseAmbiguous: true }))
      trackerFactsCurrent = false
      targetFactsCurrent = false
      targetHeadProof = 0n
      targetReacquisitionRequired = true
    }

    const modelReconcileGit = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "CandidateGitReadIntent",
        targetHeld: true,
        candidateGitResponseAmbiguous: false
      }))
      targetReacquisitionRequired = false
    }

    const modelOfferPromotionPremise = (id: bigint): void =>
      updateModelResult(id, (result) => ({ ...result, phase: "PromotionPremise" }))

    const modelPromotionIntent = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionIntent",
        targetHeld: true,
        promotionIntentRecorded: true,
        promotionAttemptCount: 0n,
        promotionLastAttempt: 0n,
        promotionFreshExactHeadReads: 0n,
        promotionFreshExactHeadObservation: false,
        promotionTargetFactsCurrent: false,
        promotionExpectedHeadVerified: false,
        promotionGitObservation: "NoPromotionGitObservation",
        promotionObservedTargetHead: 0n,
        promotionCandidateAncestryProven: false,
        promotionResultRecorded: false,
        promotionResponseAmbiguous: false,
        promotionCompareAndSetRequested: false,
        promotionForceRequested: false,
        promotionEquivalentContentAccepted: false
      }))

    const modelPromotionAttemptIntent = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionAttemptIntended",
        promotionAttemptCount: result.promotionAttemptCount + 1n,
        promotionLastAttempt: result.promotionLastAttempt + 1n,
        promotionFreshExactHeadObservation: false,
        promotionGitObservation: "NoPromotionGitObservation",
        promotionObservedTargetHead: 0n,
        promotionResponseAmbiguous: false,
        promotionCompareAndSetRequested: false,
        promotionForceRequested: false,
        promotionEquivalentContentAccepted: false
      }))

    const modelSendPromotion = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionInFlight",
        promotionCompareAndSetRequested: true
      }))

    const modelLosePromotion = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionResponseLost",
        targetHeld: false,
        promotionFreshExactHeadObservation: false,
        promotionTargetFactsCurrent: false,
        promotionGitObservation: "NoPromotionGitObservation",
        promotionObservedTargetHead: 0n,
        promotionResponseAmbiguous: true
      }))

    const modelReconcilePromotion = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionReconciliation",
        targetHeld: true,
        promotionFreshExactHeadObservation: false,
        promotionTargetFactsCurrent: false,
        promotionGitObservation: "NoPromotionGitObservation",
        promotionObservedTargetHead: 0n
      }))

    const modelPromotionCurrent = (id: bigint, ancestor: boolean): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionSucceeded",
        targetHeld: false,
        promotionGitObservation: ancestor ? "PromotionCandidateAncestor" : "PromotionCandidateCurrent",
        promotionObservedTargetHead: ancestor ? result.submittedCandidate + 100n : result.submittedCandidate,
        promotionCandidateAncestryProven: true,
        promotionResultRecorded: true,
        promotionResponseAmbiguous: false
      }))

    const modelPromotionExactHead = (id: bigint): void =>
      updateModelResult(id, (result) => {
        const exhausted = result.promotionAttemptCount >= 3n
        return {
          ...result,
          phase: exhausted ? "PromotionExhausted" : "PromotionRetryReady",
          targetHeld: !exhausted,
          promotionFreshExactHeadReads: result.promotionFreshExactHeadReads + 1n,
          promotionFreshExactHeadObservation: true,
          promotionTargetFactsCurrent: true,
          promotionExpectedHeadVerified: true,
          promotionGitObservation: "PromotionExactExpectedHead",
          promotionObservedTargetHead: result.expectedTargetHead,
          promotionResultRecorded: false,
          promotionResponseAmbiguous: false
        }
      })

    const modelPromotionOtherHead = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionStale",
        targetHeld: false,
        promotionGitObservation: "PromotionOtherHead",
        promotionObservedTargetHead: result.expectedTargetHead + 1n,
        promotionCandidateAncestryProven: false,
        promotionResultRecorded: true,
        promotionResponseAmbiguous: false
      }))

    const modelPromotionUnreadable = (id: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: result.promotionAttemptCount >= 3n ? "PromotionExhausted" : "PromotionReadPending",
        targetHeld: false,
        promotionTargetFactsCurrent: false,
        promotionGitObservation: "PromotionUnreadableHead",
        promotionObservedTargetHead: 0n,
        promotionCandidateAncestryProven: false,
        promotionResultRecorded: false
      }))

    const modelRecover = (): void => {
      const requiresFreshFacts = [...modelResults.values()].some(
        (result) =>
          result.phase !== "NoAcceptedResult" &&
          result.phase !== "LateAcceptedEvidence" &&
          !new Set<Phase>(["PromotionSucceeded", "PromotionStale", "PromotionExhausted"]).has(result.phase)
      )
      updateModelResults((result) => ({
        ...result,
        phase:
          result.phase === "IntegratorInFlight"
            ? "IntegratorResponseLost"
            : result.phase === "RetryInFlight"
              ? "RetrySelected"
              : result.phase === "SuccessorInFlight"
                ? "SuccessorResponseLost"
                : result.phase === "PromotionInFlight" ||
                    result.phase === "PromotionAttemptIntended" ||
                    result.phase === "PromotionReconciliation" ||
                    result.phase === "PromotionRetryReady"
                  ? "PromotionResponseLost"
                  : result.phase === "PromotionReadPending" && result.promotionAttemptCount === 0n
                    ? "PromotionIntent"
                    : result.phase === "PromotionReadPending"
                      ? "PromotionResponseLost"
                      : result.phase,
        integratorResponseAmbiguous: result.phase === "IntegratorInFlight" ? true : result.integratorResponseAmbiguous,
        targetHeld: false,
        lastRecoveryRunSession:
          result.integratorResponseAmbiguous ||
          result.phase === "IntegratorInFlight" ||
          result.phase === "RetryInFlight"
            ? result.integratorRunSession
            : result.phase === "SuccessorInFlight"
              ? result.successorSession
              : result.lastRecoveryRunSession,
        lastRecoveryRunOrdinal:
          result.integratorResponseAmbiguous ||
          result.phase === "IntegratorInFlight" ||
          result.phase === "RetryInFlight"
            ? result.integratorRunOrdinal
            : result.phase === "SuccessorInFlight"
              ? result.successorRunOrdinal
              : result.lastRecoveryRunOrdinal,
        promotionTargetFactsCurrent: result.phase.startsWith("Promotion") ? false : result.promotionTargetFactsCurrent,
        promotionFreshExactHeadObservation: result.phase.startsWith("Promotion")
          ? false
          : result.promotionFreshExactHeadObservation,
        promotionGitObservation:
          result.phase.startsWith("Promotion") &&
          !new Set<Phase>(["PromotionSucceeded", "PromotionStale", "PromotionExhausted"]).has(result.phase)
            ? "NoPromotionGitObservation"
            : result.promotionGitObservation,
        promotionObservedTargetHead:
          result.phase.startsWith("Promotion") &&
          !new Set<Phase>(["PromotionSucceeded", "PromotionStale", "PromotionExhausted"]).has(result.phase)
            ? 0n
            : result.promotionObservedTargetHead
      }))
      recovered = true
      modelRestartCount += 1n
      if (requiresFreshFacts) {
        trackerFactsCurrent = false
        targetFactsCurrent = false
        targetHeadProof = 0n
      }
      targetReacquisitionRequired = requiresFreshFacts
    }

    const modelObserveTargetFacts = (id: bigint): void => {
      const result = modelResultFor(id)
      targetFactsCurrent = true
      targetHeadProof = result.expectedTargetHead === 0n ? result.plannedTargetHead : result.expectedTargetHead
      if (result.phase.startsWith("Promotion")) {
        updateModelResult(id, (current) => ({ ...current, promotionTargetFactsCurrent: true }))
      }
    }

    const modelReacquire = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, targetHeld: true }))
      targetReacquisitionRequired = [...modelResults].some(
        ([other, result]) => other !== id && !result.targetHeld && targetReacquisitionPhase(result.phase)
      )
    }

    const modelStateFor = (id: bigint): ModelResult => {
      const model = modelResultFor(id)
      const records = runtime.readRecords()
      const responsibility = responsibilityFor(id)
      const actual = deriveIntegratorRunState(records, responsibility, currentRunFor(id))
      if (actual._tag === "Contradiction") {
        return rejectImpossibleTransition(`integrator adapter contradiction: ${actual.detail}`)
      }
      const predecessor = deriveIntegratorRunState(records, responsibility, runFor(id, 1n))
      if (predecessor._tag === "Contradiction") {
        return rejectImpossibleTransition(`integrator adapter predecessor contradiction: ${predecessor.detail}`)
      }
      const resultState: ReconstructedIntegratorState = new Set<Phase>([
        "RetryInFlight",
        "SuccessorSessionFixed",
        "SuccessorInFlight",
        "SuccessorResponseLost"
      ]).has(model.phase)
        ? predecessor
        : actual

      const expectedSession = phaseNeedsSession(model.phase)
      if (expectedSession && actual._tag === "Absent") {
        return rejectImpossibleTransition(
          `model phase ${model.phase} has no durable Integrator session for result ${id}`
        )
      }
      if (!expectedSession && actual._tag !== "Absent") {
        return rejectImpossibleTransition(
          `model phase ${model.phase} unexpectedly has an Integrator session for result ${id}`
        )
      }
      if (phaseNeedsResult(model.phase) !== isIntegratorResultState(resultState)) {
        return rejectImpossibleTransition(`model/runtime outer-result mismatch at ${model.phase}: ${resultState._tag}`)
      }
      if (phaseNeedsPreparedResult(model.phase)) {
        if (
          !(
            resultState._tag === "PreparedAwaitingGit" ||
            resultState._tag === "CandidateRejected" ||
            resultState._tag === "GitQualifiedPrepared"
          )
        ) {
          return rejectImpossibleTransition(
            `model phase ${model.phase} is not backed by a PreparedCandidate result: ${resultState._tag}`
          )
        }
      }

      const correlation = actual._tag === "Absent" ? undefined : actual.run.session
      if (correlation !== undefined) {
        const expectedResponsibility = responsibilityFor(id)
        const expectedCorrelation = integratorCorrelationFor(makeInput(id, modelResults, runtime.readRecords()))
        const isSuccessor = correlation.sessionId !== expectedCorrelation.sessionId
        const sessionRecord = runtime
          .readRecords()
          .find(
            (record) =>
              record.event._tag === "IntegratorSessionFixed" &&
              record.event.correlation.sessionId === correlation.sessionId
          )
        if (sessionRecord === undefined || sessionRecord.position <= correlation.targetLineageObservedAt) {
          return rejectImpossibleTransition("Integrator session was not durably appended after TargetLineageObserved")
        }
        const responsibilityFactsMismatch =
          correlation.integrationTarget.repository !== expectedResponsibility.integrationTarget.repository ||
          correlation.integrationTarget.ref !== expectedResponsibility.integrationTarget.ref ||
          correlation.plannedAttempt.attemptId !== expectedResponsibility.plannedAttempt.attemptId ||
          correlation.queuedAt !== expectedResponsibility.queuedAt ||
          correlation.startedAt !== expectedResponsibility.startedAt ||
          correlation.acceptedResult.commit !== expectedResponsibility.acceptedResult.commit ||
          correlation.acceptedResult.evidenceManifest.digest !==
            expectedResponsibility.acceptedResult.evidenceManifest.digest
        const identityMismatch = isSuccessor
          ? correlation.expectedTargetHead !== commitOf(model.successorTargetHead) ||
            correlation.sessionId === expectedCorrelation.sessionId ||
            correlation.candidateResource === expectedCorrelation.candidateResource ||
            correlation.targetLineageObservedAt <= directionRecordFor(id, "FullRerun").position
          : correlation.expectedTargetHead !== commitOf(model.expectedTargetHead) ||
            correlation.targetLineageObservedAt !== targetLineagePositionFor(id) ||
            correlation.sessionId !== expectedCorrelation.sessionId ||
            correlation.candidateResource !== expectedCorrelation.candidateResource
        if (responsibilityFactsMismatch || identityMismatch) {
          return rejectImpossibleTransition(
            "Integrator correlation does not bind the exact responsibility, H, C, target, and lineage position"
          )
        }
      }

      const actualText = candidateTextFromState(resultState)
      const actualObservation = candidateObservationFromState(resultState)
      const actualCandidate = candidateNumberFromText(actualText)
      const resultRun = "run" in resultState ? resultState.run : undefined
      const actualCandidateObservation = candidateObservationTag(
        actualObservation,
        commitOf(model.expectedTargetHead),
        commitOf(model.acceptedResultCommit)
      )
      const candidateIntent =
        resultRun !== undefined &&
        actualText !== undefined &&
        runtime
          .readRecords()
          .some((record) => record.key === integratorRunCandidateGitReadIntendedRecordKey(resultRun, actualText))

      if (model.integratorRunResultRecorded !== isIntegratorResultState(resultState)) {
        return rejectImpossibleTransition("model/runtime durable outer-result flag mismatch")
      }
      if (model.integratorOutcome === "NotPrepared" && resultState._tag !== "NotPrepared") {
        return rejectImpossibleTransition("model/runtime NotPrepared outcome mismatch")
      }
      if (model.integratorOutcome === "PreparedCandidate" && resultState._tag === "NotPrepared") {
        return rejectImpossibleTransition("model/runtime PreparedCandidate outcome mismatch")
      }
      if (model.candidateReported !== (actualText !== undefined)) {
        return rejectImpossibleTransition("model/runtime explicit candidate-report mismatch")
      }
      if (model.candidateGitReadIntentRecorded !== candidateIntent) {
        return rejectImpossibleTransition("model/runtime Git-read intent mismatch")
      }
      if (model.candidateGitObservation !== actualCandidateObservation) {
        return rejectImpossibleTransition("model/runtime Git observation mismatch")
      }
      if (model.candidateQualificationProven !== (resultState._tag === "GitQualifiedPrepared")) {
        return rejectImpossibleTransition("model/runtime Git qualification mismatch")
      }
      if (model.candidateReported && actualCandidate !== model.submittedCandidate) {
        return rejectImpossibleTransition("model/runtime candidate text mismatch")
      }
      if (model.candidateQualificationProven) {
        const observationRecord = runtime
          .readRecords()
          .find(
            (record) =>
              record.event._tag === "IntegratorRunCandidateGitObserved" &&
              record.event.run.session.sessionId === resultRun?.session.sessionId
          )
        if (observationRecord === undefined || observationRecord.position <= targetLineagePositionFor(id)) {
          return rejectImpossibleTransition("qualified candidate lacks a later durable Git observation")
        }
      }

      return {
        ...model,
        sessionFixed: actual._tag !== "Absent",
        integratorOutcome:
          resultState._tag === "NotPrepared"
            ? "NotPrepared"
            : resultState._tag === "PreparedAwaitingGit" ||
                resultState._tag === "CandidateRejected" ||
                resultState._tag === "GitQualifiedPrepared"
              ? "PreparedCandidate"
              : "NoIntegratorOutcome",
        integratorRunResultRecorded: isIntegratorResultState(resultState),
        candidateReported: actualText !== undefined,
        submittedCandidate: actualCandidate ?? 0n,
        candidateGitReadIntentRecorded: candidateIntent,
        candidateGitObservation: actualCandidateObservation,
        candidateQualificationProven: resultState._tag === "GitQualifiedPrepared",
        observedFirstParent:
          actualObservation?._tag === "Commit" && actualObservation.directParents[0] !== undefined
            ? numericCommit(actualObservation.directParents[0])
            : 0n,
        observedSecondParent:
          actualObservation?._tag === "Commit" && actualObservation.directParents[1] !== undefined
            ? numericCommit(actualObservation.directParents[1])
            : 0n
      }
    }

    const projection = (): {
      readonly nextJournalPosition: bigint
      readonly recovered: boolean
      readonly restartCount: bigint
      readonly trackerFactsCurrent: boolean
      readonly targetFactsCurrent: boolean
      readonly targetHeadProof: bigint
      readonly targetReacquisitionRequired: boolean
      readonly results: Map<bigint, ModelResult>
    } => ({
      nextJournalPosition: modelNextJournalPosition,
      recovered,
      restartCount: modelRestartCount,
      trackerFactsCurrent,
      targetFactsCurrent,
      targetHeadProof,
      targetReacquisitionRequired,
      results: new Map([1n, 2n].map((id) => [id, modelStateFor(id)]))
    })

    const observeCandidate = (id: bigint, mode: GitMode, observation: CandidateGitObservation) =>
      Effect.gen(function* () {
        runtime.setGitMode(mode)
        yield* runtime.runProtocol(id)
        modelObserveCandidate(id, observation)
      })

    return {
      init: () => Effect.sync(modelReset),
      acceptResultOne: () => Effect.sync(() => modelAccept(1n)),
      acceptResultTwo: () => Effect.sync(() => modelAccept(2n)),
      assignResultTwoIndependentTargetOne: () =>
        Effect.sync(() => {
          updateModelResult(2n, (result) => ({ ...result, integrationTarget: 2n }))
          runtime.updateTargetLineageTarget(2n, independentTarget)
        }),
      chooseRetryOne: () =>
        Effect.gen(function* () {
          yield* applyDirection(1n, "Retry", "accepted-result-integration-retry")
          modelChooseDirection(1n, "RetryDirection")
        }),
      chooseFullRerunOne: () =>
        Effect.gen(function* () {
          yield* applyDirection(1n, "FullRerun", "accepted-result-integration-full-rerun")
          modelChooseDirection(1n, "FullRerunDirection")
        }),
      redeliverRetryOne: () =>
        Effect.gen(function* () {
          yield* redeliverDirection(1n, "Retry")
          modelRedeliverDirection(1n)
        }),
      redeliverFullRerunOne: () =>
        Effect.gen(function* () {
          yield* redeliverDirection(1n, "FullRerun")
          modelRedeliverDirection(1n)
        }),
      rejectConflictingFullRerunOne: () =>
        Effect.gen(function* () {
          const quarantine = latestQuarantineRecord(1n)
          const fingerprint = IntegrationQuarantineDirectionFingerprint.make({
            direction: "FullRerun",
            quarantineAt: quarantine.position,
            sessionId: correlationFor(1n).sessionId
          })
          const request = ApplyIntegrationQuarantineDirectionRequest.make({
            fingerprint,
            requestId: IntegrationQuarantineDirectionRequestId.make({
              nonce: "accepted-result-integration-conflicting-full-rerun",
              runId
            })
          })
          const control = yield* makeIntegrationQuarantineDirectionControl(runtime.journal)
          const outcome = yield* Effect.exit(control.apply(request))
          if (outcome._tag === "Success") {
            return rejectImpossibleTransition("conflicting FullRerun direction unexpectedly won")
          }
          modelRejectConflictingDirection(1n)
        }),
      fixIntegratorSessionOne: () =>
        Effect.gen(function* () {
          yield* appendSession(1n)
          modelFixSession(1n)
        }),
      fixIntegratorSessionTwo: () =>
        Effect.gen(function* () {
          yield* appendSession(2n)
          modelFixSession(2n)
        }),
      invokeIntegratorOne: () =>
        Effect.gen(function* () {
          runtime.failNextIntegratorCall()
          yield* Effect.exit(runtime.runProtocol(1n))
          updateModelResult(1n, (result) => ({
            ...result,
            phase: "IntegratorInFlight",
            integratorInvocationCount: 1n,
            integratorResponseAmbiguous: false,
            integratorRunOrdinal: 1n,
            integratorRunSession: result.integrationSession
          }))
        }),
      loseCandidateGitResponseOne: () =>
        Effect.gen(function* () {
          runtime.failNextGitRead()
          yield* Effect.exit(runtime.runProtocol(1n))
          modelLoseGit(1n)
        }),
      loseCandidateGitResponseTwo: () => Effect.void,
      loseIntegratorResponseOne: () => Effect.sync(() => modelLoseIntegrator(1n)),
      losePromotionAttemptResponseOne: () => Effect.sync(() => modelLosePromotion(1n)),
      observeAppliedRestartBeforeAcceptedOne: () =>
        Effect.sync(() =>
          updateModelResult(1n, (result) => ({ ...result, restartChoiceCommittedBeforeTerminal: true }))
        ),
      observeExactCandidateOne: () => observeCandidate(1n, "Exact", "CandidateExactParents"),
      observeIncompatibleTargetLineageOne: () =>
        Effect.sync(() => updateModelResult(1n, (result) => ({ ...result, lineageCompatible: false }))),
      observeMissingCandidateOne: () => observeCandidate(1n, "Missing", "CandidateMissing"),
      observeNonCommitCandidateOne: () => observeCandidate(1n, "NonCommit", "CandidateNonCommit"),
      observePromotionCandidateAncestorOne: () => Effect.sync(() => modelPromotionCurrent(1n, true)),
      observePromotionCandidateCurrentOne: () => Effect.sync(() => modelPromotionCurrent(1n, false)),
      observePromotionExactExpectedHeadOne: () =>
        Effect.sync(() => {
          targetFactsCurrent = true
          targetHeadProof = modelResultFor(1n).expectedTargetHead
          modelPromotionExactHead(1n)
        }),
      observePromotionGitUnreadableOne: () => Effect.sync(() => modelPromotionUnreadable(1n)),
      observePromotionOtherHeadOne: () => Effect.sync(() => modelPromotionOtherHead(1n)),
      observeTargetFactsOne: () => Effect.sync(() => modelObserveTargetFacts(1n)),
      observeTargetFactsTwo: () => Effect.sync(() => modelObserveTargetFacts(2n)),
      observeTrackerFactsStep: () =>
        Effect.sync(() => {
          trackerFactsCurrent = true
        }),
      observeWrongParentCandidateOne: () => observeCandidate(1n, "WrongParents", "CandidateWrongParents"),
      offerPromotionPremiseOne: () => Effect.sync(() => modelOfferPromotionPremise(1n)),
      queueAcceptedResultOne: () =>
        Effect.gen(function* () {
          yield* appendResponsibility(1n)
          modelQueue(1n)
        }),
      queueAcceptedResultTwo: () =>
        Effect.gen(function* () {
          yield* appendResponsibility(2n)
          modelQueue(2n)
        }),
      reacquireIntegrationTargetOne: () => Effect.sync(() => modelReacquire(1n)),
      recoverCoordinatorStep: () => Effect.sync(modelRecover),
      recordCandidateGitReadIntentOne: () =>
        Effect.gen(function* () {
          yield* appendCandidateIntent(1n)
          modelRecordGitIntent(1n)
        }),
      reportIntegratorCandidateOne31: () =>
        Effect.gen(function* () {
          const correlation = correlationFor(1n)
          const result = IntegratorResult.cases.PreparedCandidate.make({
            candidateText: candidateTextOf(31n),
            correlation
          })
          yield* appendIntegratorResult(1n, result)
          modelCandidate(1n, 31n)
        }),
      reportIntegratorCandidateOne32: () =>
        Effect.gen(function* () {
          const correlation = correlationFor(1n)
          const result = IntegratorResult.cases.PreparedCandidate.make({
            candidateText: candidateTextOf(32n),
            correlation
          })
          yield* appendIntegratorResult(1n, result)
          modelCandidate(1n, 32n)
        }),
      reportIntegratorNotPreparedOne: () =>
        Effect.gen(function* () {
          const correlation = correlationFor(1n)
          const result = IntegratorResult.cases.NotPrepared.make({ correlation, detail: notPreparedDetail })
          yield* appendIntegratorResult(1n, result)
          yield* Effect.exit(runtime.runProtocol(1n))
          modelNotPrepared(1n)
        }),
      recordQuarantineOne: () =>
        Effect.gen(function* () {
          const responsibility = responsibilityFor(1n)
          const run = runFor(1n)
          const result = deriveIntegratorRunState(runtime.readRecords(), responsibility, run)
          if (result._tag !== "NotPrepared" && result._tag !== "CandidateRejected") {
            return rejectImpossibleTransition(`cannot quarantine non-conclusive Integrator state ${result._tag}`)
          }
          if (run.ordinal === IntegratorRunOrdinal.make(1)) {
            yield* appendInitialConclusiveIntegrationQuarantine(result).pipe(
              Effect.provideService(InRunJournal, runtime.journal)
            )
          } else {
            yield* appendRetryConclusiveIntegrationQuarantine(result).pipe(
              Effect.provideService(InRunJournal, runtime.journal)
            )
          }
          modelRecordQuarantine(1n)
        }),
      startRetryOne: () =>
        Effect.gen(function* () {
          const lineage = yield* appendFreshTargetLineage(1n, modelResultFor(1n).expectedTargetHead, "retry")
          if (lineage.event._tag !== "TargetLineageObserved") {
            return rejectImpossibleTransition("Retry fresh lineage append returned a foreign event")
          }
          const input = IntegratorPreparationInput.make({
            responsibility: responsibilityFor(1n),
            targetLineage: lineage.event.observation,
            targetLineageObservedAt: lineage.position
          })
          const run = runFor(1n, 2n)
          runtime.failNextIntegratorCall()
          const outcome = yield* Effect.exit(runtime.runProtocolFor(input, run))
          assertLostRun(run, outcome)
          modelStartRetry(1n)
        }),
      recordRetryNotApplicableOne: () =>
        Effect.gen(function* () {
          const lineage = yield* appendFreshTargetLineage(1n, targetHeadProof, "retry")
          if (lineage.event._tag !== "TargetLineageObserved") {
            return rejectImpossibleTransition("Retry fresh lineage append returned a foreign event")
          }
          const quarantine = latestQuarantineRecord(1n)
          const direction = directionRecordFor(1n, "Retry")
          yield* appendChangedHeadRetryQuarantine({
            directionAppliedAt: direction.position,
            priorQuarantineAt: quarantine.position,
            session: correlationFor(1n),
            targetLineage: lineage.event.observation,
            targetLineageObservedAt: lineage.position
          }).pipe(Effect.provideService(InRunJournal, runtime.journal))
          modelRetryNotApplicable(1n)
        }),
      observeSuccessorTargetHeadOne: () =>
        Effect.gen(function* () {
          const lineage = yield* appendFreshTargetLineage(1n, modelResultFor(1n).expectedTargetHead, "successor")
          if (lineage.event._tag !== "TargetLineageObserved") {
            return rejectImpossibleTransition("FullRerun fresh lineage append returned a foreign event")
          }
          modelObserveSuccessorTargetHead(1n)
        }),
      startFullRerunOne: () =>
        Effect.gen(function* () {
          const input = successorPreparationFor(1n)
          yield* appendIntegratorSuccessorSessionIfNeeded(runtime.journal, input, runtime.readRecords())
          modelStartFullRerun(1n)
        }),
      startSuccessorIntegratorOne: () =>
        Effect.gen(function* () {
          const successorRecord = runtime
            .readRecords()
            .findLast(
              (record): record is IntegratorSuccessorSessionFixedRecord =>
                record.event._tag === "IntegratorSuccessorSessionFixed"
            )
          if (successorRecord === undefined) {
            return rejectImpossibleTransition("FullRerun successor session was not durably fixed")
          }
          const successor = successorRecord.event.successor
          const lineageRecord = runtime
            .readRecords()
            .find((record) => record.position === successor.targetLineageObservedAt)
          if (lineageRecord === undefined || lineageRecord.event._tag !== "TargetLineageObserved") {
            return rejectImpossibleTransition("FullRerun successor lacks its target-lineage record")
          }
          const input = IntegratorPreparationInput.make({
            responsibility: responsibilityFor(1n),
            targetLineage: lineageRecord.event.observation,
            targetLineageObservedAt: lineageRecord.position
          })
          const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: successor })
          runtime.failNextIntegratorCall()
          const outcome = yield* Effect.exit(runtime.runProtocolFor(input, run))
          assertLostRun(run, outcome)
          modelStartSuccessor(1n)
        }),
      loseSuccessorResponseOne: () => Effect.sync(() => modelLoseSuccessor(1n)),
      recordPromotionAttemptIntentOne: () => Effect.sync(() => modelPromotionAttemptIntent(1n)),
      recordPromotionIntentOne: () => Effect.sync(() => modelPromotionIntent(1n)),
      readCandidateGitOne: () => Effect.sync(() => modelReadGit(1n)),
      reconcileCandidateGitOne: () => Effect.sync(() => modelReconcileGit(1n)),
      reconcilePromotionOne: () => Effect.sync(() => modelReconcilePromotion(1n)),
      resumeIntegratorOne: () =>
        Effect.gen(function* () {
          const request = IntegratorRequest.make({ correlation: runFor(1n) })
          yield* runtime.integrator.prepare(request)
          modelResume(1n)
        }),
      sendPromotionAttemptOne: () => Effect.sync(() => modelSendPromotion(1n)),
      startIntegrationOne: () =>
        Effect.gen(function* () {
          yield* appendIntegrationStart(1n)
          modelStart(1n)
        }),
      startIntegrationTwo: () =>
        Effect.gen(function* () {
          yield* appendIntegrationStart(2n)
          modelStart(2n)
        }),
      waitOnDependencyOne: () => Effect.sync(() => modelWait(1n)),
      getState: () => Effect.sync(projection)
    }
  }
)

quintIt(
  it.effect,
  "replays accepted-result integration through the outer Integrator journal and direct Git qualification premise",
  {
    backend: "typescript",
    driverFactory: acceptedResultIntegrationDriver,
    maxSteps: 35,
    nTraces: 100,
    seed: "57",
    spec: "specs/acceptedResultIntegration.qnt",
    stateCheck: stateCheck(
      (raw) =>
        Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
          Effect.map(({ state }) => ({
            ...state,
            results: new Map(
              [...state.results].map(([id, result]) => [
                id,
                {
                  ...result,
                  phase: variantTag(result.phase),
                  integratorOutcome: variantTag(result.integratorOutcome),
                  candidateGitObservation: variantTag(result.candidateGitObservation),
                  promotionGitObservation: variantTag(result.promotionGitObservation),
                  quarantineCause: variantTag(result.quarantineCause),
                  quarantineDirection: variantTag(result.quarantineDirection),
                  lastDirection: variantTag(result.lastDirection)
                }
              ])
            )
          })),
          Effect.orDie
        ),
      (spec, implementation) => {
        if (
          spec.nextJournalPosition !== implementation.nextJournalPosition ||
          spec.recovered !== implementation.recovered ||
          spec.restartCount !== implementation.restartCount ||
          spec.targetFactsCurrent !== implementation.targetFactsCurrent ||
          spec.targetHeadProof !== implementation.targetHeadProof ||
          spec.targetReacquisitionRequired !== implementation.targetReacquisitionRequired ||
          spec.trackerFactsCurrent !== implementation.trackerFactsCurrent
        ) {
          return false
        }
        return [...spec.results].every(([id, expected]) => {
          const actual = implementation.results.get(id)
          return (
            actual !== undefined &&
            expected.acceptedEvidencePreserved === actual.acceptedEvidencePreserved &&
            expected.acceptedResultCommit === actual.acceptedResultCommit &&
            expected.candidateGitObservation === actual.candidateGitObservation &&
            expected.candidateGitReadCount === actual.candidateGitReadCount &&
            expected.candidateGitReadIntentRecorded === actual.candidateGitReadIntentRecorded &&
            expected.candidateGitResponseAmbiguous === actual.candidateGitResponseAmbiguous &&
            expected.candidateJournalPosition === actual.candidateJournalPosition &&
            expected.candidateQualificationProven === actual.candidateQualificationProven &&
            expected.candidateReported === actual.candidateReported &&
            expected.candidateResource === actual.candidateResource &&
            expected.expectedTargetHead === actual.expectedTargetHead &&
            expected.integrationResponsibilityCount === actual.integrationResponsibilityCount &&
            expected.integrationResponsibilityRecorded === actual.integrationResponsibilityRecorded &&
            expected.integrationSession === actual.integrationSession &&
            expected.integrationTarget === actual.integrationTarget &&
            expected.integratorInvocationCount === actual.integratorInvocationCount &&
            expected.integratorOutcome === actual.integratorOutcome &&
            expected.integratorResponseAmbiguous === actual.integratorResponseAmbiguous &&
            expected.integratorRunResultRecorded === actual.integratorRunResultRecorded &&
            expected.integratorResumeCount === actual.integratorResumeCount &&
            expected.lineageCompatible === actual.lineageCompatible &&
            expected.sessionFixed === actual.sessionFixed &&
            expected.observedFirstParent === actual.observedFirstParent &&
            expected.observedSecondParent === actual.observedSecondParent &&
            expected.phase === actual.phase &&
            expected.plannedTargetHead === actual.plannedTargetHead &&
            expected.preIntegrationCancellation === actual.preIntegrationCancellation &&
            expected.processSuccessObserved === actual.processSuccessObserved &&
            expected.promotionAttemptCount === actual.promotionAttemptCount &&
            expected.promotionAuthorized === actual.promotionAuthorized &&
            expected.promotionCandidateAncestryProven === actual.promotionCandidateAncestryProven &&
            expected.promotionCompareAndSetRequested === actual.promotionCompareAndSetRequested &&
            expected.promotionEquivalentContentAccepted === actual.promotionEquivalentContentAccepted &&
            expected.promotionExpectedHeadVerified === actual.promotionExpectedHeadVerified &&
            expected.promotionForceRequested === actual.promotionForceRequested &&
            expected.promotionFreshExactHeadObservation === actual.promotionFreshExactHeadObservation &&
            expected.promotionFreshExactHeadReads === actual.promotionFreshExactHeadReads &&
            expected.promotionGitObservation === actual.promotionGitObservation &&
            expected.promotionIntentRecorded === actual.promotionIntentRecorded &&
            expected.promotionLastAttempt === actual.promotionLastAttempt &&
            expected.promotionObservedTargetHead === actual.promotionObservedTargetHead &&
            expected.promotionResponseAmbiguous === actual.promotionResponseAmbiguous &&
            expected.promotionResultRecorded === actual.promotionResultRecorded &&
            expected.promotionTargetFactsCurrent === actual.promotionTargetFactsCurrent &&
            expected.predecessorPreserved === actual.predecessorPreserved &&
            expected.quarantineCause === actual.quarantineCause &&
            expected.quarantineConflictCount === actual.quarantineConflictCount &&
            expected.quarantineDirection === actual.quarantineDirection &&
            expected.quarantineDirectionCount === actual.quarantineDirectionCount &&
            expected.quarantineDirectionPosition === actual.quarantineDirectionPosition &&
            expected.quarantineDirectionSession === actual.quarantineDirectionSession &&
            expected.quarantineOccurrenceCount === actual.quarantineOccurrenceCount &&
            expected.quarantinePosition === actual.quarantinePosition &&
            expected.quarantineRecorded === actual.quarantineRecorded &&
            expected.quarantineRedeliveryCount === actual.quarantineRedeliveryCount &&
            expected.queuePosition === actual.queuePosition &&
            expected.resourceBoundCommit === actual.resourceBoundCommit &&
            expected.resourceBoundHead === actual.resourceBoundHead &&
            expected.resourceBoundTarget === actual.resourceBoundTarget &&
            expected.resourceHeadCandidate === actual.resourceHeadCandidate &&
            expected.retryFreshQuarantineCount === actual.retryFreshQuarantineCount &&
            expected.retryNotApplicableCount === actual.retryNotApplicableCount &&
            expected.retryRunCount === actual.retryRunCount &&
            expected.submittedCandidate === actual.submittedCandidate &&
            expected.successorFixed === actual.successorFixed &&
            expected.successorHeadFreshlyObserved === actual.successorHeadFreshlyObserved &&
            expected.successorIntegratorInvocationCount === actual.successorIntegratorInvocationCount &&
            expected.successorResource === actual.successorResource &&
            expected.successorRunCount === actual.successorRunCount &&
            expected.successorRunOrdinal === actual.successorRunOrdinal &&
            expected.successorSession === actual.successorSession &&
            expected.successorTargetHead === actual.successorTargetHead &&
            expected.targetHeld === actual.targetHeld &&
            expected.legacyVerificationEvidence === actual.legacyVerificationEvidence &&
            expected.integratorRunOrdinal === actual.integratorRunOrdinal &&
            expected.integratorRunSession === actual.integratorRunSession &&
            expected.lastDirection === actual.lastDirection &&
            expected.lastDirectionPosition === actual.lastDirectionPosition &&
            expected.lastDirectionSession === actual.lastDirectionSession &&
            expected.lastRecoveryRunOrdinal === actual.lastRecoveryRunOrdinal &&
            expected.lastRecoveryRunSession === actual.lastRecoveryRunSession
          )
        })
      }
    )
  },
  300_000
)
