import {
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  PlannedTaskAttempt,
  type GitCommitSha
} from "@dalph/contracts"
import {
  IntegratorGitObservation,
  JournalPosition,
  StartedIntegrationResponsibility,
  TargetLineageObservation,
  type IntegratorCandidateText
} from "@dalph/orchestrator"
import {
  AuthoredIntegratorCassette,
  AuthoredIntegratorGitResult,
  AuthoredIntegratorResult,
  AuthoredIntegratorStoryItem,
  IntegratorCassetteTerminalExpectation,
  RecordedIntegratorOutcome,
  maintainedIntegratorFixture,
  type AuthoredIntegratorStartingFacts,
  type IntegratorCassetteTerminalExpectation as IntegratorCassetteTerminalExpectationType
} from "./integrator-cassette-domain.js"

const initialResponsibilityPosition = 1
const initialStartedPosition = 2
const initialLineagePosition = 4
const processLostIntegratorCallCount = 2
const oneGitCall = 1
const evidenceDigestHexLength = 64
const sessionIdPrefix = "integrator-session:"
const candidateResourcePrefix = "integrator-resource:"
const journalTagsBeforeIntegrator = [
  "IntegrationResponsibilityBegan",
  "IntegrationStarted",
  "GitReadIntentRecorded",
  "TargetLineageObserved"
]
const journalTagsAfterPreparedCandidate = [
  ...journalTagsBeforeIntegrator,
  "IntegratorSessionFixed",
  "IntegratorResultRecorded",
  "IntegratorCandidateGitReadIntended",
  "IntegratorCandidateGitObserved"
]
const journalTagsAfterNotPrepared = [
  ...journalTagsBeforeIntegrator,
  "IntegratorSessionFixed",
  "IntegratorResultRecorded"
]

const acceptedResultFor = (commit: GitCommitSha): AcceptedResult =>
  AcceptedResult.make({
    commit,
    evidenceManifest: EvidenceReference.make({
      byteLength: 1,
      digest: EvidenceDigest.make("a".repeat(evidenceDigestHexLength))
    })
  })

const responsibilityFor = () =>
  (() => {
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: maintainedIntegratorFixture.attemptId,
      baseSha: maintainedIntegratorFixture.baseCommit,
      branch: maintainedIntegratorFixture.branch,
      executor: maintainedIntegratorFixture.executor,
      runId: maintainedIntegratorFixture.runId,
      taskId: maintainedIntegratorFixture.taskId,
      taskRevision: maintainedIntegratorFixture.taskRevision,
      worktree: maintainedIntegratorFixture.worktree
    })
    return {
      responsibility: StartedIntegrationResponsibility.make({
        acceptedResult: acceptedResultFor(maintainedIntegratorFixture.acceptedCommit),
        integrationTarget: maintainedIntegratorFixture.integrationTarget,
        plannedAttempt,
        queuedAt: JournalPosition.make(initialResponsibilityPosition),
        startedAt: JournalPosition.make(initialStartedPosition)
      }),
      targetLineage: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: maintainedIntegratorFixture.baseCommit,
        targetHeadSha: maintainedIntegratorFixture.targetHead
      }),
      targetLineageObservedAt: JournalPosition.make(initialLineagePosition)
    }
  })()

const compatibleStartingFacts: () => AuthoredIntegratorStartingFacts = responsibilityFor

const incompatibleStartingFacts = (): AuthoredIntegratorStartingFacts => {
  const facts = compatibleStartingFacts()
  return {
    ...facts,
    targetLineage: TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: false,
      plannedBaseSha: maintainedIntegratorFixture.baseCommit,
      targetHeadSha: maintainedIntegratorFixture.targetHead
    })
  }
}

const preparedResult = (): AuthoredIntegratorResult =>
  AuthoredIntegratorResult.cases.PreparedCandidate.make({ candidateText: maintainedIntegratorFixture.candidateText })

const notPreparedResult = (): AuthoredIntegratorResult =>
  AuthoredIntegratorResult.cases.NotPrepared.make({ detail: maintainedIntegratorFixture.notPreparedDetail })

const processLostResult = (detail: string): AuthoredIntegratorResult =>
  AuthoredIntegratorResult.cases.ProcessLost.make({ detail })

const exactCommitResult = (): AuthoredIntegratorGitResult =>
  AuthoredIntegratorGitResult.cases.Commit.make({
    candidateText: maintainedIntegratorFixture.candidateText,
    commit: maintainedIntegratorFixture.candidateCommit,
    directParents: [maintainedIntegratorFixture.targetHead, maintainedIntegratorFixture.acceptedCommit]
  })

const invalidObjectResult = (): AuthoredIntegratorGitResult =>
  AuthoredIntegratorGitResult.cases.NonCommit.make({
    candidateText: maintainedIntegratorFixture.candidateText,
    objectType: "tree"
  })

const expectedPreparedOutcome = () =>
  RecordedIntegratorOutcome.cases.PreparedCandidate.make({
    candidateCommit: maintainedIntegratorFixture.candidateCommit,
    candidateText: maintainedIntegratorFixture.candidateText,
    directParents: [maintainedIntegratorFixture.targetHead, maintainedIntegratorFixture.acceptedCommit]
  })

const expectedNotPreparedOutcome = () =>
  RecordedIntegratorOutcome.cases.NotPrepared.make({ detail: maintainedIntegratorFixture.notPreparedDetail })

const expectedRejectedOutcome = () =>
  RecordedIntegratorOutcome.cases.CandidateRejected.make({
    candidateText: maintainedIntegratorFixture.candidateText,
    observation: IntegratorGitObservation.cases.NonCommit.make({
      candidateText: maintainedIntegratorFixture.candidateText,
      objectType: "tree"
    })
  })

const expectedFailureOutcome = (tag: string) => RecordedIntegratorOutcome.cases.Failure.make({ tag })

const terminalExpectationFor = (
  stateTag: IntegratorCassetteTerminalExpectationType["stateTag"],
  outcomes: ReadonlyArray<RecordedIntegratorOutcome>,
  integratorCalls: number,
  gitCalls: number,
  journalTags: ReadonlyArray<string>,
  recordedTags: ReadonlyArray<string>,
  sessionIdPrefixes: ReadonlyArray<string>,
  candidateResourcePrefixes: ReadonlyArray<string>,
  gitCandidates: ReadonlyArray<IntegratorCandidateText>
) =>
  IntegratorCassetteTerminalExpectation.make({
    candidateResourcePrefixes,
    gitCandidates,
    gitCalls,
    integratorCalls,
    journalTags,
    outcomes,
    recordedTags,
    sessionIdPrefixes,
    stateTag
  })

const exactExpectation = (outcomes: ReadonlyArray<RecordedIntegratorOutcome>, integratorCalls = oneGitCall) =>
  terminalExpectationFor(
    "GitQualifiedPrepared",
    outcomes,
    integratorCalls,
    oneGitCall,
    journalTagsAfterPreparedCandidate,
    journalTagsAfterPreparedCandidate,
    Array.from({ length: integratorCalls }, () => sessionIdPrefix),
    Array.from({ length: integratorCalls }, () => candidateResourcePrefix),
    [maintainedIntegratorFixture.candidateText]
  )

const notPreparedExpectation = terminalExpectationFor(
  "NotPrepared",
  [expectedNotPreparedOutcome()],
  oneGitCall,
  0,
  journalTagsAfterNotPrepared,
  journalTagsAfterNotPrepared,
  [sessionIdPrefix],
  [candidateResourcePrefix],
  []
)

const incompatibleExpectation = terminalExpectationFor(
  "Absent",
  [expectedFailureOutcome("IntegratorTargetLineageIncompatible")],
  0,
  0,
  journalTagsBeforeIntegrator,
  journalTagsBeforeIntegrator,
  [],
  [],
  []
)

const invalidObjectExpectation = terminalExpectationFor(
  "CandidateRejected",
  [expectedRejectedOutcome()],
  oneGitCall,
  oneGitCall,
  journalTagsAfterPreparedCandidate,
  journalTagsAfterPreparedCandidate,
  [sessionIdPrefix],
  [candidateResourcePrefix],
  [maintainedIntegratorFixture.candidateText]
)

/** One exact S/W/H/C request reaches reported M and Git's ordered [H,C] proof. */
export const givesOneExactSessionToTheIntegratorAndQualifiesItsReportedCandidate = AuthoredIntegratorCassette.make({
  integratorResults: [preparedResult()],
  name: "gives one exact session to the Integrator and qualifies its reported candidate",
  startingFacts: compatibleStartingFacts(),
  story: [
    AuthoredIntegratorStoryItem.cases.Invoke.make({}),
    AuthoredIntegratorStoryItem.cases.Assert.make({ expected: exactExpectation([expectedPreparedOutcome()]) })
  ],
  gitResults: [exactCommitResult()]
})

/** A process loss leaves S unfinished; restart invokes the same fixed S/W and not a successor. */
export const restoresTheSameUnfinishedIntegratorSessionAfterProcessLoss = AuthoredIntegratorCassette.make({
  integratorResults: [processLostResult("process lost before the outer result"), preparedResult()],
  name: "restores the same unfinished Integrator session after process loss",
  startingFacts: compatibleStartingFacts(),
  story: [
    AuthoredIntegratorStoryItem.cases.Invoke.make({}),
    AuthoredIntegratorStoryItem.cases.Restart.make({}),
    AuthoredIntegratorStoryItem.cases.Assert.make({
      expected: exactExpectation(
        [expectedFailureOutcome("IntegratorCallFailure"), expectedPreparedOutcome()],
        processLostIntegratorCallCount
      )
    })
  ],
  gitResults: [exactCommitResult()]
})

/** An incompatible H/lineage observation stops before allocating S or calling the Integrator. */
export const stopsBeforeTheIntegratorWhenGitCannotProveCompatibleTargetLineage = AuthoredIntegratorCassette.make({
  integratorResults: [],
  name: "stops before the Integrator when Git cannot prove compatible target lineage",
  startingFacts: incompatibleStartingFacts(),
  story: [
    AuthoredIntegratorStoryItem.cases.Invoke.make({}),
    AuthoredIntegratorStoryItem.cases.Assert.make({ expected: incompatibleExpectation })
  ],
  gitResults: []
})

/** NotPrepared is a conclusive public result and does not trigger a Git read. */
export const retainsConclusiveNotPreparedWithoutInferringAResourceHead = AuthoredIntegratorCassette.make({
  integratorResults: [notPreparedResult()],
  name: "retains conclusive NotPrepared without inferring a resource head",
  startingFacts: compatibleStartingFacts(),
  story: [
    AuthoredIntegratorStoryItem.cases.Invoke.make({}),
    AuthoredIntegratorStoryItem.cases.Assert.make({ expected: notPreparedExpectation })
  ],
  // Deliberately include an unused Git fact: NotPrepared never asks Git for M.
  gitResults: [exactCommitResult()]
})

/** A reported non-commit remains an explicit rejection rather than a prepared candidate. */
export const rejectsAnInvalidReportedGitObject = AuthoredIntegratorCassette.make({
  integratorResults: [preparedResult()],
  name: "rejects an invalid reported Git object",
  startingFacts: compatibleStartingFacts(),
  story: [
    AuthoredIntegratorStoryItem.cases.Invoke.make({}),
    AuthoredIntegratorStoryItem.cases.Assert.make({ expected: invalidObjectExpectation })
  ],
  gitResults: [invalidObjectResult()]
})

/** The maintained focused catalog is separate from the legacy candidate/verification catalog. */
export const maintainedIntegratorCassetteCatalog = {
  exactCandidate: givesOneExactSessionToTheIntegratorAndQualifiesItsReportedCandidate,
  incompatibleLineage: stopsBeforeTheIntegratorWhenGitCannotProveCompatibleTargetLineage,
  invalidReportedObject: rejectsAnInvalidReportedGitObject,
  notPrepared: retainsConclusiveNotPreparedWithoutInferringAResourceHead,
  processLoss: restoresTheSameUnfinishedIntegratorSessionAfterProcessLoss
} as const
