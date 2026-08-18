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
import { acceptedResultFixture } from "../../../orchestrator/test/support/evidence.js"
import { TargetLineageObservation } from "../../../orchestrator/src/authorities/git/target-lineage.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import {
  GitReadIntentRecordedEvent,
  TargetLineageObservedEvent
} from "../../../orchestrator/src/workflow/registry/event.js"
import { describeJournalEvent } from "../../../orchestrator/src/workflow/registry/event-descriptor.js"
import { makeTargetLineageObservationOperation } from "../../../orchestrator/src/workflow/registry/operation.js"
import {
  integratorCandidateGitReadIntendedRecordKey,
  integratorResultRecordedRecordKey,
  integratorSessionFixedRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import type { JournalRecordKey } from "../../../orchestrator/src/workflow-journal/identity.js"
import { JournalPosition } from "../../../orchestrator/src/workflow-journal/identity.js"
import {
  InRunJournal,
  type AppendableWorkflowJournalEvent,
  type JournalRecord
} from "../../../orchestrator/src/workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import { StartedIntegrationResponsibility } from "../../../orchestrator/src/workflow/protocols/integration-admission/protocol.js"
import {
  Integrator,
  IntegratorCallFailure,
  IntegratorGit,
  IntegratorGitReadFailure,
  IntegratorPreparationInput,
  IntegratorRequest,
  deriveIntegratorState,
  integratorCorrelationFor,
  prepareIntegrationCandidate
} from "../../../orchestrator/src/workflow/protocols/integrator/protocol.js"
import {
  IntegratorCandidateText,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorResponsibilityFacts,
  IntegratorResult,
  IntegratorResultRecordedEvent,
  IntegratorSessionFixedEvent,
  type IntegratorCorrelation,
  type IntegratorProtocolResult,
  type IntegratorState
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"

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
  | "IntegratorResultRecorded"
  | "CandidateGitReadIntent"
  | "CandidateGitReadPending"
  | "CandidateReady"
  | "CandidateRejected"
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
  readonly integratorResultRecorded: boolean
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
  integratorResultRecorded: false,
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
  promotionEquivalentContentAccepted: false
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
  integratorResultRecorded: Schema.Boolean,
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
  queuePosition: ITFBigInt,
  resourceBoundCommit: ITFBigInt,
  resourceBoundHead: ITFBigInt,
  resourceBoundTarget: ITFBigInt,
  restartChoiceCommittedBeforeTerminal: Schema.Boolean,
  resourceHeadCandidate: ITFBigInt,
  submittedCandidate: ITFBigInt,
  targetHeld: Schema.Boolean,
  legacyVerificationEvidence: Schema.Boolean
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
  readonly runProtocol: (id: bigint) => Effect.Effect<IntegratorProtocolResult, unknown>
  readonly integrator: Integrator["Service"]
  readonly setGitMode: (mode: GitMode) => void
  readonly failNextGitRead: () => void
  readonly failNextIntegratorCall: () => void
  readonly reset: () => void
  readonly updateTargetLineageTarget: (id: bigint, integrationTarget: IntegrationTarget) => void
  readonly integratorCallCount: () => number
}

const rejectImpossibleTransition = (detail: string): never => Effect.runSync(Effect.die(new Error(detail)))

const targetLineagePositionFor = (id: bigint): JournalPosition => JournalPosition.make(id === 1n ? 2 : 4)

const queuedAtFor = (id: bigint): JournalPosition => JournalPosition.make(id === 1n ? 5 : 6)

const startedAtFor = (id: bigint): JournalPosition => JournalPosition.make(id === 1n ? 7 : 8)

const attemptFor = (id: bigint): PlannedTaskAttempt => {
  const attempt = attempts.get(id)
  if (attempt === undefined) return rejectImpossibleTransition(`unknown model attempt ${id}`)
  return attempt
}

const targetFor = (id: bigint, modelResults: ReadonlyMap<bigint, ModelResult>): IntegrationTarget =>
  modelResults.get(id)?.integrationTarget === 2n ? independentTarget : target

const makeTargetRecords = (): ReadonlyArray<JournalRecord> =>
  [1n, 2n].flatMap((id) => {
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
        position: JournalPosition.make(id === 1n ? 1 : 3),
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

const makeResponsibility = (
  id: bigint,
  modelResults: ReadonlyMap<bigint, ModelResult>
): StartedIntegrationResponsibility =>
  StartedIntegrationResponsibility.make({
    acceptedResult: acceptedResultOf(id),
    integrationTarget: targetFor(id, modelResults),
    plannedAttempt: attemptFor(id),
    queuedAt: queuedAtFor(id),
    startedAt: startedAtFor(id)
  })

const makeInput = (id: bigint, modelResults: ReadonlyMap<bigint, ModelResult>): IntegratorPreparationInput => {
  const responsibility = makeResponsibility(id, modelResults)
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
): IntegratorCorrelation => {
  const facts = IntegratorResponsibilityFacts.make(makeResponsibility(id, modelResults))
  const key = integratorSessionFixedRecordKey(facts)
  const session = records.find(
    (record): record is JournalRecord & { readonly event: typeof IntegratorSessionFixedEvent.Type } =>
      record.key === key && record.event._tag === "IntegratorSessionFixed"
  )
  return session?.event.correlation ?? integratorCorrelationFor(makeInput(id, modelResults))
}

const isIntegratorResultState = (state: IntegratorState): boolean =>
  state._tag === "NotPrepared" ||
  state._tag === "PreparedAwaitingGit" ||
  state._tag === "CandidateRejected" ||
  state._tag === "GitQualifiedPrepared"

const candidateTextFromState = (state: IntegratorState): IntegratorCandidateText | undefined => {
  if (
    state._tag === "PreparedAwaitingGit" ||
    state._tag === "CandidateRejected" ||
    state._tag === "GitQualifiedPrepared"
  ) {
    return state.candidateText
  }
  return undefined
}

const candidateObservationFromState = (state: IntegratorState): IntegratorGitObservation | undefined =>
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
    "IntegratorResultRecorded",
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

const phaseNeedsPreparedResult = (phase: Phase): boolean =>
  new Set<Phase>([
    "IntegratorResultRecorded",
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

  const runProtocol = (id: bigint) =>
    prepareIntegrationCandidate(makeInput(id, modelResultsRef())).pipe(
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
    fixIntegratorSessionOne: {},
    fixIntegratorSessionTwo: {},
    init: {},
    invokeIntegratorOne: {},
    loseCandidateGitResponseOne: {},
    loseCandidateGitResponseTwo: {},
    loseIntegratorResponseOne: {},
    losePromotionAttemptResponseOne: {},
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
    recordPromotionAttemptIntentOne: {},
    recordPromotionIntentOne: {},
    reconcileCandidateGitOne: {},
    reconcilePromotionOne: {},
    resumeIntegratorOne: {},
    sendPromotionAttemptOne: {},
    startIntegrationOne: {},
    startIntegrationTwo: {},
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

    const correlationFor = (id: bigint): IntegratorCorrelation =>
      resultCorrelation(id, runtime.readRecords(), modelResults)

    const appendSession = (id: bigint) => {
      const input = makeInput(id, modelResults)
      const correlation = integratorCorrelationFor(input)
      const facts = IntegratorResponsibilityFacts.make(makeResponsibility(id, modelResults))
      return appendEvent(
        integratorSessionFixedRecordKey(facts),
        IntegratorSessionFixedEvent.make({ correlation, version: workflowJournalEventVersion })
      )
    }

    const appendIntegratorResult = (id: bigint, result: IntegratorResult) =>
      appendEvent(
        integratorResultRecordedRecordKey(correlationFor(id)),
        IntegratorResultRecordedEvent.make({ result, version: workflowJournalEventVersion })
      )

    const appendCandidateIntent = (id: bigint) => {
      const correlation = correlationFor(id)
      const candidateText = candidateTextOf(modelResultFor(id).submittedCandidate)
      return appendEvent(
        integratorCandidateGitReadIntendedRecordKey(correlation, candidateText),
        IntegratorCandidateGitReadIntendedEvent.make({
          candidateText,
          correlation,
          version: workflowJournalEventVersion
        })
      )
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
        targetHeld: false,
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
        "IntegratorResultRecorded",
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
        targetHeld: false,
        integratorOutcome: "NotPrepared",
        integratorResultRecorded: true,
        candidateReported: false,
        promotionAuthorized: false,
        integratorResponseAmbiguous: false
      }))

    const modelCandidate = (id: bigint, candidate: bigint): void =>
      updateModelResult(id, (result) => ({
        ...result,
        phase: "IntegratorResultRecorded",
        integratorOutcome: "PreparedCandidate",
        integratorResultRecorded: true,
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
      const actual = deriveIntegratorState(runtime.readRecords(), makeResponsibility(id, modelResults))
      if (actual._tag === "Contradiction") {
        return rejectImpossibleTransition(`integrator adapter contradiction: ${actual.detail}`)
      }

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
      if (phaseNeedsResult(model.phase) !== isIntegratorResultState(actual)) {
        return rejectImpossibleTransition(`model/runtime outer-result mismatch at ${model.phase}: ${actual._tag}`)
      }
      if (phaseNeedsPreparedResult(model.phase)) {
        if (
          !(
            actual._tag === "PreparedAwaitingGit" ||
            actual._tag === "CandidateRejected" ||
            actual._tag === "GitQualifiedPrepared"
          )
        ) {
          return rejectImpossibleTransition(
            `model phase ${model.phase} is not backed by a PreparedCandidate result: ${actual._tag}`
          )
        }
      }

      const correlation = actual._tag === "Absent" ? undefined : actual.correlation
      if (correlation !== undefined) {
        const responsibility = makeResponsibility(id, modelResults)
        const expectedCorrelation = integratorCorrelationFor(makeInput(id, modelResults))
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
        if (
          correlation.expectedTargetHead !== commitOf(model.expectedTargetHead) ||
          correlation.targetLineageObservedAt !== targetLineagePositionFor(id) ||
          correlation.integrationTarget.repository !== responsibility.integrationTarget.repository ||
          correlation.integrationTarget.ref !== responsibility.integrationTarget.ref ||
          correlation.plannedAttempt.attemptId !== responsibility.plannedAttempt.attemptId ||
          correlation.queuedAt !== responsibility.queuedAt ||
          correlation.startedAt !== responsibility.startedAt ||
          correlation.sessionId !== expectedCorrelation.sessionId ||
          correlation.candidateResource !== expectedCorrelation.candidateResource ||
          correlation.acceptedResult.commit !== responsibility.acceptedResult.commit ||
          correlation.acceptedResult.evidenceManifest.digest !== responsibility.acceptedResult.evidenceManifest.digest
        ) {
          return rejectImpossibleTransition(
            "Integrator correlation does not bind the exact responsibility, H, C, target, and lineage position"
          )
        }
      }

      const actualText = candidateTextFromState(actual)
      const actualObservation = candidateObservationFromState(actual)
      const actualCandidate = candidateNumberFromText(actualText)
      const actualCandidateObservation = candidateObservationTag(
        actualObservation,
        commitOf(model.expectedTargetHead),
        commitOf(model.acceptedResultCommit)
      )
      const candidateIntent =
        correlation !== undefined &&
        actualText !== undefined &&
        runtime
          .readRecords()
          .some((record) => record.key === integratorCandidateGitReadIntendedRecordKey(correlation, actualText))

      if (model.integratorResultRecorded !== isIntegratorResultState(actual)) {
        return rejectImpossibleTransition("model/runtime durable outer-result flag mismatch")
      }
      if (model.integratorOutcome === "NotPrepared" && actual._tag !== "NotPrepared") {
        return rejectImpossibleTransition("model/runtime NotPrepared outcome mismatch")
      }
      if (model.integratorOutcome === "PreparedCandidate" && actual._tag === "NotPrepared") {
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
      if (model.candidateQualificationProven !== (actual._tag === "GitQualifiedPrepared")) {
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
              record.event._tag === "IntegratorCandidateGitObserved" &&
              record.event.correlation.sessionId === correlation?.sessionId
          )
        if (observationRecord === undefined || observationRecord.position <= targetLineagePositionFor(id)) {
          return rejectImpossibleTransition("qualified candidate lacks a later durable Git observation")
        }
      }

      return {
        ...model,
        sessionFixed: actual._tag !== "Absent",
        integratorOutcome:
          actual._tag === "NotPrepared"
            ? "NotPrepared"
            : actual._tag === "PreparedAwaitingGit" ||
                actual._tag === "CandidateRejected" ||
                actual._tag === "GitQualifiedPrepared"
              ? "PreparedCandidate"
              : "NoIntegratorOutcome",
        integratorResultRecorded: isIntegratorResultState(actual),
        candidateReported: actualText !== undefined,
        submittedCandidate: actualCandidate ?? 0n,
        candidateGitReadIntentRecorded: candidateIntent,
        candidateGitObservation: actualCandidateObservation,
        candidateQualificationProven: actual._tag === "GitQualifiedPrepared",
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
            integratorResponseAmbiguous: false
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
      queueAcceptedResultOne: () => Effect.sync(() => modelQueue(1n)),
      queueAcceptedResultTwo: () => Effect.sync(() => modelQueue(2n)),
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
      recordPromotionAttemptIntentOne: () => Effect.sync(() => modelPromotionAttemptIntent(1n)),
      recordPromotionIntentOne: () => Effect.sync(() => modelPromotionIntent(1n)),
      readCandidateGitOne: () => Effect.sync(() => modelReadGit(1n)),
      reconcileCandidateGitOne: () => Effect.sync(() => modelReconcileGit(1n)),
      reconcilePromotionOne: () => Effect.sync(() => modelReconcilePromotion(1n)),
      resumeIntegratorOne: () =>
        Effect.gen(function* () {
          const request = IntegratorRequest.make({ correlation: correlationFor(1n) })
          yield* runtime.integrator.prepare(request)
          modelResume(1n)
        }),
      sendPromotionAttemptOne: () => Effect.sync(() => modelSendPromotion(1n)),
      startIntegrationOne: () => Effect.sync(() => modelStart(1n)),
      startIntegrationTwo: () => Effect.sync(() => modelStart(2n)),
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
                  promotionGitObservation: variantTag(result.promotionGitObservation)
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
            expected.integratorResultRecorded === actual.integratorResultRecorded &&
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
            expected.queuePosition === actual.queuePosition &&
            expected.resourceBoundCommit === actual.resourceBoundCommit &&
            expected.resourceBoundHead === actual.resourceBoundHead &&
            expected.resourceBoundTarget === actual.resourceBoundTarget &&
            expected.resourceHeadCandidate === actual.resourceHeadCandidate &&
            expected.submittedCandidate === actual.submittedCandidate &&
            expected.targetHeld === actual.targetHeld &&
            expected.legacyVerificationEvidence === actual.legacyVerificationEvidence
          )
        })
      }
    )
  },
  180_000
)
