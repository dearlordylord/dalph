import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import type { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import { integratorCandidateHasExactParents, integratorRunCorrelationsEqual, IntegratorRunState } from "./events.js"
import type {
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorResponsibilityFacts,
  IntegratorResult,
  IntegratorRunCorrelation
} from "./events.js"
import {
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  journalRecordByPosition,
  journalRecordsForIntegratorSession,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"

interface IntegratorRunStateDependencies {
  readonly findEventAtKey: (records: JournalHistorySource, key: JournalRecord["key"]) => JournalRecord | undefined
  readonly responsibilityFactsFromCorrelation: (
    correlation: IntegratorSessionCorrelation
  ) => IntegratorResponsibilityFacts
  readonly responsibilityFactsEqual: (
    left: IntegratorResponsibilityFacts,
    right: IntegratorResponsibilityFacts
  ) => boolean
  readonly correlationsEqual: (left: IntegratorSessionCorrelation, right: IntegratorSessionCorrelation) => boolean
}

const runContradictionState = (detail: string): IntegratorRunState =>
  IntegratorRunState.cases.Contradiction.make({ detail })

const runEventMatches = (event: WorkflowJournalEvent, run: IntegratorRunCorrelation): boolean => {
  if (event._tag === "IntegratorRunStarted") return integratorRunCorrelationsEqual(event.run, run)
  if (event._tag === "IntegratorRunResultRecorded") return integratorRunCorrelationsEqual(event.run, run)
  if (event._tag === "IntegratorRunCandidateGitReadIntended") return integratorRunCorrelationsEqual(event.run, run)
  if (event._tag === "IntegratorRunCandidateGitObserved") return integratorRunCorrelationsEqual(event.run, run)
  return false
}

const lineageMatchesCorrelation = (
  record: JournalRecord | undefined,
  correlation: IntegratorSessionCorrelation
): boolean =>
  record?.event._tag === "TargetLineageObserved" &&
  record.event.observation.targetHeadSha === correlation.expectedTargetHead &&
  record.event.observation.plannedBaseSha === correlation.plannedAttempt.baseSha &&
  record.event.observation.plannedBaseIsAncestorOfTargetHead &&
  plannedTaskAttemptEquivalence(record.event.plannedAttempt, correlation.plannedAttempt)

const runResultFor = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): JournalRecord | undefined => dependencies.findEventAtKey(records, integratorRunResultRecordedRecordKey(run))

const runGitFactsBindCandidate = (
  related: Iterable<JournalRecord>,
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText
): boolean => {
  for (const { event } of related) {
    if (event._tag !== "IntegratorRunCandidateGitReadIntended" && event._tag !== "IntegratorRunCandidateGitObserved") {
      continue
    }
    if (!integratorRunCorrelationsEqual(event.run, run) || event.candidateText !== candidateText) return false
  }
  return true
}

type RunCandidateGitFacts =
  | { readonly _tag: "Contradiction"; readonly detail: string }
  | { readonly _tag: "Awaiting" }
  | {
      readonly _tag: "Observed"
      readonly observation: Extract<
        WorkflowJournalEvent,
        { readonly _tag: "IntegratorRunCandidateGitObserved" }
      >["observation"]
      readonly position: JournalRecord["position"]
    }

const duplicateRunCandidateGitFacts = (related: Iterable<JournalRecord>): boolean => {
  let intents = 0
  let observations = 0
  for (const { event } of related) {
    if (event._tag === "IntegratorRunCandidateGitReadIntended") intents += 1
    if (event._tag === "IntegratorRunCandidateGitObserved") observations += 1
  }
  return intents > 1 || observations > 1
}

const foreignRunCandidateGitIntent = (
  intent: JournalRecord | undefined,
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText
): boolean =>
  intent !== undefined &&
  (intent.event._tag !== "IntegratorRunCandidateGitReadIntended" ||
    intent.event.candidateText !== candidateText ||
    !integratorRunCorrelationsEqual(intent.event.run, run))

type ExactRunCandidateGitObservationRecord = JournalRecord & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorRunCandidateGitObserved" }>
}

const runCandidateGitObservationMatches = (
  observed: JournalRecord,
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText
): observed is ExactRunCandidateGitObservationRecord =>
  observed.event._tag === "IntegratorRunCandidateGitObserved" &&
  observed.event.candidateText === candidateText &&
  integratorRunCorrelationsEqual(observed.event.run, run) &&
  observed.event.observation.candidateText === candidateText

const runCandidateGitFactsFor = (
  records: JournalHistorySource,
  related: Iterable<JournalRecord>,
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText,
  dependencies: IntegratorRunStateDependencies
): RunCandidateGitFacts => {
  if (!runGitFactsBindCandidate(related, run, candidateText)) {
    return { _tag: "Contradiction", detail: "Git facts do not bind the recorded candidate to the exact run" }
  }
  if (duplicateRunCandidateGitFacts(related)) {
    return { _tag: "Contradiction", detail: "one exact run has duplicate candidate Git facts" }
  }
  const intent = dependencies.findEventAtKey(
    records,
    integratorRunCandidateGitReadIntendedRecordKey(run, candidateText)
  )
  if (foreignRunCandidateGitIntent(intent, run, candidateText)) {
    return { _tag: "Contradiction", detail: "the run Git-read intent has a foreign run or candidate" }
  }
  const observed = dependencies.findEventAtKey(records, integratorRunCandidateGitObservedRecordKey(run, candidateText))
  if (observed === undefined) return { _tag: "Awaiting" }
  if (intent === undefined) {
    return { _tag: "Contradiction", detail: "run Git observation exists without a read intent" }
  }
  if (!runCandidateGitObservationMatches(observed, run, candidateText)) {
    return { _tag: "Contradiction", detail: "run Git observation does not bind the reported candidate" }
  }
  return { _tag: "Observed", observation: observed.event.observation, position: observed.position }
}

const runStateForPreparedCandidate = (
  records: JournalHistorySource,
  related: Iterable<JournalRecord>,
  run: IntegratorRunCorrelation,
  result: Extract<IntegratorResult, { readonly _tag: "PreparedCandidate" }>,
  dependencies: IntegratorRunStateDependencies
): IntegratorRunState => {
  const { candidateText } = result
  const facts = runCandidateGitFactsFor(records, related, run, candidateText, dependencies)
  if (facts._tag === "Contradiction") return runContradictionState(facts.detail)
  if (facts._tag === "Awaiting") return IntegratorRunState.cases.PreparedAwaitingGit.make({ candidateText, run })
  const { observation } = facts
  if (
    !integratorCandidateHasExactParents(observation, run.session.expectedTargetHead, run.session.acceptedResult.commit)
  ) {
    return IntegratorRunState.cases.CandidateRejected.make({ candidateText, observation, run })
  }
  return IntegratorRunState.cases.GitQualifiedPrepared.make({
    candidateCommit: observation.commit,
    candidateText,
    observation: { directParents: [observation.directParents[0], observation.directParents[1]] },
    qualifiedAt: facts.position,
    run
  })
}

const exactSessionRecordForRun = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): JournalRecord | undefined => {
  let match: JournalRecord | undefined
  let count = 0
  for (const tag of ["IntegratorSessionFixed", "IntegratorSuccessorSessionFixed"] as const) {
    for (const record of journalRecordsOfKind(records, tag)) {
      const { event } = record
      const matches =
        event._tag === "IntegratorSessionFixed"
          ? dependencies.correlationsEqual(event.correlation, run.session)
          : event._tag === "IntegratorSuccessorSessionFixed" &&
            dependencies.correlationsEqual(event.successor, run.session)
      if (matches) {
        count += 1
        match ??= record
      }
    }
  }
  return count === 1 ? match : undefined
}

const runStateWithoutStarted = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  runRelated: Iterable<JournalRecord>,
  dependencies: IntegratorRunStateDependencies
): IntegratorRunState => {
  const session = exactSessionRecordForRun(records, run, dependencies)
  if (session?.event._tag === "IntegratorSuccessorSessionFixed") {
    return isEmpty(runRelated)
      ? IntegratorRunState.cases.RunUnfinished.make({ run })
      : runContradictionState("run result or Git record exists without IntegratorRunStarted")
  }
  if (!isEmpty(runRelated)) return runContradictionState("run result or Git record exists without IntegratorRunStarted")
  return session === undefined || run.ordinal !== 1
    ? IntegratorRunState.cases.Absent.make({ run })
    : IntegratorRunState.cases.RunUnfinished.make({ run })
}

const runStartHasExactSession = (
  session: JournalRecord | undefined,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): boolean =>
  (session?.event._tag === "IntegratorSessionFixed" &&
    dependencies.correlationsEqual(session.event.correlation, run.session)) ||
  (session?.event._tag === "IntegratorSuccessorSessionFixed" &&
    dependencies.correlationsEqual(session.event.successor, run.session))

const runStartFollowsSession = (started: JournalRecord, session: JournalRecord | undefined): boolean =>
  session !== undefined && started.position > session.position

const runStartRelationIssue = (
  records: JournalHistorySource,
  started: JournalRecord,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): string | undefined => {
  const session = exactSessionRecordForRun(records, run, dependencies)
  const lineageRecord = journalRecordByPosition(records, run.session.targetLineageObservedAt)
  const valid =
    runStartHasExactSession(session, run, dependencies) &&
    lineageMatchesCorrelation(lineageRecord, run.session) &&
    runStartFollowsSession(started, session)
  return valid ? undefined : "IntegratorRunStarted does not follow its exact fixed session and target lineage"
}

const expectedBaseSessionFor = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): IntegratorRunCorrelation["session"] => {
  let activeRelation: JournalRecord | undefined
  for (const record of journalRecordsOfKind(records, "IntegratorSuccessorSessionFixed")) {
    const { event } = record
    if (
      event._tag === "IntegratorSuccessorSessionFixed" &&
      (dependencies.correlationsEqual(event.successor, run.session) ||
        dependencies.correlationsEqual(event.predecessor, run.session))
    ) {
      if (dependencies.correlationsEqual(event.successor, run.session)) activeRelation ??= record
    }
  }
  return activeRelation?.event._tag === "IntegratorSuccessorSessionFixed"
    ? activeRelation.event.predecessor
    : run.session
}

const hasUniqueBaseSession = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  expectedBase: IntegratorRunCorrelation["session"],
  dependencies: IntegratorRunStateDependencies
): boolean => {
  const requestedFacts = dependencies.responsibilityFactsFromCorrelation(run.session)
  let baseSessionCount = 0
  let foreignBaseSession = false
  for (const { event } of journalRecordsOfKind(records, "IntegratorSessionFixed")) {
    if (
      event._tag === "IntegratorSessionFixed" &&
      dependencies.responsibilityFactsEqual(
        dependencies.responsibilityFactsFromCorrelation(event.correlation),
        requestedFacts
      )
    ) {
      baseSessionCount += 1
      if (!dependencies.correlationsEqual(event.correlation, expectedBase)) foreignBaseSession = true
    }
  }
  return baseSessionCount === 1 && !foreignBaseSession
}

const hasForeignSuccessorRelation = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  expectedBase: IntegratorRunCorrelation["session"],
  dependencies: IntegratorRunStateDependencies
): boolean => {
  for (const { event } of journalRecordsOfKind(records, "IntegratorSuccessorSessionFixed")) {
    if (
      event._tag === "IntegratorSuccessorSessionFixed" &&
      (dependencies.correlationsEqual(event.successor, run.session) ||
        dependencies.correlationsEqual(event.predecessor, run.session)) &&
      /* v8 ignore next -- @preserve an exact run start rejects a second successor relation for the requested successor session before this foreign-relation guard. */
      !dependencies.correlationsEqual(event.predecessor, expectedBase) &&
      /* v8 ignore next -- @preserve an exact run start admits one successor relation for this session; a distinct predecessor would make that exact session ambiguous before this check. */
      !dependencies.correlationsEqual(event.predecessor, run.session)
    ) {
      return true
    }
  }
  return false
}

const hasForeignRelatedSession = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): boolean => {
  const expectedBase = expectedBaseSessionFor(records, run, dependencies)
  if (!hasUniqueBaseSession(records, run, expectedBase, dependencies)) return true
  return hasForeignSuccessorRelation(records, run, expectedBase, dependencies)
}

const runHasGitFacts = (related: Iterable<JournalRecord>): boolean => {
  for (const { event } of related) {
    if (event._tag === "IntegratorRunCandidateGitReadIntended" || event._tag === "IntegratorRunCandidateGitObserved") {
      return true
    }
  }
  return false
}

type ExactRunResultRecord = JournalRecord & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorRunResultRecorded" }>
}

const isExactRunResultRecord = (record: JournalRecord): record is ExactRunResultRecord =>
  record.event._tag === "IntegratorRunResultRecorded"

const runResultBindingIssue = (
  resultRecord: ExactRunResultRecord,
  started: JournalRecord,
  run: IntegratorRunCorrelation
): string | undefined =>
  resultRecord.position > started.position &&
  integratorRunCorrelationsEqual(resultRecord.event.run, run) &&
  integratorRunCorrelationsEqual(resultRecord.event.result.correlation, run)
    ? undefined
    : "the recorded outer result is not bound to the exact run"

const stateAfterRunResult = (
  records: JournalHistorySource,
  runRelated: Iterable<JournalRecord>,
  run: IntegratorRunCorrelation,
  resultRecord: ExactRunResultRecord,
  dependencies: IntegratorRunStateDependencies
): IntegratorRunState => {
  const { result } = resultRecord.event
  if (result._tag === "PreparedCandidate") {
    return runStateForPreparedCandidate(records, runRelated, run, result, dependencies)
  }
  return runHasGitFacts(runRelated)
    ? runContradictionState("NotPrepared cannot have a run Git observation")
    : IntegratorRunState.cases.NotPrepared.make({ detail: result.detail, run })
}

const stateAfterStartedRun = (
  records: JournalHistorySource,
  runRelated: Iterable<JournalRecord>,
  run: IntegratorRunCorrelation,
  started: JournalRecord,
  dependencies: IntegratorRunStateDependencies
): IntegratorRunState => {
  let resultCount = 0
  for (const { event } of runRelated) if (event._tag === "IntegratorRunResultRecorded") resultCount += 1
  if (resultCount > 1) {
    return runContradictionState("one exact Integrator run has more than one durable result")
  }
  const resultRecord = runResultFor(records, run, dependencies)
  if (resultRecord === undefined) {
    return runHasGitFacts(runRelated)
      ? runContradictionState("run Git facts exist without a run result")
      : IntegratorRunState.cases.RunUnfinished.make({ run })
  }
  if (!isExactRunResultRecord(resultRecord)) {
    return runContradictionState("the exact run result key contains a foreign event")
  }
  const issue = runResultBindingIssue(resultRecord, started, run)
  if (issue !== undefined) return runContradictionState(issue)
  return stateAfterRunResult(records, runRelated, run, resultRecord, dependencies)
}

const runStartOccurrences = (runRelated: Iterable<JournalRecord>) => {
  let started: JournalRecord | undefined
  let startedCount = 0
  for (const record of runRelated) {
    if (record.event._tag === "IntegratorRunStarted") {
      startedCount += 1
      started ??= record
    }
  }
  return { started, startedCount }
}

/** Reconstructs only the explicit run vocabulary. Unknown historical event tags are rejected by journal decoding. */
export const deriveIntegratorRunStateFromHistory = (
  records: JournalHistorySource,
  _responsibility: StartedIntegrationResponsibility,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): IntegratorRunState => {
  const runRelated = {
    *[Symbol.iterator]() {
      for (const record of journalRecordsForIntegratorSession(records, run.session.sessionId)) {
        if (runEventMatches(record.event, run)) yield record
      }
    }
  }
  const { started, startedCount } = runStartOccurrences(runRelated)
  if (startedCount === 0) return runStateWithoutStarted(records, run, runRelated, dependencies)
  if (startedCount !== 1) return runContradictionState("an exact Integrator run was started more than once")
  /* v8 ignore next -- @preserve runStarted is filtered by the same event tag above; this guard protects malformed runtime data. */
  if (started === undefined || started.event._tag !== "IntegratorRunStarted") {
    return runContradictionState("the exact Integrator run-start record is malformed")
  }
  const startIssue = runStartRelationIssue(records, started, run, dependencies)
  if (startIssue !== undefined) return runContradictionState(startIssue)
  if (hasForeignRelatedSession(records, run, dependencies)) {
    return runContradictionState("multiple fixed sessions describe one exact integration responsibility")
  }
  return stateAfterStartedRun(records, runRelated, run, started, dependencies)
}

const isEmpty = (records: Iterable<JournalRecord>): boolean => records[Symbol.iterator]().next().done === true
