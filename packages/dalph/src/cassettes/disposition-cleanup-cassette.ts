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
  JournalPosition,
  JournalRecord,
  JournalStore,
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
  memoryJournalTestLayer,
  runDispositionCleanupLoop,
  TestBranchCleanupBoundary,
  TestIntegratorCandidateCleanupBoundary,
  TestWorktreeCleanupBoundary,
  worktreeCleanupTestLayer
} from "@dalph/orchestrator"

const issue69P1Worktree = WorktreeLocator.make("/tmp/issue-69-maintained-p1")
const issue69P1Branch = TaskBranchRef.make("refs/heads/task/issue-69-maintained-p1")
const issue69AbandonedCleanupOperation = OperationId.make("issue-69-maintained-abandoned-worktree-cleanup")
const issue69P1Candidate = IntegratorCandidateResourceLocator.make("candidate:issue-69-maintained-p1")
const issue69P1Session = IntegratorSessionId.make("session:issue-69-maintained-p1")
const issue69DerivedWorktreeOperation = OperationId.make("disposition-cleanup:worktree:issue-69-maintained-p1:19")
const issue69DerivedBranchOperation = OperationId.make("disposition-cleanup:branch:issue-69-maintained-p1:28")
const issue69DerivedAbandonedWorktreeOperation = OperationId.make(
  "disposition-cleanup:worktree:issue-69-maintained-p1:9"
)
const issue69DerivedAbandonedBranchOperation = OperationId.make("disposition-cleanup:branch:issue-69-maintained-p1:20")
const issue69DerivedCandidateOperation = OperationId.make(
  "disposition-cleanup:integrator-candidate:session:issue-69-maintained-p1:13"
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

const expectedWorktreeObserve = (ordinal: number, operationId = issue69DerivedWorktreeOperation) =>
  DispositionCleanupBoundaryCall.cases.WorktreeObserve.make({
    locator: issue69P1Worktree,
    operationId,
    ordinal: CleanupObservationOrdinal.make(ordinal)
  })
const expectedWorktreeRemove = (ordinal: number, operationId = issue69DerivedWorktreeOperation) =>
  DispositionCleanupBoundaryCall.cases.WorktreeRemove.make({
    branch: issue69P1Branch,
    locator: issue69P1Worktree,
    operationId,
    ordinal: CleanupMutationOrdinal.make(ordinal)
  })
const expectedBranchObserve = (ordinal: number, operationId = issue69DerivedBranchOperation) =>
  DispositionCleanupBoundaryCall.cases.BranchObserve.make({
    branch: issue69P1Branch,
    operationId,
    ordinal: CleanupObservationOrdinal.make(ordinal)
  })
const expectedBranchRemove = (ordinal: number, operationId = issue69DerivedBranchOperation) =>
  DispositionCleanupBoundaryCall.cases.BranchRemove.make({
    branch: issue69P1Branch,
    operationId,
    ordinal: CleanupMutationOrdinal.make(ordinal)
  })
const expectedCandidateObserve = (ordinal: number) =>
  DispositionCleanupBoundaryCall.cases.CandidateObserve.make({
    locator: issue69P1Candidate,
    operationId: issue69DerivedCandidateOperation,
    ordinal: CleanupObservationOrdinal.make(ordinal),
    sessionId: issue69P1Session
  })
const expectedCandidateRemove = (ordinal: number) =>
  DispositionCleanupBoundaryCall.cases.CandidateRemove.make({
    locator: issue69P1Candidate,
    operationId: issue69DerivedCandidateOperation,
    ordinal: CleanupMutationOrdinal.make(ordinal),
    sessionId: issue69P1Session
  })

const issue69SecondObservationOrdinal = 2

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
      expectedWorktreeObserve(issue69SecondObservationOrdinal),
      expectedBranchObserve(1),
      expectedBranchRemove(1),
      expectedBranchObserve(issue69SecondObservationOrdinal)
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
      expectedWorktreeObserve(1, issue69DerivedAbandonedWorktreeOperation),
      expectedWorktreeRemove(1, issue69DerivedAbandonedWorktreeOperation),
      expectedWorktreeObserve(issue69SecondObservationOrdinal, issue69DerivedAbandonedWorktreeOperation),
      expectedBranchObserve(1, issue69DerivedAbandonedBranchOperation)
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
      expectedCandidateObserve(issue69SecondObservationOrdinal)
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

const issue69RunId = RunId.make("issue-69-maintained-cassette-run")
const issue69ShaLength = 40
const issue69EvidenceDigestLength = 64
const issue69QueuedAtPosition = 2
const issue69StartedAtPosition = 6
const issue69TargetLineagePosition = 4
const issue69SuccessorTargetLineagePosition = 12
const issue69SecondEvidenceRevision = 2
const issue69BaseSha = GitCommitSha.make("1".repeat(issue69ShaLength))
const issue69Attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("issue-69-maintained-p1"),
  baseSha: issue69BaseSha,
  branch: issue69P1Branch,
  executor: TaskExecutorLocator.make("executor:issue-69-maintained"),
  runId: issue69RunId,
  taskId: TaskId.make("issue-69-maintained-task"),
  taskRevision: TaskRevision.make("issue-69-maintained-revision"),
  worktree: issue69P1Worktree
})
const issue69Successor = PlannedTaskAttempt.make({
  ...issue69Attempt,
  attemptId: AttemptId.make("issue-69-maintained-p2"),
  branch: TaskBranchRef.make("refs/heads/task/issue-69-maintained-p2"),
  taskRevision: encodeTaskRevisionFingerprint(
    JSON.stringify({ body: "cleanup provenance witness", title: "cleanup provenance witness" })
  ),
  worktree: WorktreeLocator.make("/tmp/issue-69-maintained-p2")
})
const issue69IntegrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("repo:issue-69-maintained")
})
const issue69AcceptedResult = AcceptedResult.make({
  commit: issue69BaseSha,
  evidenceManifest: EvidenceReference.make({
    byteLength: 1,
    digest: EvidenceDigest.make("a".repeat(issue69EvidenceDigestLength))
  })
})
const issue69Predecessor = IntegratorSessionCorrelation.make({
  acceptedResult: issue69AcceptedResult,
  candidateResource: issue69P1Candidate,
  expectedTargetHead: issue69BaseSha,
  integrationTarget: issue69IntegrationTarget,
  plannedAttempt: issue69Attempt,
  queuedAt: JournalPosition.make(issue69QueuedAtPosition),
  sessionId: issue69P1Session,
  startedAt: JournalPosition.make(issue69StartedAtPosition),
  targetLineageObservedAt: JournalPosition.make(issue69TargetLineagePosition)
})
const issue69SuccessorSession = IntegratorSessionCorrelation.make({
  ...issue69Predecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-maintained-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-maintained-p2"),
  targetLineageObservedAt: JournalPosition.make(issue69SuccessorTargetLineagePosition)
})
const worktreePresent = WorktreeCleanupObservation.cases.Present.make({
  attemptId: issue69Attempt.attemptId,
  branch: issue69Attempt.branch,
  headSha: issue69BaseSha,
  locator: issue69Attempt.worktree,
  revision: WorktreeCleanupEvidenceRevision.make(1),
  writerQuiescent: true
})
const branchPresent = BranchCleanupObservation.cases.Present.make({
  branch: issue69Attempt.branch,
  headSha: issue69BaseSha,
  registeredWorktree: null,
  revision: BranchCleanupEvidenceRevision.make(1)
})
const candidatePresent = IntegratorCandidateCleanupObservation.cases.Present.make({
  locator: issue69Predecessor.candidateResource,
  revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  sessionId: issue69Predecessor.sessionId,
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
                locator: issue69Attempt.worktree,
                observedBranch: TaskBranchRef.make("refs/heads/other"),
                observedHead: issue69BaseSha,
                reason: "OtherBranch",
                revision: WorktreeCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
              })
            : Number(call.ordinal) === 1
              ? worktreePresent
              : WorktreeCleanupObservation.cases.Absent.make({
                  locator: issue69Attempt.worktree,
                  revision: WorktreeCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
                })
          : call._tag === "BranchObserve"
            ? cassette.scenario === "AbandonedWorktree"
              ? BranchCleanupObservation.cases.Unreadable.make({ branch: issue69P1Branch, detail: "script exhausted" })
              : Number(call.ordinal) === 1
                ? branchPresent
                : BranchCleanupObservation.cases.Absent.make({
                    branch: issue69P1Branch,
                    revision: BranchCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
                  })
            : call._tag === "CandidateObserve"
              ? Number(call.ordinal) === 1
                ? candidatePresent
                : IntegratorCandidateCleanupObservation.cases.Absent.make({
                    locator: issue69P1Candidate,
                    revision: IntegratorCandidateCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
                  })
              : null
      const result =
        call._tag === "WorktreeRemove"
          ? WorktreeCleanupMutationResult.cases.Removed.make({
              branch: issue69P1Branch,
              locator: issue69P1Worktree,
              revision: WorktreeCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
            })
          : call._tag === "BranchRemove"
            ? BranchCleanupMutationResult.cases.Removed.make({
                branch: issue69P1Branch,
                revision: BranchCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
              })
            : call._tag === "CandidateRemove"
              ? IntegratorCandidateCleanupMutationResult.cases.Removed.make({
                  locator: issue69P1Candidate,
                  revision: IntegratorCandidateCleanupEvidenceRevision.make(issue69SecondEvidenceRevision),
                  sessionId: issue69P1Session
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
                ? issue69P1Branch
                : null,
          call,
          evidenceRevision: isWorktree
            ? WorktreeCleanupEvidenceRevision.make(1)
            : isBranch
              ? BranchCleanupEvidenceRevision.make(1)
              : IntegratorCandidateCleanupEvidenceRevision.make(1),
          locator: isWorktree || isCandidate ? call.locator : null,
          observation,
          ownerAttemptId: isWorktree || isBranch ? issue69Attempt.attemptId : null,
          ownerBranch: isWorktree ? issue69P1Branch : null,
          ownerSessionId: isCandidate ? issue69P1Session : null,
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
export const DispositionCleanupCassetteRun = Schema.Struct({
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
export type DispositionCleanupCassetteRun = typeof DispositionCleanupCassetteRun.Type

const recordsAreUnchanged = (before: ReadonlyArray<JournalRecord>, after: ReadonlyArray<JournalRecord>): boolean =>
  JSON.stringify(upstreamRecords(before)) === JSON.stringify(upstreamRecords(after))

/** Runs one authored cleanup chronology through all applicable production protocol boundaries. */
export const runDispositionCleanupCassette = Effect.fn("DispositionCleanupCassette.run")(function* (
  cassette: DispositionCleanupCassette
) {
  const worktreeBoundaryInput =
    cassette.scenario === "SupersededWorktreeAndBranch" || cassette.scenario === "AbandonedWorktree"
      ? {
          observations: [
            worktreePresent,
            WorktreeCleanupObservation.cases.Absent.make({
              locator: issue69Attempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
            })
          ],
          mutations: [
            WorktreeCleanupMutationResult.cases.Removed.make({
              branch: issue69Attempt.branch,
              locator: issue69Attempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
            })
          ]
        }
      : cassette.scenario === "ChangedGitFactsPreserveResources"
        ? {
            observations: [
              WorktreeCleanupObservation.cases.Foreign.make({
                locator: issue69Attempt.worktree,
                observedBranch: TaskBranchRef.make("refs/heads/other"),
                observedHead: issue69BaseSha,
                reason: "OtherBranch",
                revision: WorktreeCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
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
              branch: issue69Attempt.branch,
              revision: BranchCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
            })
          ],
          mutations: [
            BranchCleanupMutationResult.cases.Removed.make({
              branch: issue69Attempt.branch,
              revision: BranchCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
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
              locator: issue69Predecessor.candidateResource,
              revision: IntegratorCandidateCleanupEvidenceRevision.make(issue69SecondEvidenceRevision)
            })
          ],
          mutations: [
            IntegratorCandidateCleanupMutationResult.cases.Removed.make({
              locator: issue69Predecessor.candidateResource,
              revision: IntegratorCandidateCleanupEvidenceRevision.make(issue69SecondEvidenceRevision),
              sessionId: issue69Predecessor.sessionId
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
      issue69RunId,
      FixtureTarget.make("issue-69-maintained-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    if (
      cassette.scenario === "SupersededWorktreeAndBranch" ||
      cassette.scenario === "ChangedGitFactsPreserveResources"
    ) {
      yield* appendReplacementProvenance(issue69Attempt, issue69Successor)
    } else if (cassette.scenario === "AbandonedWorktree") {
      yield* appendAbandonedProvenance(issue69Attempt, issue69AbandonedCleanupOperation)
    } else if (cassette.scenario === "FullRerunPredecessorCandidate") {
      yield* appendCandidateProvenance(issue69Predecessor, issue69SuccessorSession, "issue-69-maintained-full-rerun")
    } else {
      yield* appendCurrentQuarantineProvenance(issue69Predecessor)
    }
    const upstreamBeforeCleanup = yield* journal.read(issue69RunId)
    const loop = yield* runDispositionCleanupLoop(issue69RunId)
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
    const records = yield* journal.read(issue69RunId)
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
            return call.locator === issue69P1Worktree
          case "WorktreeRemove":
            return call.locator === issue69P1Worktree && call.branch === issue69P1Branch
          case "BranchObserve":
          case "BranchRemove":
            return call.branch === issue69P1Branch
          case "CandidateObserve":
          case "CandidateRemove":
            return false
        }
      }
      if (cassette.scenario === "AbandonedWorktree") {
        return call._tag === "WorktreeObserve" || call._tag === "WorktreeRemove"
          ? call.locator === issue69P1Worktree && call.operationId === issue69DerivedAbandonedWorktreeOperation
          : call._tag === "BranchObserve" &&
              call.branch === issue69P1Branch &&
              call.operationId === issue69DerivedAbandonedBranchOperation
      }
      if (cassette.scenario === "ChangedGitFactsPreserveResources") {
        return call._tag === "WorktreeObserve" && call.locator === issue69P1Worktree
      }
      if (cassette.scenario === "FullRerunPredecessorCandidate") {
        return (
          (call._tag === "CandidateObserve" || call._tag === "CandidateRemove") &&
          call.locator === issue69P1Candidate &&
          call.sessionId === issue69P1Session
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
                return call.locator === issue69P1Worktree
              case "WorktreeRemove":
                return call.locator === issue69P1Worktree && call.branch === issue69P1Branch
              case "BranchObserve":
              case "BranchRemove":
                return call.branch === issue69P1Branch
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
                  call.locator === issue69P1Worktree &&
                  call.operationId === issue69DerivedAbandonedWorktreeOperation) ||
                (call._tag === "BranchObserve" &&
                  call.branch === issue69P1Branch &&
                  call.operationId === issue69DerivedAbandonedBranchOperation)
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
            ? boundaryCalls.every((call) => call._tag === "WorktreeObserve" && call.locator === issue69P1Worktree) &&
              records.some(({ event }) => event._tag === "WorktreeCleanupContradicted")
            : cassette.scenario === "FullRerunPredecessorCandidate"
              ? boundaryCalls.every(
                  (call) =>
                    (call._tag === "CandidateObserve" || call._tag === "CandidateRemove") &&
                    call.locator === issue69P1Candidate &&
                    call.sessionId === issue69P1Session
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
  }).pipe(Effect.provide(layers))
})
