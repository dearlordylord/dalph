import { Schema } from "effect"

const CodexExecutorStoryItem = Schema.TaggedUnion({
  Begin: {},
  Observe: {},
  CodexTurnResponseLost: {},
  CodexTurnCompletes: {},
  RequestSuspension: {},
  ExpectReport: {
    report: Schema.Literals(["ExecutorWorkExecuting", "ExecutorWorkTerminal", "ExecutorWorkSafelySuspended"])
  },
  /** Alice explicitly asks to replace one previously observed, now purged turn. */
  ReplacePurgedWorkUnit: {},
  /** The replacement result is visible only after fresh authority reads. */
  ExpectReplacementResult: {
    result: Schema.Literals([
      "Replaced",
      "ProviderTemporarilyUnreadable",
      "TaskWorkSessionAbsent",
      "CorrelationConflict",
      "ExclusiveRetainedOwnershipUnproved",
      "PurgeUnconfirmed",
      "RequestIdentityReuseContradiction"
    ])
  },
  /** The previously observed work unit remains represented as purged, incomplete work. */
  ExpectPurgedWorkUnitPreserved: {},
  /** The replacement is a new provider work unit, not a resumed predecessor. */
  ExpectDistinctReplacementWorkUnit: {},
  /** A fail-closed branch must not cross a second task-turn boundary. */
  ExpectNoReplacementTurn: {},
  /** This executor-private chronology must not enter semantic review. */
  ExpectNoSemanticReview: {},
  /** This executor-private chronology must not enter integration. */
  ExpectNoIntegration: {},
  /** This executor-private chronology must preserve W1 instead of cleaning it. */
  ExpectNoCleanup: {}
})

export const CodexPlannedAttemptExecutorCassette = Schema.Struct({
  name: Schema.NonEmptyString,
  scenario: Schema.Literals([
    "FirstTurnExecutorWorkExecuting",
    "LostTurnResponse",
    "AcceptedExecutorWorkTerminal",
    "ExecutorWorkSafelySuspended",
    "PurgedWorkUnitReplacement",
    "PurgedWorkUnitUnreadable",
    "PurgedWorkUnitWriterConflict",
    "PurgedWorkUnitSessionAbsent",
    "PurgedWorkUnitCorrelationConflict",
    "PurgedWorkUnitStillPresent",
    "PurgedWorkUnitRequestConflict"
  ]),
  story: Schema.NonEmptyArray(CodexExecutorStoryItem)
})
export type CodexPlannedAttemptExecutorCassette = typeof CodexPlannedAttemptExecutorCassette.Type

const cassette = (
  name: string,
  scenario: CodexPlannedAttemptExecutorCassette["scenario"],
  story: CodexPlannedAttemptExecutorCassette["story"]
) => CodexPlannedAttemptExecutorCassette.make({ name, scenario, story })

export const maintainedCodexPlannedAttemptExecutorCassetteCatalog = {
  firstTurnExecutorWorkExecuting: cassette(
    "the concrete Codex executor records one thread before starting one task turn",
    "FirstTurnExecutorWorkExecuting",
    [{ _tag: "Begin" }, { _tag: "ExpectReport", report: "ExecutorWorkExecuting" }]
  ),
  lostTurnResponseReconciled: cassette(
    "the concrete Codex executor rereads one lost turn response without starting another turn",
    "LostTurnResponse",
    [{ _tag: "Begin" }, { _tag: "CodexTurnResponseLost" }, { _tag: "ExpectReport", report: "ExecutorWorkExecuting" }]
  ),
  acceptedExecutorWorkTerminal: cassette(
    "the concrete Codex executor seals one correlated accepted commit and its evidence",
    "AcceptedExecutorWorkTerminal",
    [
      { _tag: "Begin" },
      { _tag: "ExpectReport", report: "ExecutorWorkExecuting" },
      { _tag: "CodexTurnCompletes" },
      { _tag: "Observe" },
      { _tag: "ExpectReport", report: "ExecutorWorkTerminal" }
    ]
  ),
  executorWorkSafelySuspended: cassette(
    "the concrete Codex executor interrupts its exact turn before reporting safe suspension",
    "ExecutorWorkSafelySuspended",
    [
      { _tag: "Begin" },
      { _tag: "ExpectReport", report: "ExecutorWorkExecuting" },
      { _tag: "RequestSuspension" },
      { _tag: "ExpectReport", report: "ExecutorWorkSafelySuspended" }
    ]
  ),
  purgedWorkUnitReplacement: cassette(
    "Alice replaces one confirmed-purged Codex work unit in the exact retained thread and worktree",
    "PurgedWorkUnitReplacement",
    [
      { _tag: "ReplacePurgedWorkUnit" },
      { _tag: "ExpectReplacementResult", result: "Replaced" },
      { _tag: "ExpectPurgedWorkUnitPreserved" },
      { _tag: "ExpectDistinctReplacementWorkUnit" },
      { _tag: "ExpectNoSemanticReview" },
      { _tag: "ExpectNoIntegration" },
      { _tag: "ExpectNoCleanup" },
      { _tag: "ExpectReport", report: "ExecutorWorkExecuting" }
    ]
  ),
  purgedWorkUnitUnreadable: cassette(
    "Alice waits when Codex cannot freshly prove that the preceding turn was purged",
    "PurgedWorkUnitUnreadable",
    [
      { _tag: "ReplacePurgedWorkUnit" },
      { _tag: "ExpectReplacementResult", result: "ProviderTemporarilyUnreadable" },
      { _tag: "ExpectNoReplacementTurn" }
    ]
  ),
  purgedWorkUnitWriterConflict: cassette(
    "Alice waits when a live or unreadable writer prevents exclusive retained ownership",
    "PurgedWorkUnitWriterConflict",
    [
      { _tag: "ReplacePurgedWorkUnit" },
      { _tag: "ExpectReplacementResult", result: "ExclusiveRetainedOwnershipUnproved" },
      { _tag: "ExpectNoReplacementTurn" }
    ]
  ),
  purgedWorkUnitSessionAbsent: cassette(
    "Alice waits when the retained Codex task-work session is absent",
    "PurgedWorkUnitSessionAbsent",
    [
      { _tag: "ReplacePurgedWorkUnit" },
      { _tag: "ExpectReplacementResult", result: "TaskWorkSessionAbsent" },
      { _tag: "ExpectNoReplacementTurn" }
    ]
  ),
  purgedWorkUnitCorrelationConflict: cassette(
    "Alice waits when the retained Codex session conflicts with the planned attempt",
    "PurgedWorkUnitCorrelationConflict",
    [
      { _tag: "ReplacePurgedWorkUnit" },
      { _tag: "ExpectReplacementResult", result: "CorrelationConflict" },
      { _tag: "ExpectNoReplacementTurn" }
    ]
  ),
  purgedWorkUnitStillPresent: cassette(
    "Alice waits when the previously observed Codex work unit is still present",
    "PurgedWorkUnitStillPresent",
    [
      { _tag: "ReplacePurgedWorkUnit" },
      { _tag: "ExpectReplacementResult", result: "PurgeUnconfirmed" },
      { _tag: "ExpectNoReplacementTurn" }
    ]
  ),
  purgedWorkUnitRequestConflict: cassette(
    "Alice receives a contradiction when a replacement request is reused for another subject",
    "PurgedWorkUnitRequestConflict",
    [
      { _tag: "ReplacePurgedWorkUnit" },
      { _tag: "ExpectReplacementResult", result: "RequestIdentityReuseContradiction" },
      { _tag: "ExpectNoReplacementTurn" }
    ]
  )
} as const

const CodexReplacementResultTag = Schema.Literals([
  "Replaced",
  "ProviderTemporarilyUnreadable",
  "TaskWorkSessionAbsent",
  "CorrelationConflict",
  "ExclusiveRetainedOwnershipUnproved",
  "PurgeUnconfirmed",
  "RequestIdentityReuseContradiction"
])
const NonNegativeCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * Versioned public evidence projected from one concrete executor run. Private
 * Codex thread, turn, token, and replacement-ledger identities are excluded.
 */
export const CodexPlannedAttemptExecutorRecordedCassette = Schema.Struct({
  authorityObservationCount: Schema.NullOr(NonNegativeCount),
  authorityRetainedWorkEvidenceMatches: Schema.NullOr(Schema.Boolean),
  downstreamBoundaryCalls: Schema.Struct({
    cleanup: NonNegativeCount,
    integration: NonNegativeCount,
    semanticReview: NonNegativeCount
  }),
  name: Schema.NonEmptyString,
  replacementResultTag: Schema.NullOr(CodexReplacementResultTag),
  reportTags: Schema.Array(
    Schema.Literals(["ExecutorWorkExecuting", "ExecutorWorkTerminal", "ExecutorWorkSafelySuspended"])
  ),
  scenario: CodexPlannedAttemptExecutorCassette.fields.scenario,
  threadStartCount: NonNegativeCount,
  turnStartCount: NonNegativeCount,
  version: Schema.Literal(1)
})
export type CodexPlannedAttemptExecutorRecordedCassette = typeof CodexPlannedAttemptExecutorRecordedCassette.Type
