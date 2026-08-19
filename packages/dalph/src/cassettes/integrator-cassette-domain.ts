import { Schema } from "effect"
import {
  AcceptedResult,
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
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  IntegratorResult,
  IntegratorRunCorrelation,
  JournalPosition,
  JournalRecord,
  OperationId,
  StartedIntegrationResponsibility,
  TargetLineageObservation,
  WorkflowOperation,
  type IntegratorPreparationInput,
  type IntegratorRunProtocolResult,
  type IntegratorRequest,
  type JournalRecord as JournalRecordType
} from "@dalph/orchestrator"

const gitCommitHexLength = 40

/** The one public outer result a maintained cassette may script. */
export const AuthoredIntegratorResult = Schema.TaggedUnion({
  NotPrepared: { detail: IntegratorNotPreparedDetail },
  PreparedCandidate: { candidateText: IntegratorCandidateText },
  ProcessLost: { detail: Schema.String }
})
export type AuthoredIntegratorResult = typeof AuthoredIntegratorResult.Type

/** Git returns facts about the explicitly reported candidate text, never a resource HEAD. */
export const AuthoredIntegratorGitResult = Schema.TaggedUnion({
  Commit: { candidateText: IntegratorCandidateText, commit: GitCommitSha, directParents: Schema.Array(GitCommitSha) },
  Missing: { candidateText: IntegratorCandidateText },
  NonCommit: { candidateText: IntegratorCandidateText, objectType: Schema.NonEmptyString },
  ReadLost: { detail: Schema.String }
})
export type AuthoredIntegratorGitResult = typeof AuthoredIntegratorGitResult.Type

/** A maintained story can only invoke or restart the one outer Integrator, then assert its result. */
export const AuthoredIntegratorStoryItem = Schema.TaggedUnion({
  Assert: { expected: Schema.suspend(() => IntegratorCassetteTerminalExpectation) },
  Invoke: {},
  Restart: {}
})
export type AuthoredIntegratorStoryItem = typeof AuthoredIntegratorStoryItem.Type

/** Exact responsibility, Git H observation, and journal position supplied to one cassette run. */
export const AuthoredIntegratorStartingFacts = Schema.Struct({
  responsibility: StartedIntegrationResponsibility,
  targetLineage: TargetLineageObservation,
  targetLineageObservedAt: JournalPosition
})
export type AuthoredIntegratorStartingFacts = typeof AuthoredIntegratorStartingFacts.Type

/** A normalized public observation used by terminal cassette assertions. */
export const RecordedIntegratorOutcome = Schema.TaggedUnion({
  CandidateRejected: { candidateText: IntegratorCandidateText, observation: IntegratorGitObservation },
  Failure: { tag: Schema.String },
  NotPrepared: { detail: IntegratorNotPreparedDetail },
  PreparedCandidate: {
    candidateCommit: GitCommitSha,
    candidateText: IntegratorCandidateText,
    directParents: Schema.Tuple([GitCommitSha, GitCommitSha])
  }
})
export type RecordedIntegratorOutcome = typeof RecordedIntegratorOutcome.Type

/** Every durable event retained by the focused recorded Integrator cassette. */
export const RecordedIntegratorCassetteEntry = Schema.TaggedUnion({
  GitReadIntentRecorded: {
    operation: Schema.suspend(() => WorkflowOperation),
    position: JournalPosition,
    runId: RunId
  },
  IntegrationResponsibilityBegan: {
    acceptedResult: AcceptedResult,
    integrationTarget: IntegrationTarget,
    plannedAttempt: PlannedTaskAttempt,
    position: JournalPosition,
    runId: RunId
  },
  IntegrationStarted: {
    acceptedResult: AcceptedResult,
    integrationTarget: IntegrationTarget,
    plannedAttempt: PlannedTaskAttempt,
    position: JournalPosition,
    responsibilityBeganAt: JournalPosition,
    runId: RunId
  },
  IntegratorRunCandidateGitObserved: {
    candidateText: IntegratorCandidateText,
    observation: IntegratorGitObservation,
    position: JournalPosition,
    run: IntegratorRunCorrelation,
    runId: RunId
  },
  IntegratorRunCandidateGitReadIntended: {
    candidateText: IntegratorCandidateText,
    position: JournalPosition,
    run: IntegratorRunCorrelation,
    runId: RunId
  },
  IntegratorRunResultRecorded: {
    position: JournalPosition,
    result: Schema.suspend(() => IntegratorResult),
    run: IntegratorRunCorrelation,
    runId: RunId
  },
  IntegratorSessionFixed: {
    correlation: Schema.suspend(() => IntegratorSessionCorrelation),
    position: JournalPosition,
    runId: RunId
  },
  IntegratorRunStarted: { position: JournalPosition, run: IntegratorRunCorrelation, runId: RunId },
  TargetLineageObserved: {
    observation: TargetLineageObservation,
    operationId: OperationId,
    plannedAttempt: PlannedTaskAttempt,
    position: JournalPosition,
    runId: RunId
  }
})
export type RecordedIntegratorCassetteEntry = typeof RecordedIntegratorCassetteEntry.Type

/** The authored cassette is intentionally closed over outer Integrator and Git facts only. */
export const AuthoredIntegratorCassette = Schema.Struct({
  integratorResults: Schema.Array(AuthoredIntegratorResult),
  name: Schema.NonEmptyString,
  startingFacts: AuthoredIntegratorStartingFacts,
  story: Schema.Array(AuthoredIntegratorStoryItem),
  gitResults: Schema.Array(AuthoredIntegratorGitResult)
})
export type AuthoredIntegratorCassette = typeof AuthoredIntegratorCassette.Type

/** The versioned recorded projection contains no Integrator-private stage or target-verification item. */
export const RecordedIntegratorCassette = Schema.Struct({
  entries: Schema.Array(RecordedIntegratorCassetteEntry),
  name: Schema.NonEmptyString
})
export type RecordedIntegratorCassette = typeof RecordedIntegratorCassette.Type

/** The exact terminal assertion a maintained cassette makes after all story calls. */
export const IntegratorCassetteTerminalExpectation = Schema.Struct({
  candidateResourcePrefixes: Schema.Array(Schema.NonEmptyString),
  gitCandidates: Schema.Array(IntegratorCandidateText),
  gitCalls: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  integratorCalls: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  journalTags: Schema.Array(Schema.String),
  outcomes: Schema.Array(RecordedIntegratorOutcome),
  recordedTags: Schema.Array(Schema.String),
  sessionIdPrefixes: Schema.Array(Schema.NonEmptyString),
  stateTag: Schema.Literals([
    "Absent",
    "CandidateRejected",
    "Contradiction",
    "GitQualifiedPrepared",
    "NotPrepared",
    "PreparedAwaitingGit",
    "RunUnfinished"
  ])
})
export type IntegratorCassetteTerminalExpectation = typeof IntegratorCassetteTerminalExpectation.Type

/** Run-bound reconstruction retains the exact ordinal and session instead of collapsing to session-only state. */
const RecordedIntegratorRunState = Schema.TaggedUnion({
  Absent: { run: IntegratorRunCorrelation },
  CandidateRejected: {
    candidateText: IntegratorCandidateText,
    observation: IntegratorGitObservation,
    run: IntegratorRunCorrelation
  },
  Contradiction: { detail: Schema.String },
  GitQualifiedPrepared: {
    candidateCommit: GitCommitSha,
    candidateText: IntegratorCandidateText,
    observation: Schema.Struct({ directParents: Schema.Tuple([GitCommitSha, GitCommitSha]) }),
    qualifiedAt: JournalPosition,
    run: IntegratorRunCorrelation
  },
  NotPrepared: { detail: IntegratorNotPreparedDetail, run: IntegratorRunCorrelation },
  PreparedAwaitingGit: { candidateText: IntegratorCandidateText, run: IntegratorRunCorrelation },
  RunUnfinished: { run: IntegratorRunCorrelation }
})
const RecordedIntegratorState = RecordedIntegratorRunState

/** A run result keeps authored input and recorded output together for cassette review. */
export const IntegratorCassetteRun = Schema.Struct({
  cassette: AuthoredIntegratorCassette,
  gitCandidates: Schema.Array(IntegratorCandidateText),
  gitCalls: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  integratorCalls: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  journalTags: Schema.Array(Schema.String),
  outcomes: Schema.Array(RecordedIntegratorOutcome),
  records: Schema.Array(JournalRecord),
  recorded: RecordedIntegratorCassette,
  state: RecordedIntegratorState,
  sessionIds: Schema.Array(IntegratorSessionId),
  candidateResources: Schema.Array(IntegratorCandidateResourceLocator)
})
export type IntegratorCassetteRun = typeof IntegratorCassetteRun.Type

const recordedDeliveryEntryFor = (record: JournalRecordType): RecordedIntegratorCassetteEntry | undefined => {
  const { event } = record
  if (event._tag === "IntegrationResponsibilityBegan") {
    return RecordedIntegratorCassetteEntry.cases.IntegrationResponsibilityBegan.make({
      acceptedResult: event.acceptedResult,
      integrationTarget: event.integrationTarget,
      plannedAttempt: event.plannedAttempt,
      position: record.position,
      runId: record.runId
    })
  }
  if (event._tag === "GitReadIntentRecorded") {
    return RecordedIntegratorCassetteEntry.cases.GitReadIntentRecorded.make({
      operation: event.operation,
      position: record.position,
      runId: record.runId
    })
  }
  if (event._tag === "IntegrationStarted") {
    return RecordedIntegratorCassetteEntry.cases.IntegrationStarted.make({
      acceptedResult: event.acceptedResult,
      integrationTarget: event.integrationTarget,
      plannedAttempt: event.plannedAttempt,
      position: record.position,
      responsibilityBeganAt: event.responsibilityBeganAt,
      runId: record.runId
    })
  }
  if (event._tag === "TargetLineageObserved") {
    return RecordedIntegratorCassetteEntry.cases.TargetLineageObserved.make({
      observation: event.observation,
      operationId: event.operationId,
      plannedAttempt: event.plannedAttempt,
      position: record.position,
      runId: record.runId
    })
  }
  return undefined
}

const recordedOuterIntegratorEntryFor = (record: JournalRecordType): RecordedIntegratorCassetteEntry | undefined => {
  const { event } = record
  if (event._tag === "IntegratorSessionFixed") {
    return RecordedIntegratorCassetteEntry.cases.IntegratorSessionFixed.make({
      correlation: event.correlation,
      position: record.position,
      runId: record.runId
    })
  }
  if (event._tag === "IntegratorRunStarted") {
    return RecordedIntegratorCassetteEntry.cases.IntegratorRunStarted.make({
      position: record.position,
      run: event.run,
      runId: record.runId
    })
  }
  if (event._tag === "IntegratorRunResultRecorded") {
    return RecordedIntegratorCassetteEntry.cases.IntegratorRunResultRecorded.make({
      position: record.position,
      result: event.result,
      run: event.run,
      runId: record.runId
    })
  }
  if (event._tag === "IntegratorRunCandidateGitReadIntended") {
    return RecordedIntegratorCassetteEntry.cases.IntegratorRunCandidateGitReadIntended.make({
      candidateText: event.candidateText,
      position: record.position,
      run: event.run,
      runId: record.runId
    })
  }
  if (event._tag === "IntegratorRunCandidateGitObserved") {
    return RecordedIntegratorCassetteEntry.cases.IntegratorRunCandidateGitObserved.make({
      candidateText: event.candidateText,
      observation: event.observation,
      position: record.position,
      run: event.run,
      runId: record.runId
    })
  }
  return undefined
}

const recordedEntryFor = (record: JournalRecordType): RecordedIntegratorCassetteEntry | undefined =>
  recordedDeliveryEntryFor(record) ?? recordedOuterIntegratorEntryFor(record)

/** Projects the real journal prefix into the small maintained recorded vocabulary. */
export const recordedIntegratorCassetteFor = (
  name: string,
  records: ReadonlyArray<JournalRecordType>
): RecordedIntegratorCassette =>
  RecordedIntegratorCassette.make({
    entries: records.flatMap((record) => {
      const entry = recordedEntryFor(record)
      return entry === undefined ? [] : [entry]
    }),
    name
  })

/** The production boundary receives exactly the responsibility and fixed H that the story authors. */
export const integratorPreparationInputFor = (
  startingFacts: AuthoredIntegratorStartingFacts
): IntegratorPreparationInput => ({
  responsibility: startingFacts.responsibility,
  targetLineage: startingFacts.targetLineage,
  targetLineageObservedAt: startingFacts.targetLineageObservedAt
})

/** Fixture identities are shared by each maintained story, so the request remains visibly S/W/H/C exact. */
export const maintainedIntegratorFixture = {
  acceptedCommit: GitCommitSha.make("c".repeat(gitCommitHexLength)),
  baseCommit: GitCommitSha.make("a".repeat(gitCommitHexLength)),
  branch: TaskBranchRef.make("refs/heads/dalph/integrator-maintained"),
  changedTargetHead: GitCommitSha.make("e".repeat(gitCommitHexLength)),
  candidateCommit: GitCommitSha.make("d".repeat(gitCommitHexLength)),
  candidateText: IntegratorCandidateText.make("M-reported-by-integrator"),
  executor: TaskExecutorLocator.make("executor:integrator-maintained"),
  integrationTarget: IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/integrator-maintained.git")
  }),
  notPreparedDetail: IntegratorNotPreparedDetail.make("integrator reached a conclusive non-prepared outcome"),
  repository: GitRepositoryLocator.make("/repositories/integrator-maintained.git"),
  runId: RunId.make("integrator-maintained-run"),
  targetHead: GitCommitSha.make("b".repeat(gitCommitHexLength)),
  taskId: TaskId.make("integrator-maintained-task"),
  taskRevision: TaskRevision.make("integrator-maintained-revision"),
  attemptId: AttemptId.make("integrator-maintained-attempt"),
  worktree: WorktreeLocator.make("/worktrees/integrator-maintained")
} as const

export type IntegratorCassetteInput = ReturnType<typeof integratorPreparationInputFor>
export type IntegratorCassettePublicResult = IntegratorRunProtocolResult
export type IntegratorCassetteRequest = IntegratorRequest
