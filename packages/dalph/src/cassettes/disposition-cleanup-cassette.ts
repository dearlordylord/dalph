/* eslint-disable max-lines -- The maintained cleanup cassette keeps all three family stories and their exact boundary scripts together. */

import { Effect, Layer, Schema } from "effect"
import {
  AttemptId,
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
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
  BranchCleanupEvidenceRevision,
  BranchCleanupMutationResult,
  BranchCleanupObservation,
  BranchCleanupOwner,
  FixtureTarget,
  InitialControlPolicy,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateCleanupOwner,
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalPosition,
  JournalRecord,
  JournalStore,
  OperationId,
  PlannedAttemptCleanupDisposition,
  TaskWorkCapacity,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation,
  WorktreeCleanupOwner,
  appendCandidateProvenance,
  appendReplacementProvenance,
  branchCleanupTestLayer,
  integratorCandidateCleanupTestLayer,
  memoryJournalTestLayer,
  runBranchCleanup,
  runIntegratorCandidateCleanup,
  runWorktreeCleanup,
  replacementPredecessorsFor,
  TestBranchCleanupBoundary,
  TestIntegratorCandidateCleanupBoundary,
  TestWorktreeCleanupBoundary,
  worktreeCleanupTestLayer
} from "@dalph/orchestrator"

/** Maintained chronological cleanup story, independent for each authority family. */
export const DispositionCleanupCassette = Schema.Struct({
  actor: Schema.Literal("Alice"),
  expectedBoundaryCalls: Schema.Array(Schema.String),
  forbiddenResult: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  scenario: Schema.Literals([
    "SupersededWorktreeAndBranch",
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
      "observe worktree W1",
      "remove worktree W1",
      "observe worktree W1",
      "observe branch B1",
      "remove branch B1",
      "observe branch B1"
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
  changedGitFactsPreserveResources: DispositionCleanupCassette.make({
    actor: "Alice",
    expectedBoundaryCalls: ["observe worktree W1"],
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
    expectedBoundaryCalls: ["observe C1", "remove C1", "observe C1"],
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

/** Observable result of one maintained cleanup cassette after its production loop. */
export const DispositionCleanupCassetteRun = Schema.Struct({
  boundaryCalls: Schema.Array(Schema.String),
  journalTags: Schema.Array(Schema.String),
  records: Schema.Array(JournalRecord),
  scenario: Schema.Literals([
    "SupersededWorktreeAndBranch",
    "ChangedGitFactsPreserveResources",
    "FullRerunPredecessorCandidate",
    "CurrentQuarantinePreserved"
  ]),
  terminalResult: Schema.NonEmptyString,
  version: Schema.Literal(1)
})
export type DispositionCleanupCassetteRun = typeof DispositionCleanupCassetteRun.Type

const issue69RunId = RunId.make("issue-69-maintained-cassette-run")
const issue69ShaLength = 40
const issue69EvidenceDigestLength = 64
const issue69DispositionPosition = 3
const issue69CandidateDispositionPosition = 9
const issue69AuthorityObservationPosition = 3
const issue69DirectionPosition = 10
const issue69CandidateObservationPosition = 14
const issue69QueuedAtPosition = 2
const issue69StartedAtPosition = 6
const issue69TargetLineagePosition = 4
const issue69SuccessorTargetLineagePosition = 12
const issue69SecondEvidenceRevision = 2
const issue69BaseSha = GitCommitSha.make("1".repeat(issue69ShaLength))
const issue69Attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("issue-69-maintained-p1"),
  baseSha: issue69BaseSha,
  branch: TaskBranchRef.make("refs/heads/task/issue-69-maintained-p1"),
  executor: TaskExecutorLocator.make("executor:issue-69-maintained"),
  runId: issue69RunId,
  taskId: TaskId.make("issue-69-maintained-task"),
  taskRevision: TaskRevision.make("issue-69-maintained-revision"),
  worktree: WorktreeLocator.make("/tmp/issue-69-maintained-p1")
})
const issue69Successor = PlannedTaskAttempt.make({
  ...issue69Attempt,
  attemptId: AttemptId.make("issue-69-maintained-p2"),
  branch: TaskBranchRef.make("refs/heads/task/issue-69-maintained-p2"),
  taskRevision: TaskRevision.make("issue-69-maintained-revision:successor"),
  worktree: WorktreeLocator.make("/tmp/issue-69-maintained-p2")
})
const issue69PlannedDisposition = PlannedAttemptCleanupDisposition.cases.Superseded.make({
  dispositionAt: JournalPosition.make(issue69DispositionPosition),
  plannedAttempt: issue69Attempt,
  successorAttempt: issue69Successor
})
const issue69WorktreeAuthorization = WorktreeCleanupAuthorization.make({
  causalPredecessors: replacementPredecessorsFor(issue69Attempt),
  disposition: issue69PlannedDisposition,
  evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
  expectedHead: issue69BaseSha,
  locator: issue69Attempt.worktree,
  observationAt: JournalPosition.make(issue69AuthorityObservationPosition),
  observationOperationId: OperationId.make("issue-69-maintained-worktree-read"),
  operationId: OperationId.make("issue-69-maintained-worktree-cleanup"),
  owner: WorktreeCleanupOwner.make({ attemptId: issue69Attempt.attemptId, branch: issue69Attempt.branch }),
  writerQuiescent: true
})
const issue69BranchAuthorization = BranchCleanupAuthorization.make({
  causalPredecessors: [issue69WorktreeAuthorization.operationId, ...replacementPredecessorsFor(issue69Attempt)],
  disposition: issue69PlannedDisposition,
  evidenceRevision: BranchCleanupEvidenceRevision.make(1),
  expectedHead: issue69BaseSha,
  locator: issue69Attempt.branch,
  observationAt: JournalPosition.make(issue69AuthorityObservationPosition),
  observationOperationId: OperationId.make("issue-69-maintained-branch-read"),
  operationId: OperationId.make("issue-69-maintained-branch-cleanup"),
  owner: BranchCleanupOwner.make({ attemptId: issue69Attempt.attemptId }),
  worktreeCleanupOperationId: issue69WorktreeAuthorization.operationId,
  writerQuiescent: true
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
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-maintained-p1"),
  expectedTargetHead: issue69BaseSha,
  integrationTarget: issue69IntegrationTarget,
  plannedAttempt: issue69Attempt,
  queuedAt: JournalPosition.make(issue69QueuedAtPosition),
  sessionId: IntegratorSessionId.make("session:issue-69-maintained-p1"),
  startedAt: JournalPosition.make(issue69StartedAtPosition),
  targetLineageObservedAt: JournalPosition.make(issue69TargetLineagePosition)
})
const issue69SuccessorSession = IntegratorSessionCorrelation.make({
  ...issue69Predecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-maintained-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-maintained-p2"),
  targetLineageObservedAt: JournalPosition.make(issue69SuccessorTargetLineagePosition)
})
const issue69CandidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-maintained-full-rerun")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(issue69DirectionPosition),
    dispositionAt: JournalPosition.make(issue69CandidateDispositionPosition),
    predecessor: issue69Predecessor,
    successor: issue69SuccessorSession
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: issue69Predecessor.candidateResource,
  observationAt: JournalPosition.make(issue69CandidateObservationPosition),
  observationOperationId: OperationId.make("issue-69-maintained-candidate-read"),
  operationId: OperationId.make("issue-69-maintained-candidate-cleanup"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: issue69Predecessor.sessionId }),
  writerQuiescent: true
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

const boundaryCallsFor = (calls: ReadonlyArray<{ readonly _tag: "Observe" | "Remove" }>, resource: string) =>
  calls.map((call) => `${call._tag === "Observe" ? "observe" : "remove"} ${resource}`)

/** Runs one authored cleanup chronology through all applicable production protocol boundaries. */
export const runDispositionCleanupCassette = Effect.fn("DispositionCleanupCassette.run")(function* (
  cassette: DispositionCleanupCassette
) {
  const worktreeBoundaryInput =
    cassette.scenario === "SupersededWorktreeAndBranch"
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
    }
    let terminalResult: string
    if (cassette.scenario === "SupersededWorktreeAndBranch") {
      const worktree = yield* runWorktreeCleanup(issue69WorktreeAuthorization)
      const branch = yield* runBranchCleanup(issue69BranchAuthorization)
      if (worktree._tag !== "Settled" || branch._tag !== "Settled") {
        return yield* Effect.die("superseded cleanup cassette did not settle both exact resources")
      }
      terminalResult = "P1 worktree and branch settled; P2 remains live"
    } else if (cassette.scenario === "ChangedGitFactsPreserveResources") {
      const worktree = yield* runWorktreeCleanup(issue69WorktreeAuthorization)
      if (worktree._tag !== "Preserved") return yield* Effect.die("changed-facts cassette did not preserve W1")
      terminalResult = "Preserved with a typed contradiction"
    } else if (cassette.scenario === "FullRerunPredecessorCandidate") {
      yield* appendCandidateProvenance(issue69Predecessor, issue69SuccessorSession, "issue-69-maintained-full-rerun")
      const candidate = yield* runIntegratorCandidateCleanup(issue69CandidateAuthorization)
      if (candidate._tag !== "Settled") return yield* Effect.die("FullRerun cassette did not settle predecessor C1")
      terminalResult = "C1 settled; S1 history and C2 preserved"
    } else {
      terminalResult = "No cleanup responsibility"
    }
    const records = yield* journal.read(issue69RunId)
    const worktreeCalls = yield* (yield* TestWorktreeCleanupBoundary).calls()
    const branchCalls = yield* (yield* TestBranchCleanupBoundary).calls()
    const candidateCalls = yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()
    const boundaryCalls = [
      ...boundaryCallsFor(worktreeCalls, "worktree W1"),
      ...boundaryCallsFor(branchCalls, "branch B1"),
      ...boundaryCallsFor(candidateCalls, "C1")
    ]
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
    return DispositionCleanupCassetteRun.make({
      boundaryCalls,
      journalTags: records.map(({ event }) => event._tag),
      records,
      scenario: cassette.scenario,
      terminalResult,
      version: 1
    })
  }).pipe(Effect.provide(layers))
})
