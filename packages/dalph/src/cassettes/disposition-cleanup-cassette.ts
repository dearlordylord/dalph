/* eslint-disable max-lines -- The maintained cleanup cassette keeps all three family stories and their exact boundary scripts together. */

import { Effect, Layer, Schema } from "effect"
import {
  AttemptId,
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  encodeTaskRevisionFingerprint,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint,
  RemotePublicationTarget,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  BranchCleanupAuthorization,
  type BranchCleanupBoundaryCall,
  BranchCleanupEvidenceRevision,
  BranchCleanupMutationResult,
  BranchCleanupObservation,
  CleanupMutationOrdinal,
  CleanupObservationOrdinal,
  FixtureTarget,
  InitialControlPolicy,
  IntegratorCandidateCleanupAuthorization,
  type IntegratorCandidateCleanupBoundaryCall,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateResourceLocator,
  IntegrationQuarantineDirectionFingerprint,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  integratorSuccessorCorrelationFor,
  JournalPosition,
  JournalRecord,
  JournalStore,
  journalLayer,
  reduceWorkflowJournalHistory,
  OperationId,
  TaskWorkCapacity,
  WorktreeCleanupAuthorization,
  type WorktreeCleanupBoundaryCall,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation,
  appendCandidateProvenance,
  appendAbandonedProvenance,
  appendCurrentQuarantineProvenance,
  appendReplacementProvenance,
  branchCleanupTestLayer,
  integratorCandidateCleanupTestLayer,
  makeDispositionCleanupActivation,
  memoryJournalTestLayer,
  memoryJournalTestLayerFromPartitionRecords,
  type DispositionCleanupLoopResult,
  runDispositionCleanupLoop,
  TestBranchCleanupBoundary,
  TestIntegratorCandidateCleanupBoundary,
  TestWorktreeCleanupBoundary,
  worktreeCleanupTestLayer
} from "@dalph/orchestrator"

const cleanupCassetteRemotePublicationTarget = RemotePublicationTarget.make({
  branch: RemotePublicationBranchRef.make("refs/heads/main"),
  endpoint: RemotePublicationEndpoint.make("ssh://git@example.invalid/repository.git")
})

const cleanupCassetteP1Worktree = WorktreeLocator.make("/tmp/cleanup-maintained-p1")
const cleanupCassetteP1Branch = TaskBranchRef.make("refs/heads/task/cleanup-maintained-p1")
const cleanupCassetteAbandonedCleanupOperation = OperationId.make("cleanup-maintained-abandoned-worktree-cleanup")
const cleanupCassetteP1Candidate = IntegratorCandidateResourceLocator.make("candidate:cleanup-maintained-p1")
const cleanupCassetteP1Session = IntegratorSessionId.make("session:cleanup-maintained-p1")
const cleanupCassetteDerivedWorktreeOperation = OperationId.make("disposition-cleanup:worktree:cleanup-maintained-p1")
const cleanupCassetteDerivedBranchOperation = OperationId.make("disposition-cleanup:branch:cleanup-maintained-p1")
const cleanupCassetteDerivedAbandonedWorktreeOperation = OperationId.make(
  "disposition-cleanup:worktree:cleanup-maintained-p1"
)
const cleanupCassetteDerivedAbandonedBranchOperation = OperationId.make(
  "disposition-cleanup:branch:cleanup-maintained-p1"
)
const cleanupCassetteDerivedCandidateOperation = OperationId.make(
  "disposition-cleanup:integrator-candidate:session:cleanup-maintained-p1"
)

/** Concrete controlled-boundary subject retained by the maintained cassette. */
const DispositionCleanupBoundaryCall = Schema.TaggedUnion({
  BranchObserve: { branch: TaskBranchRef, operationId: OperationId, ordinal: CleanupObservationOrdinal },
  BranchRemove: { branch: TaskBranchRef, operationId: OperationId, ordinal: CleanupMutationOrdinal },
  CandidateObserve: {
    locator: IntegratorCandidateResourceLocator,
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal,
    sessionId: IntegratorSessionId
  },
  CandidateRemove: {
    locator: IntegratorCandidateResourceLocator,
    operationId: OperationId,
    ordinal: CleanupMutationOrdinal,
    sessionId: IntegratorSessionId
  },
  WorktreeObserve: { locator: WorktreeLocator, operationId: OperationId, ordinal: CleanupObservationOrdinal },
  WorktreeRemove: {
    branch: TaskBranchRef,
    locator: WorktreeLocator,
    operationId: OperationId,
    ordinal: CleanupMutationOrdinal
  }
})
type DispositionCleanupBoundaryCall = typeof DispositionCleanupBoundaryCall.Type

const expectedWorktreeObserve = (ordinal: number, operationId = cleanupCassetteDerivedWorktreeOperation) =>
  DispositionCleanupBoundaryCall.cases.WorktreeObserve.make({
    locator: cleanupCassetteP1Worktree,
    operationId,
    ordinal: CleanupObservationOrdinal.make(ordinal)
  })
const expectedWorktreeRemove = (ordinal: number, operationId = cleanupCassetteDerivedWorktreeOperation) =>
  DispositionCleanupBoundaryCall.cases.WorktreeRemove.make({
    branch: cleanupCassetteP1Branch,
    locator: cleanupCassetteP1Worktree,
    operationId,
    ordinal: CleanupMutationOrdinal.make(ordinal)
  })
const expectedBranchObserve = (ordinal: number, operationId = cleanupCassetteDerivedBranchOperation) =>
  DispositionCleanupBoundaryCall.cases.BranchObserve.make({
    branch: cleanupCassetteP1Branch,
    operationId,
    ordinal: CleanupObservationOrdinal.make(ordinal)
  })
const expectedBranchRemove = (ordinal: number, operationId = cleanupCassetteDerivedBranchOperation) =>
  DispositionCleanupBoundaryCall.cases.BranchRemove.make({
    branch: cleanupCassetteP1Branch,
    operationId,
    ordinal: CleanupMutationOrdinal.make(ordinal)
  })
const expectedCandidateObserve = (ordinal: number) =>
  DispositionCleanupBoundaryCall.cases.CandidateObserve.make({
    locator: cleanupCassetteP1Candidate,
    operationId: cleanupCassetteDerivedCandidateOperation,
    ordinal: CleanupObservationOrdinal.make(ordinal),
    sessionId: cleanupCassetteP1Session
  })
const expectedCandidateRemove = (ordinal: number) =>
  DispositionCleanupBoundaryCall.cases.CandidateRemove.make({
    locator: cleanupCassetteP1Candidate,
    operationId: cleanupCassetteDerivedCandidateOperation,
    ordinal: CleanupMutationOrdinal.make(ordinal),
    sessionId: cleanupCassetteP1Session
  })

const cleanupCassetteSecondObservationOrdinal = 2

/** Maintained chronological cleanup story, independent for each authority family. */
export const DispositionCleanupCassette = Schema.Struct({
  actor: Schema.Literal("Alice"),
  expectedBoundaryCalls: Schema.Array(DispositionCleanupBoundaryCall),
  forbiddenResult: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  scenario: Schema.Literals([
    "SupersededWorktreeAndBranch",
    "AbandonedWorktree",
    "ChangedGitFactsPreserveResources",
    "FullRerunPredecessorCandidate",
    "CurrentQuarantinePreserved"
  ]),
  story: Schema.NonEmptyArray(Schema.NonEmptyString),
  terminalResult: Schema.NonEmptyString,
  version: Schema.Literal(1)
})
export type DispositionCleanupCassette = typeof DispositionCleanupCassette.Type

/** Authored scenario chronology used by the focused production-loop tests. */
export const dispositionCleanupAuthoredCassetteCatalog = {
  supersededWorktreeAndBranch: DispositionCleanupCassette.make({
    actor: "Alice",
    expectedBoundaryCalls: [
      expectedWorktreeObserve(1),
      expectedWorktreeRemove(1),
      expectedWorktreeObserve(cleanupCassetteSecondObservationOrdinal),
      expectedBranchObserve(1),
      expectedBranchRemove(1),
      expectedBranchObserve(cleanupCassetteSecondObservationOrdinal)
    ],
    forbiddenResult: "delete P2, a moved/untracked resource, or workflow-journal evidence",
    name: "Restarted task disposes only settled P1 resources",
    scenario: "SupersededWorktreeAndBranch",
    story: [
      "Alice restarts changed task; Restart first-choice wins and P1 is superseded by P2.",
      "Dalph authorizes W1 with the P1 disposition, owner, head, and Git evidence revision.",
      "Fresh matching Git facts permit worktree removal; branch authorization follows W1 settlement.",
      "A fresh absent read after each mutation settles both exact resources while P2 continues."
    ],
    terminalResult: "P1 worktree and branch settled; P2 remains live",
    version: 1
  }),
  abandonedWorktree: DispositionCleanupCassette.make({
    actor: "Alice",
    expectedBoundaryCalls: [
      expectedWorktreeObserve(1, cleanupCassetteDerivedAbandonedWorktreeOperation),
      expectedWorktreeRemove(1, cleanupCassetteDerivedAbandonedWorktreeOperation),
      expectedWorktreeObserve(
        cleanupCassetteSecondObservationOrdinal,
        cleanupCassetteDerivedAbandonedWorktreeOperation
      ),
      expectedBranchObserve(1, cleanupCassetteDerivedAbandonedBranchOperation)
    ],
    forbiddenResult: "delete an abandoned worktree without the exact Stop and executor witness",
    name: "Stop settles the abandoned worktree through exact executor evidence",
    scenario: "AbandonedWorktree",
    story: [
      "Alice stops P1 after the executor reports a correlated safely-suspended result.",
      "Dalph records the exact Stop choice, abandonment, claim, and Git worktree evidence.",
      "Matching W1 facts permit one bounded remove request and a fresh absent reread settles W1."
    ],
    terminalResult: "Abandoned P1 worktree settled; no later executor command is accepted",
    version: 1
  }),
  changedGitFactsPreserveResources: DispositionCleanupCassette.make({
    actor: "Alice",
    expectedBoundaryCalls: [expectedWorktreeObserve(1)],
    forbiddenResult: "issue any remove or branch-delete call after owner/locator/head contradiction",
    name: "Changed Git facts preserve the superseded resources",
    scenario: "ChangedGitFactsPreserveResources",
    story: [
      "Alice's cleanup authorization is durable, then Git reports B1 moved or W1 registered elsewhere.",
      "Dalph records contradiction and preserves W1, B1, and any evidence."
    ],
    terminalResult: "Preserved with a typed contradiction",
    version: 1
  }),
  fullRerunPredecessorCandidate: DispositionCleanupCassette.make({
    actor: "Alice",
    expectedBoundaryCalls: [
      expectedCandidateObserve(1),
      expectedCandidateRemove(1),
      expectedCandidateObserve(cleanupCassetteSecondObservationOrdinal)
    ],
    forbiddenResult: "delete S1 history, C2, or the live successor candidate",
    name: "FullRerun disposes only the quarantined predecessor candidate",
    scenario: "FullRerunPredecessorCandidate",
    story: [
      "FullRerun creates fresh S2/C2 while S1/C1 remains quarantined.",
      "Dalph authorizes only predecessor C1, reads owner/session and revision, then deletes C1.",
      "A fresh absent read settles C1; S1 evidence and C2 remain available for their owning protocols."
    ],
    terminalResult: "C1 settled; S1 history and C2 preserved",
    version: 1
  }),
  currentQuarantinePreserved: DispositionCleanupCassette.make({
    actor: "Alice",
    expectedBoundaryCalls: [],
    forbiddenResult: "invent a cleanup authorization or call any cleanup boundary",
    name: "Current quarantine has no terminal disposal",
    scenario: "CurrentQuarantinePreserved",
    story: [
      "A current quarantine has no FullRerun successor and no terminal disposal occurrence.",
      "Dalph performs no cleanup call and retains the current session and evidence."
    ],
    terminalResult: "No cleanup responsibility",
    version: 1
  })
} as const satisfies Record<string, DispositionCleanupCassette>

/** Recorded boundary transcript retained beside the authored chronology. */
export const dispositionCleanupRecordedCassetteCatalog = {
  supersededWorktreeAndBranch: {
    authored: "supersededWorktreeAndBranch",
    events: [
      "WorktreeCleanupAuthorized",
      "WorktreeCleanupObservationIntended",
      "WorktreeCleanupObserved",
      "WorktreeCleanupMutationIntended",
      "WorktreeCleanupMutationResultRecorded",
      "WorktreeCleanupObservationIntended",
      "WorktreeCleanupObserved",
      "WorktreeCleanupAbsenceConfirmed",
      "WorktreeCleanupSettled",
      "BranchCleanupAuthorized",
      "BranchCleanupObservationIntended",
      "BranchCleanupObserved",
      "BranchCleanupMutationIntended",
      "BranchCleanupMutationResultRecorded",
      "BranchCleanupObservationIntended",
      "BranchCleanupObserved",
      "BranchCleanupAbsenceConfirmed",
      "BranchCleanupSettled"
    ]
  },
  abandonedWorktree: {
    authored: "abandonedWorktree",
    events: [
      "WorktreeCleanupAuthorized",
      "WorktreeCleanupObservationIntended",
      "WorktreeCleanupObserved",
      "WorktreeCleanupMutationIntended",
      "WorktreeCleanupMutationResultRecorded",
      "WorktreeCleanupObservationIntended",
      "WorktreeCleanupObserved",
      "WorktreeCleanupAbsenceConfirmed",
      "WorktreeCleanupSettled",
      "BranchCleanupAuthorized",
      "BranchCleanupObservationIntended",
      "BranchCleanupObserved",
      "BranchCleanupContradicted"
    ]
  },
  changedGitFactsPreserveResources: {
    authored: "changedGitFactsPreserveResources",
    events: [
      "WorktreeCleanupAuthorized",
      "WorktreeCleanupObservationIntended",
      "WorktreeCleanupObserved",
      "WorktreeCleanupContradicted"
    ]
  },
  fullRerunPredecessorCandidate: {
    authored: "fullRerunPredecessorCandidate",
    events: [
      "IntegratorCandidateCleanupAuthorized",
      "IntegratorCandidateCleanupObservationIntended",
      "IntegratorCandidateCleanupObserved",
      "IntegratorCandidateCleanupMutationIntended",
      "IntegratorCandidateCleanupMutationResultRecorded",
      "IntegratorCandidateCleanupObservationIntended",
      "IntegratorCandidateCleanupObserved",
      "IntegratorCandidateCleanupAbsenceConfirmed",
      "IntegratorCandidateCleanupSettled"
    ]
  },
  currentQuarantinePreserved: { authored: "currentQuarantinePreserved", events: [] }
} as const

export type DispositionCleanupRecordedCassette =
  (typeof dispositionCleanupRecordedCassetteCatalog)[keyof typeof dispositionCleanupRecordedCassetteCatalog]

const cleanupCassetteRunId = RunId.make("cleanup-maintained-cassette-run")
const cleanupCassetteShaLength = 40
const cleanupCassetteEvidenceDigestLength = 64
const cleanupCassetteQueuedAtPosition = 17
const cleanupCassetteStartedAtPosition = 18
const cleanupCassetteTargetLineagePosition = 20
const cleanupCassetteSuccessorTargetLineagePosition = 27
const cleanupCassetteQuarantinePosition = 24
const cleanupCassetteDirectionPosition = 25
const cleanupCassetteSecondEvidenceRevision = 2
const cleanupCassetteBaseSha = GitCommitSha.make("1".repeat(cleanupCassetteShaLength))
const cleanupCassetteAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("cleanup-maintained-p1"),
  baseSha: cleanupCassetteBaseSha,
  branch: cleanupCassetteP1Branch,
  executor: TaskExecutorLocator.make("executor:cleanup-maintained"),
  runId: cleanupCassetteRunId,
  taskId: TaskId.make("cleanup-maintained-task"),
  taskRevision: TaskRevision.make("cleanup-maintained-revision"),
  worktree: cleanupCassetteP1Worktree
})
const cleanupCassetteSuccessor = PlannedTaskAttempt.make({
  ...cleanupCassetteAttempt,
  attemptId: AttemptId.make("cleanup-maintained-p2"),
  branch: TaskBranchRef.make("refs/heads/task/cleanup-maintained-p2"),
  taskRevision: encodeTaskRevisionFingerprint(
    JSON.stringify({ body: "cleanup provenance witness", title: "cleanup provenance witness" })
  ),
  worktree: WorktreeLocator.make("/tmp/cleanup-maintained-p2")
})
const cleanupCassetteIntegrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("repo:cleanup-maintained")
})
const cleanupCassetteAcceptedResult = AcceptedResult.make({
  commit: cleanupCassetteBaseSha,
  evidenceManifest: EvidenceReference.make({
    byteLength: 1,
    digest: EvidenceDigest.make("a".repeat(cleanupCassetteEvidenceDigestLength))
  })
})
const cleanupCassettePredecessor = IntegratorSessionCorrelation.make({
  acceptedResult: cleanupCassetteAcceptedResult,
  candidateResource: cleanupCassetteP1Candidate,
  expectedTargetHead: cleanupCassetteBaseSha,
  integrationTarget: cleanupCassetteIntegrationTarget,
  plannedAttempt: cleanupCassetteAttempt,
  queuedAt: JournalPosition.make(cleanupCassetteQueuedAtPosition),
  sessionId: cleanupCassetteP1Session,
  startedAt: JournalPosition.make(cleanupCassetteStartedAtPosition),
  targetLineageObservedAt: JournalPosition.make(cleanupCassetteTargetLineagePosition)
})
const cleanupCassetteSuccessorSession = integratorSuccessorCorrelationFor({
  predecessor: cleanupCassettePredecessor,
  quarantineAt: JournalPosition.make(cleanupCassetteQuarantinePosition),
  directionAppliedAt: JournalPosition.make(cleanupCassetteDirectionPosition),
  targetLineage: {
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: cleanupCassetteAttempt.baseSha,
    targetHeadSha: cleanupCassetteBaseSha
  },
  targetLineageObservedAt: JournalPosition.make(cleanupCassetteSuccessorTargetLineagePosition)
})
const worktreePresent = WorktreeCleanupObservation.cases.Present.make({
  attemptId: cleanupCassetteAttempt.attemptId,
  branch: cleanupCassetteAttempt.branch,
  headSha: cleanupCassetteBaseSha,
  locator: cleanupCassetteAttempt.worktree,
  revision: WorktreeCleanupEvidenceRevision.make(1),
  writerQuiescent: true
})
const branchPresent = BranchCleanupObservation.cases.Present.make({
  branch: cleanupCassetteAttempt.branch,
  headSha: cleanupCassetteBaseSha,
  registeredWorktree: null,
  revision: BranchCleanupEvidenceRevision.make(1)
})
const candidatePresent = IntegratorCandidateCleanupObservation.cases.Present.make({
  locator: cleanupCassettePredecessor.candidateResource,
  revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  sessionId: cleanupCassettePredecessor.sessionId,
  writerQuiescent: true
})

/** One actual provider-neutral call and its typed response, retained as a replayable transcript. */
const DispositionCleanupTranscriptEntry = Schema.TaggedUnion({
  BranchMutationResult: {
    attempt: CleanupMutationOrdinal,
    authorization: BranchCleanupAuthorization,
    call: DispositionCleanupBoundaryCall.cases.BranchRemove,
    operationId: OperationId,
    result: BranchCleanupMutationResult
  },
  BranchObserved: {
    authorization: BranchCleanupAuthorization,
    call: DispositionCleanupBoundaryCall.cases.BranchObserve,
    observation: BranchCleanupObservation,
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  CandidateMutationResult: {
    attempt: CleanupMutationOrdinal,
    authorization: IntegratorCandidateCleanupAuthorization,
    call: DispositionCleanupBoundaryCall.cases.CandidateRemove,
    operationId: OperationId,
    result: IntegratorCandidateCleanupMutationResult
  },
  CandidateObserved: {
    authorization: IntegratorCandidateCleanupAuthorization,
    call: DispositionCleanupBoundaryCall.cases.CandidateObserve,
    observation: IntegratorCandidateCleanupObservation,
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  },
  WorktreeMutationResult: {
    attempt: CleanupMutationOrdinal,
    authorization: WorktreeCleanupAuthorization,
    call: DispositionCleanupBoundaryCall.cases.WorktreeRemove,
    operationId: OperationId,
    result: WorktreeCleanupMutationResult
  },
  WorktreeObserved: {
    authorization: WorktreeCleanupAuthorization,
    call: DispositionCleanupBoundaryCall.cases.WorktreeObserve,
    observation: WorktreeCleanupObservation,
    operationId: OperationId,
    ordinal: CleanupObservationOrdinal
  }
})
type DispositionCleanupTranscriptEntry = typeof DispositionCleanupTranscriptEntry.Type

/** Frozen typed boundary witness retained in the recorded catalog.  This is
 * separate from journal-tag projection so a replay proves the exact locator,
 * owner, evidence revision, observation, and mutation result. */
export const DispositionCleanupTranscriptWitness = Schema.Struct({
  _tag: Schema.String,
  branch: Schema.NullOr(TaskBranchRef),
  call: Schema.Union([
    DispositionCleanupBoundaryCall.cases.BranchObserve,
    DispositionCleanupBoundaryCall.cases.BranchRemove,
    DispositionCleanupBoundaryCall.cases.CandidateObserve,
    DispositionCleanupBoundaryCall.cases.CandidateRemove,
    DispositionCleanupBoundaryCall.cases.WorktreeObserve,
    DispositionCleanupBoundaryCall.cases.WorktreeRemove
  ]),
  evidenceRevision: Schema.Union([
    WorktreeCleanupEvidenceRevision,
    BranchCleanupEvidenceRevision,
    IntegratorCandidateCleanupEvidenceRevision
  ]),
  locator: Schema.NullOr(Schema.Union([WorktreeLocator, IntegratorCandidateResourceLocator])),
  observation: Schema.NullOr(
    Schema.Union([WorktreeCleanupObservation, BranchCleanupObservation, IntegratorCandidateCleanupObservation])
  ),
  ownerAttemptId: Schema.NullOr(AttemptId),
  ownerBranch: Schema.NullOr(TaskBranchRef),
  ownerSessionId: Schema.NullOr(IntegratorSessionId),
  result: Schema.NullOr(
    Schema.Union([WorktreeCleanupMutationResult, BranchCleanupMutationResult, IntegratorCandidateCleanupMutationResult])
  )
})
export type DispositionCleanupTranscriptWitness = typeof DispositionCleanupTranscriptWitness.Type

const transcriptWitnessesFor = (
  transcript: ReadonlyArray<DispositionCleanupTranscriptEntry>
): ReadonlyArray<DispositionCleanupTranscriptWitness> =>
  transcript.map((entry) => {
    const authorization = entry.authorization
    const call = entry.call
    const ownerAttemptId = "attemptId" in authorization.owner ? authorization.owner.attemptId : null
    const ownerBranch = "branch" in authorization.owner ? authorization.owner.branch : null
    const ownerSessionId = "sessionId" in authorization.owner ? authorization.owner.sessionId : null
    const branch =
      call._tag === "BranchObserve" || call._tag === "BranchRemove"
        ? call.branch
        : call._tag === "WorktreeRemove"
          ? call.branch
          : ownerBranch
    const locator =
      call._tag === "WorktreeObserve" ||
      call._tag === "WorktreeRemove" ||
      call._tag === "CandidateObserve" ||
      call._tag === "CandidateRemove"
        ? call.locator
        : null
    return Object.freeze(
      DispositionCleanupTranscriptWitness.make({
        _tag: entry._tag,
        branch,
        call,
        evidenceRevision: authorization.evidenceRevision,
        locator,
        observation: "observation" in entry ? entry.observation : null,
        ownerAttemptId,
        ownerBranch,
        ownerSessionId,
        result: "result" in entry ? entry.result : null
      })
    )
  })

const transcriptWitnessEqual = Schema.toEquivalence(Schema.Array(DispositionCleanupTranscriptWitness))

/** Typed sentinels prove cleanup does not rewrite live successor, Integrator, history, or Git evidence. */
const DispositionCleanupSentinels = Schema.Struct({
  c2: Schema.NullOr(IntegratorSessionCorrelation),
  evidence: Schema.Struct({
    direction: Schema.NullOr(IntegrationQuarantineDirectionFingerprint),
    targetHead: Schema.NullOr(GitCommitSha),
    worktreeHead: Schema.NullOr(GitCommitSha)
  }),
  history: Schema.Array(JournalRecord),
  p2: Schema.NullOr(PlannedTaskAttempt),
  s1: Schema.NullOr(IntegratorSessionCorrelation)
})
type DispositionCleanupSentinels = typeof DispositionCleanupSentinels.Type

const upstreamSentinelsFor = (records: ReadonlyArray<JournalRecord>): DispositionCleanupSentinels => {
  const upstream = upstreamRecords(records)
  const p2 = upstream.find(({ event }) => event._tag === "PlannedAttemptReplaced")
  const s1 = upstream.find(({ event }) => event._tag === "IntegratorSessionFixed")
  const c2 = upstream.find(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")
  const worktree = upstream.find(({ event }) => event._tag === "PlannedAttemptWorktreeObserved")
  const target = upstream.find(({ event }) => event._tag === "TargetLineageObserved")
  const direction = upstream.find(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")
  return DispositionCleanupSentinels.make({
    c2: c2?.event._tag === "IntegratorSuccessorSessionFixed" ? c2.event.successor : null,
    evidence: {
      direction: direction?.event._tag === "IntegrationQuarantineDirectionApplied" ? direction.event.fingerprint : null,
      targetHead: target?.event._tag === "TargetLineageObserved" ? target.event.observation.targetHeadSha : null,
      worktreeHead:
        worktree?.event._tag === "PlannedAttemptWorktreeObserved" &&
        worktree.event.observation._tag === "PlannedWorktreeReady"
          ? worktree.event.observation.headSha
          : null
    },
    history: upstream,
    p2: p2?.event._tag === "PlannedAttemptReplaced" ? p2.event.successorPlan.plannedAttempt : null,
    s1: s1?.event._tag === "IntegratorSessionFixed" ? s1.event.correlation : null
  })
}

const worktreeBoundaryCallsFor = (
  calls: ReadonlyArray<WorktreeCleanupBoundaryCall>
): ReadonlyArray<DispositionCleanupBoundaryCall> =>
  calls.map((call) =>
    call._tag === "Observe"
      ? DispositionCleanupBoundaryCall.cases.WorktreeObserve.make({
          locator: call.locator,
          operationId: call.operationId,
          ordinal: call.ordinal
        })
      : DispositionCleanupBoundaryCall.cases.WorktreeRemove.make({
          branch: call.branch,
          locator: call.locator,
          operationId: call.operationId,
          ordinal: call.ordinal
        })
  )

const branchBoundaryCallsFor = (
  calls: ReadonlyArray<BranchCleanupBoundaryCall>
): ReadonlyArray<DispositionCleanupBoundaryCall> =>
  calls.map((call) =>
    call._tag === "Observe"
      ? DispositionCleanupBoundaryCall.cases.BranchObserve.make({
          branch: call.branch,
          operationId: call.operationId,
          ordinal: call.ordinal
        })
      : DispositionCleanupBoundaryCall.cases.BranchRemove.make({
          branch: call.branch,
          operationId: call.operationId,
          ordinal: call.ordinal
        })
  )

const candidateBoundaryCallsFor = (
  calls: ReadonlyArray<IntegratorCandidateCleanupBoundaryCall>
): ReadonlyArray<DispositionCleanupBoundaryCall> =>
  calls.map((call) =>
    call._tag === "Observe"
      ? DispositionCleanupBoundaryCall.cases.CandidateObserve.make({
          locator: call.locator,
          operationId: call.operationId,
          ordinal: call.ordinal,
          sessionId: call.sessionId
        })
      : DispositionCleanupBoundaryCall.cases.CandidateRemove.make({
          locator: call.locator,
          operationId: call.operationId,
          ordinal: call.ordinal,
          sessionId: call.sessionId
        })
  )

const upstreamRecords = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<JournalRecord> =>
  records.filter(({ event }) => !event._tag.includes("Cleanup"))

const transcriptFor = (
  records: ReadonlyArray<JournalRecord>,
  boundaryCalls: ReadonlyArray<DispositionCleanupBoundaryCall>
): ReadonlyArray<DispositionCleanupTranscriptEntry> =>
  records.flatMap<DispositionCleanupTranscriptEntry>(({ event }) => {
    if (event._tag === "WorktreeCleanupObserved") {
      const call = boundaryCalls.find(
        (candidate) =>
          candidate._tag === "WorktreeObserve" &&
          candidate.operationId === event.authorization.operationId &&
          candidate.ordinal === event.ordinal
      )
      if (call === undefined || call._tag !== "WorktreeObserve") return []
      return [
        DispositionCleanupTranscriptEntry.cases.WorktreeObserved.make({
          authorization: event.authorization,
          call,
          observation: event.observation,
          operationId: event.operationId,
          ordinal: event.ordinal
        })
      ]
    }
    if (event._tag === "WorktreeCleanupMutationResultRecorded") {
      const call = boundaryCalls.find(
        (candidate) =>
          candidate._tag === "WorktreeRemove" &&
          candidate.operationId === event.authorization.operationId &&
          candidate.ordinal === event.attempt
      )
      if (call === undefined || call._tag !== "WorktreeRemove") return []
      return [
        DispositionCleanupTranscriptEntry.cases.WorktreeMutationResult.make({
          attempt: event.attempt,
          authorization: event.authorization,
          call,
          operationId: event.operationId,
          result: event.result
        })
      ]
    }
    if (event._tag === "BranchCleanupObserved") {
      const call = boundaryCalls.find(
        (candidate) =>
          candidate._tag === "BranchObserve" &&
          candidate.operationId === event.authorization.operationId &&
          candidate.ordinal === event.ordinal
      )
      if (call === undefined || call._tag !== "BranchObserve") return []
      return [
        DispositionCleanupTranscriptEntry.cases.BranchObserved.make({
          authorization: event.authorization,
          call,
          observation: event.observation,
          operationId: event.operationId,
          ordinal: event.ordinal
        })
      ]
    }
    if (event._tag === "BranchCleanupMutationResultRecorded") {
      const call = boundaryCalls.find(
        (candidate) =>
          candidate._tag === "BranchRemove" &&
          candidate.operationId === event.authorization.operationId &&
          candidate.ordinal === event.attempt
      )
      if (call === undefined || call._tag !== "BranchRemove") return []
      return [
        DispositionCleanupTranscriptEntry.cases.BranchMutationResult.make({
          attempt: event.attempt,
          authorization: event.authorization,
          call,
          operationId: event.operationId,
          result: event.result
        })
      ]
    }
    if (event._tag === "IntegratorCandidateCleanupObserved") {
      const call = boundaryCalls.find(
        (candidate) =>
          candidate._tag === "CandidateObserve" &&
          candidate.operationId === event.authorization.operationId &&
          candidate.ordinal === event.ordinal
      )
      if (call === undefined || call._tag !== "CandidateObserve") return []
      return [
        DispositionCleanupTranscriptEntry.cases.CandidateObserved.make({
          authorization: event.authorization,
          call,
          observation: event.observation,
          operationId: event.operationId,
          ordinal: event.ordinal
        })
      ]
    }
    if (event._tag === "IntegratorCandidateCleanupMutationResultRecorded") {
      const call = boundaryCalls.find(
        (candidate) =>
          candidate._tag === "CandidateRemove" &&
          candidate.operationId === event.authorization.operationId &&
          candidate.ordinal === event.attempt
      )
      if (call === undefined || call._tag !== "CandidateRemove") return []
      return [
        DispositionCleanupTranscriptEntry.cases.CandidateMutationResult.make({
          attempt: event.attempt,
          authorization: event.authorization,
          call,
          operationId: event.operationId,
          result: event.result
        })
      ]
    }
    return []
  })

const expectedTranscriptWitnessesFor = (
  cassette: DispositionCleanupCassette
): ReadonlyArray<DispositionCleanupTranscriptWitness> =>
  Object.freeze(
    cassette.expectedBoundaryCalls.map((call) => {
      const isWorktree = call._tag === "WorktreeObserve" || call._tag === "WorktreeRemove"
      const isBranch = call._tag === "BranchObserve" || call._tag === "BranchRemove"
      const isCandidate = call._tag === "CandidateObserve" || call._tag === "CandidateRemove"
      const observation =
        call._tag === "WorktreeObserve"
          ? cassette.scenario === "ChangedGitFactsPreserveResources"
            ? WorktreeCleanupObservation.cases.Foreign.make({
                locator: cleanupCassetteAttempt.worktree,
                observedBranch: TaskBranchRef.make("refs/heads/other"),
                observedHead: cleanupCassetteBaseSha,
                reason: "OtherBranch",
                revision: WorktreeCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
              })
            : Number(call.ordinal) === 1
              ? worktreePresent
              : WorktreeCleanupObservation.cases.Absent.make({
                  locator: cleanupCassetteAttempt.worktree,
                  revision: WorktreeCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
                })
          : call._tag === "BranchObserve"
            ? cassette.scenario === "AbandonedWorktree"
              ? BranchCleanupObservation.cases.Unreadable.make({
                  branch: cleanupCassetteP1Branch,
                  detail: "script exhausted"
                })
              : Number(call.ordinal) === 1
                ? branchPresent
                : BranchCleanupObservation.cases.Absent.make({
                    branch: cleanupCassetteP1Branch,
                    revision: BranchCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
                  })
            : call._tag === "CandidateObserve"
              ? Number(call.ordinal) === 1
                ? candidatePresent
                : IntegratorCandidateCleanupObservation.cases.Absent.make({
                    locator: cleanupCassetteP1Candidate,
                    revision: IntegratorCandidateCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
                  })
              : null
      const result =
        call._tag === "WorktreeRemove"
          ? WorktreeCleanupMutationResult.cases.Removed.make({
              branch: cleanupCassetteP1Branch,
              locator: cleanupCassetteP1Worktree,
              revision: WorktreeCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
            })
          : call._tag === "BranchRemove"
            ? BranchCleanupMutationResult.cases.Removed.make({
                branch: cleanupCassetteP1Branch,
                revision: BranchCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
              })
            : call._tag === "CandidateRemove"
              ? IntegratorCandidateCleanupMutationResult.cases.Removed.make({
                  locator: cleanupCassetteP1Candidate,
                  revision: IntegratorCandidateCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision),
                  sessionId: cleanupCassetteP1Session
                })
              : null
      return Object.freeze(
        DispositionCleanupTranscriptWitness.make({
          _tag:
            call._tag === "WorktreeObserve"
              ? "WorktreeObserved"
              : call._tag === "WorktreeRemove"
                ? "WorktreeMutationResult"
                : call._tag === "BranchObserve"
                  ? "BranchObserved"
                  : call._tag === "BranchRemove"
                    ? "BranchMutationResult"
                    : call._tag === "CandidateObserve"
                      ? "CandidateObserved"
                      : "CandidateMutationResult",
          branch: isBranch
            ? call.branch
            : isWorktree && call._tag === "WorktreeRemove"
              ? call.branch
              : isWorktree
                ? cleanupCassetteP1Branch
                : null,
          call,
          evidenceRevision: isWorktree
            ? WorktreeCleanupEvidenceRevision.make(1)
            : isBranch
              ? BranchCleanupEvidenceRevision.make(1)
              : IntegratorCandidateCleanupEvidenceRevision.make(1),
          locator: isWorktree || isCandidate ? call.locator : null,
          observation,
          ownerAttemptId: isWorktree || isBranch ? cleanupCassetteAttempt.attemptId : null,
          ownerBranch: isWorktree ? cleanupCassetteP1Branch : null,
          ownerSessionId: isCandidate ? cleanupCassetteP1Session : null,
          result
        })
      )
    })
  )

/** Recorded typed transcripts are maintained independently from journal-tag catalogs. */
export const dispositionCleanupRecordedTranscriptCatalog = Object.freeze({
  supersededWorktreeAndBranch: expectedTranscriptWitnessesFor(
    dispositionCleanupAuthoredCassetteCatalog.supersededWorktreeAndBranch
  ),
  abandonedWorktree: expectedTranscriptWitnessesFor(dispositionCleanupAuthoredCassetteCatalog.abandonedWorktree),
  changedGitFactsPreserveResources: expectedTranscriptWitnessesFor(
    dispositionCleanupAuthoredCassetteCatalog.changedGitFactsPreserveResources
  ),
  fullRerunPredecessorCandidate: expectedTranscriptWitnessesFor(
    dispositionCleanupAuthoredCassetteCatalog.fullRerunPredecessorCandidate
  ),
  currentQuarantinePreserved: expectedTranscriptWitnessesFor(
    dispositionCleanupAuthoredCassetteCatalog.currentQuarantinePreserved
  )
})

/** Observable result of one maintained cleanup cassette after its production loop. */
export interface DispositionCleanupCassetteRun {
  readonly boundaryCalls: ReadonlyArray<DispositionCleanupBoundaryCall>
  readonly forbiddenBoundaryCalls: ReadonlyArray<DispositionCleanupBoundaryCall>
  readonly forbiddenJournalTags: ReadonlyArray<string>
  readonly journalTags: ReadonlyArray<string>
  readonly records: ReadonlyArray<JournalRecord>
  readonly scenario: DispositionCleanupCassette["scenario"]
  readonly sentinelsAfter: typeof DispositionCleanupSentinels.Type
  readonly sentinelsBefore: typeof DispositionCleanupSentinels.Type
  readonly terminalResult: string
  readonly transcript: ReadonlyArray<typeof DispositionCleanupTranscriptEntry.Type>
  readonly transcriptWitnesses: ReadonlyArray<typeof DispositionCleanupTranscriptWitness.Type>
  readonly version: 1
}

/**
 * Inputs at the real candidate boundary when an already-completed delivery
 * history is reactivated before normal Run termination.
 */
export interface FullRerunPredecessorCleanupFromHistoryInput {
  readonly activations: number
  readonly evidenceRevision: IntegratorCandidateCleanupEvidenceRevision
  readonly history: ReadonlyArray<JournalRecord>
  readonly mutations?: ReadonlyArray<IntegratorCandidateCleanupMutationResult>
  readonly observations: ReadonlyArray<IntegratorCandidateCleanupObservation>
}

/** Evidence retained by the delivery-story test after ordinary cleanup activation. */
export interface FullRerunPredecessorCleanupFromHistoryRun {
  readonly boundaryCalls: ReadonlyArray<IntegratorCandidateCleanupBoundaryCall>
  readonly outcomes: ReadonlyArray<DispositionCleanupLoopResult>
  readonly records: ReadonlyArray<JournalRecord>
  readonly upstreamAfter: ReadonlyArray<JournalRecord>
  readonly upstreamBefore: ReadonlyArray<JournalRecord>
}

/**
 * Reopens the exact pre-termination prefix and invokes the same ordinary
 * activation capability used by production. The controlled boundary supplies
 * observations only; authorization is still derived from the durable
 * S1/quarantine/FullRerun/S2 history by the generic cleanup protocol.
 */
export const runFullRerunPredecessorCleanupFromHistory = Effect.fn(
  "DispositionCleanupCassette.runFullRerunPredecessorCleanupFromHistory"
)(function* (input: FullRerunPredecessorCleanupFromHistoryInput) {
  const activeHistory = input.history.filter(({ event }) => event._tag !== "WorkflowRunTerminated")
  const upstreamBefore = upstreamRecords(activeHistory)
  const layers = Layer.mergeAll(
    memoryJournalTestLayerFromPartitionRecords({ hot: activeHistory }),
    worktreeCleanupTestLayer({ observations: [] }),
    branchCleanupTestLayer({ observations: [] }),
    integratorCandidateCleanupTestLayer({
      evidenceRevision: input.evidenceRevision,
      ...(input.mutations === undefined ? {} : { mutations: input.mutations }),
      observations: input.observations
    })
  )
  return yield* Effect.gen(function* () {
    const runId = activeHistory[0]?.runId
    if (runId === undefined) return yield* Effect.die("delivery cleanup history is empty")
    const beginning = activeHistory[0]
    if (beginning?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("delivery cleanup lacks Run beginning")
    const storage = yield* JournalStore
    const initial = reduceWorkflowJournalHistory(runId, activeHistory)
    if (initial._tag === "InvalidWorkflowJournalHistory")
      return yield* Effect.die("delivery cleanup history is invalid")
    const outcomes = yield* Effect.forEach(Array.from({ length: input.activations }), () =>
      makeDispositionCleanupActivation(runId).pipe(Effect.flatMap((activation) => activation.run))
    ).pipe(Effect.provide(journalLayer(runId, beginning.event.target, initial, storage)))
    const records = yield* (yield* JournalStore).read(runId)
    const boundaryCalls = yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()
    const result: FullRerunPredecessorCleanupFromHistoryRun = {
      boundaryCalls,
      outcomes,
      records,
      upstreamAfter: upstreamRecords(records),
      upstreamBefore
    }
    return result
  }).pipe(Effect.provide(layers))
})

export const DispositionCleanupCassetteRun: Schema.Schema<DispositionCleanupCassetteRun> = Schema.Struct({
  boundaryCalls: Schema.Array(DispositionCleanupBoundaryCall),
  forbiddenBoundaryCalls: Schema.Array(DispositionCleanupBoundaryCall),
  forbiddenJournalTags: Schema.Array(Schema.String),
  journalTags: Schema.Array(Schema.String),
  records: Schema.Array(JournalRecord),
  scenario: Schema.Literals([
    "SupersededWorktreeAndBranch",
    "AbandonedWorktree",
    "ChangedGitFactsPreserveResources",
    "FullRerunPredecessorCandidate",
    "CurrentQuarantinePreserved"
  ]),
  sentinelsAfter: DispositionCleanupSentinels,
  sentinelsBefore: DispositionCleanupSentinels,
  terminalResult: Schema.NonEmptyString,
  transcript: Schema.Array(DispositionCleanupTranscriptEntry),
  transcriptWitnesses: Schema.Array(DispositionCleanupTranscriptWitness),
  version: Schema.Literal(1)
})

const recordsAreUnchanged = (before: ReadonlyArray<JournalRecord>, after: ReadonlyArray<JournalRecord>): boolean =>
  JSON.stringify(upstreamRecords(before)) === JSON.stringify(upstreamRecords(after))

/** Runs one authored cleanup chronology through all applicable production protocol boundaries. */
export const runDispositionCleanupCassette: (
  cassette: DispositionCleanupCassette
) => Effect.Effect<DispositionCleanupCassetteRun, unknown> = Effect.fn("DispositionCleanupCassette.run")(function* (
  cassette: DispositionCleanupCassette
) {
  const worktreeBoundaryInput =
    cassette.scenario === "SupersededWorktreeAndBranch" || cassette.scenario === "AbandonedWorktree"
      ? {
          observations: [
            worktreePresent,
            WorktreeCleanupObservation.cases.Absent.make({
              locator: cleanupCassetteAttempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
            })
          ],
          mutations: [
            WorktreeCleanupMutationResult.cases.Removed.make({
              branch: cleanupCassetteAttempt.branch,
              locator: cleanupCassetteAttempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
            })
          ]
        }
      : cassette.scenario === "ChangedGitFactsPreserveResources"
        ? {
            observations: [
              WorktreeCleanupObservation.cases.Foreign.make({
                locator: cleanupCassetteAttempt.worktree,
                observedBranch: TaskBranchRef.make("refs/heads/other"),
                observedHead: cleanupCassetteBaseSha,
                reason: "OtherBranch",
                revision: WorktreeCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
              })
            ]
          }
        : { observations: [] }
  const branchBoundaryInput =
    cassette.scenario === "SupersededWorktreeAndBranch"
      ? {
          observations: [
            branchPresent,
            BranchCleanupObservation.cases.Absent.make({
              branch: cleanupCassetteAttempt.branch,
              revision: BranchCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
            })
          ],
          mutations: [
            BranchCleanupMutationResult.cases.Removed.make({
              branch: cleanupCassetteAttempt.branch,
              revision: BranchCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
            })
          ]
        }
      : { observations: [] }
  const candidateBoundaryInput =
    cassette.scenario === "FullRerunPredecessorCandidate"
      ? {
          observations: [
            candidatePresent,
            IntegratorCandidateCleanupObservation.cases.Absent.make({
              locator: cleanupCassettePredecessor.candidateResource,
              revision: IntegratorCandidateCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision)
            })
          ],
          mutations: [
            IntegratorCandidateCleanupMutationResult.cases.Removed.make({
              locator: cleanupCassettePredecessor.candidateResource,
              revision: IntegratorCandidateCleanupEvidenceRevision.make(cleanupCassetteSecondEvidenceRevision),
              sessionId: cleanupCassettePredecessor.sessionId
            })
          ]
        }
      : { observations: [] }
  const layers = Layer.mergeAll(
    memoryJournalTestLayer,
    worktreeCleanupTestLayer(worktreeBoundaryInput),
    branchCleanupTestLayer(branchBoundaryInput),
    integratorCandidateCleanupTestLayer(candidateBoundaryInput)
  )
  return yield* Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      cleanupCassetteRunId,
      FixtureTarget.make("cleanup-maintained-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      cleanupCassetteRemotePublicationTarget
    )
    const initial = reduceWorkflowJournalHistory(cleanupCassetteRunId, yield* journal.read(cleanupCassetteRunId))
    if (initial._tag === "InvalidWorkflowJournalHistory") {
      return yield* Effect.die("cleanup cassette initial history is invalid")
    }
    return yield* Effect.gen(function* () {
      if (
        cassette.scenario === "SupersededWorktreeAndBranch" ||
        cassette.scenario === "ChangedGitFactsPreserveResources"
      ) {
        yield* appendReplacementProvenance(cleanupCassetteAttempt, cleanupCassetteSuccessor, "StartupValid")
      } else if (cassette.scenario === "AbandonedWorktree") {
        yield* appendAbandonedProvenance(cleanupCassetteAttempt, cleanupCassetteAbandonedCleanupOperation)
      } else if (cassette.scenario === "FullRerunPredecessorCandidate") {
        yield* appendCandidateProvenance(
          cleanupCassettePredecessor,
          cleanupCassetteSuccessorSession,
          "cleanup-maintained-full-rerun",
          "StartupValid"
        )
      } else {
        yield* appendCurrentQuarantineProvenance(cleanupCassettePredecessor, "StartupValid")
      }
      const upstreamBeforeCleanup = yield* journal.read(cleanupCassetteRunId)
      const loop = yield* runDispositionCleanupLoop(cleanupCassetteRunId, undefined, () =>
        Effect.succeed(candidatePresent.revision)
      )
      let terminalResult: string
      if (cassette.scenario === "SupersededWorktreeAndBranch") {
        if (loop.worktree?._tag !== "Settled" || loop.branch?._tag !== "Settled") {
          return yield* Effect.die("superseded cleanup cassette did not settle both exact resources")
        }
        terminalResult = "P1 worktree and branch settled; P2 remains live"
      } else if (cassette.scenario === "AbandonedWorktree") {
        if (loop.worktree?._tag !== "Settled" || loop.branch?._tag !== "Preserved")
          return yield* Effect.die("abandoned cleanup cassette did not settle W1 and preserve its branch")
        terminalResult = "Abandoned P1 worktree settled; no later executor command is accepted"
      } else if (cassette.scenario === "ChangedGitFactsPreserveResources") {
        if (loop.worktree?._tag !== "Preserved") return yield* Effect.die("changed-facts cassette did not preserve W1")
        terminalResult = "Preserved with a typed contradiction"
      } else if (cassette.scenario === "FullRerunPredecessorCandidate") {
        if (loop.candidate?._tag !== "Settled")
          return yield* Effect.die("FullRerun cassette did not settle predecessor C1")
        terminalResult = "C1 settled; S1 history and C2 preserved"
      } else {
        if (
          loop.selected.worktree !== undefined ||
          loop.selected.branch !== undefined ||
          loop.selected.candidate !== undefined
        ) {
          return yield* Effect.die("current quarantine was incorrectly selected for cleanup")
        }
        terminalResult = "No cleanup responsibility"
      }
      const sentinelsBefore = upstreamSentinelsFor(upstreamBeforeCleanup)
      const records = yield* journal.read(cleanupCassetteRunId)
      const worktreeCalls = yield* (yield* TestWorktreeCleanupBoundary).calls()
      const branchCalls = yield* (yield* TestBranchCleanupBoundary).calls()
      const candidateCalls = yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()
      const boundaryCalls: ReadonlyArray<DispositionCleanupBoundaryCall> = [
        ...worktreeBoundaryCallsFor(worktreeCalls),
        ...branchBoundaryCallsFor(branchCalls),
        ...candidateBoundaryCallsFor(candidateCalls)
      ]
      const sentinelsAfter = upstreamSentinelsFor(records)
      const transcript = transcriptFor(records, boundaryCalls)
      const transcriptWitnesses = transcriptWitnessesFor(transcript)
      const recordedTranscriptKey =
        cassette.scenario === "SupersededWorktreeAndBranch"
          ? "supersededWorktreeAndBranch"
          : cassette.scenario === "AbandonedWorktree"
            ? "abandonedWorktree"
            : cassette.scenario === "ChangedGitFactsPreserveResources"
              ? "changedGitFactsPreserveResources"
              : cassette.scenario === "FullRerunPredecessorCandidate"
                ? "fullRerunPredecessorCandidate"
                : "currentQuarantinePreserved"
      if (
        !transcriptWitnessEqual(transcriptWitnesses, dispositionCleanupRecordedTranscriptCatalog[recordedTranscriptKey])
      ) {
        return yield* Effect.die(`cleanup cassette typed transcript mismatch: ${cassette.forbiddenResult}`)
      }
      if (JSON.stringify(boundaryCalls) !== JSON.stringify(cassette.expectedBoundaryCalls)) {
        return yield* Effect.die(
          `cleanup cassette boundary mismatch: expected ${JSON.stringify(cassette.expectedBoundaryCalls)}, received ${JSON.stringify(boundaryCalls)}`
        )
      }
      if (terminalResult !== cassette.terminalResult) {
        return yield* Effect.die(
          `cleanup cassette terminal mismatch: expected ${cassette.terminalResult}, received ${terminalResult}`
        )
      }
      if (!recordsAreUnchanged(upstreamBeforeCleanup, records)) {
        return yield* Effect.die("cleanup cassette changed an upstream P2/S1/C2, history, or evidence sentinel")
      }
      const allowedBoundaryCall = (call: DispositionCleanupBoundaryCall): boolean => {
        if (cassette.scenario === "SupersededWorktreeAndBranch") {
          switch (call._tag) {
            case "WorktreeObserve":
              return call.locator === cleanupCassetteP1Worktree
            case "WorktreeRemove":
              return call.locator === cleanupCassetteP1Worktree && call.branch === cleanupCassetteP1Branch
            case "BranchObserve":
            case "BranchRemove":
              return call.branch === cleanupCassetteP1Branch
            case "CandidateObserve":
            case "CandidateRemove":
              return false
          }
        }
        if (cassette.scenario === "AbandonedWorktree") {
          return call._tag === "WorktreeObserve" || call._tag === "WorktreeRemove"
            ? call.locator === cleanupCassetteP1Worktree &&
                call.operationId === cleanupCassetteDerivedAbandonedWorktreeOperation
            : call._tag === "BranchObserve" &&
                call.branch === cleanupCassetteP1Branch &&
                call.operationId === cleanupCassetteDerivedAbandonedBranchOperation
        }
        if (cassette.scenario === "ChangedGitFactsPreserveResources") {
          return call._tag === "WorktreeObserve" && call.locator === cleanupCassetteP1Worktree
        }
        if (cassette.scenario === "FullRerunPredecessorCandidate") {
          return (
            (call._tag === "CandidateObserve" || call._tag === "CandidateRemove") &&
            call.locator === cleanupCassetteP1Candidate &&
            call.sessionId === cleanupCassetteP1Session
          )
        }
        return false
      }
      const forbiddenBoundaryCalls = boundaryCalls.filter((call) => !allowedBoundaryCall(call))
      const expectedCleanupTags =
        dispositionCleanupRecordedCassetteCatalog[
          cassette.scenario === "SupersededWorktreeAndBranch"
            ? "supersededWorktreeAndBranch"
            : cassette.scenario === "AbandonedWorktree"
              ? "abandonedWorktree"
              : cassette.scenario === "ChangedGitFactsPreserveResources"
                ? "changedGitFactsPreserveResources"
                : cassette.scenario === "FullRerunPredecessorCandidate"
                  ? "fullRerunPredecessorCandidate"
                  : "currentQuarantinePreserved"
        ].events
      const expectedCleanupTagSet: ReadonlySet<string> = new Set(expectedCleanupTags)
      const forbiddenJournalTags = records
        .map(({ event }) => event._tag)
        .filter((tag) => tag.includes("Cleanup") && !expectedCleanupTagSet.has(tag))
      const forbiddenSatisfied =
        cassette.scenario === "SupersededWorktreeAndBranch"
          ? boundaryCalls.every((call) => {
              switch (call._tag) {
                case "WorktreeObserve":
                  return call.locator === cleanupCassetteP1Worktree
                case "WorktreeRemove":
                  return call.locator === cleanupCassetteP1Worktree && call.branch === cleanupCassetteP1Branch
                case "BranchObserve":
                case "BranchRemove":
                  return call.branch === cleanupCassetteP1Branch
                case "CandidateObserve":
                case "CandidateRemove":
                  return false
                default:
                  return false
              }
            })
          : cassette.scenario === "AbandonedWorktree"
            ? boundaryCalls.every(
                (call) =>
                  ((call._tag === "WorktreeObserve" || call._tag === "WorktreeRemove") &&
                    call.locator === cleanupCassetteP1Worktree &&
                    call.operationId === cleanupCassetteDerivedAbandonedWorktreeOperation) ||
                  (call._tag === "BranchObserve" &&
                    call.branch === cleanupCassetteP1Branch &&
                    call.operationId === cleanupCassetteDerivedAbandonedBranchOperation)
              ) &&
              records.some(({ event }) => event._tag === "AttemptImplementationAbandoned") &&
              !records.some(
                ({ event, position }) =>
                  event._tag === "PlannedAttemptExecutorCommandIntended" &&
                  records.some(
                    ({ event: abandonedEvent, position: abandonedPosition }) =>
                      abandonedEvent._tag === "AttemptImplementationAbandoned" && position > abandonedPosition
                  )
              )
            : cassette.scenario === "ChangedGitFactsPreserveResources"
              ? boundaryCalls.every(
                  (call) => call._tag === "WorktreeObserve" && call.locator === cleanupCassetteP1Worktree
                ) && records.some(({ event }) => event._tag === "WorktreeCleanupContradicted")
              : cassette.scenario === "FullRerunPredecessorCandidate"
                ? boundaryCalls.every(
                    (call) =>
                      (call._tag === "CandidateObserve" || call._tag === "CandidateRemove") &&
                      call.locator === cleanupCassetteP1Candidate &&
                      call.sessionId === cleanupCassetteP1Session
                  ) && records.some(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")
                : boundaryCalls.length === 0 && records.every(({ event }) => !event._tag.includes("Cleanup"))
      if (!forbiddenSatisfied) {
        return yield* Effect.die(`cleanup cassette forbidden result violated: ${cassette.forbiddenResult}`)
      }
      if (forbiddenBoundaryCalls.length > 0 || forbiddenJournalTags.length > 0) {
        return yield* Effect.die(`cleanup cassette forbidden calls/events: ${cassette.forbiddenResult}`)
      }
      return DispositionCleanupCassetteRun.make({
        boundaryCalls,
        forbiddenBoundaryCalls,
        forbiddenJournalTags,
        journalTags: records.map(({ event }) => event._tag),
        records,
        scenario: cassette.scenario,
        sentinelsAfter,
        sentinelsBefore,
        terminalResult,
        transcript,
        transcriptWitnesses,
        version: 1
      })
    }).pipe(
      Effect.provide(
        journalLayer(cleanupCassetteRunId, FixtureTarget.make("cleanup-maintained-target"), initial, journal)
      )
    )
  }).pipe(Effect.provide(layers))
})
