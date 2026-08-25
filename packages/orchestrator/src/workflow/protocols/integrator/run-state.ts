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
import type { WorkflowJournalEvent } from "../../registry/event.js"

interface IntegratorRunStateDependencies {
  readonly findEventAtKey: (
    records: ReadonlyArray<JournalRecord>,
    key: JournalRecord["key"]
  ) => JournalRecord | undefined
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
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): JournalRecord | undefined => dependencies.findEventAtKey(records, integratorRunResultRecordedRecordKey(run))

const runGitFactsBindCandidate = (
  related: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  candidateText: IntegratorCandidateText
): boolean =>
  related.every(({ event }) => {
    if (event._tag !== "IntegratorRunCandidateGitReadIntended" && event._tag !== "IntegratorRunCandidateGitObserved") {
      return true
    }
    return integratorRunCorrelationsEqual(event.run, run) && event.candidateText === candidateText
  })

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

const duplicateRunCandidateGitFacts = (related: ReadonlyArray<JournalRecord>): boolean =>
  related.filter(({ event }) => event._tag === "IntegratorRunCandidateGitReadIntended").length > 1 ||
  related.filter(({ event }) => event._tag === "IntegratorRunCandidateGitObserved").length > 1

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
  records: ReadonlyArray<JournalRecord>,
  related: ReadonlyArray<JournalRecord>,
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
  records: ReadonlyArray<JournalRecord>,
  related: ReadonlyArray<JournalRecord>,
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
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): JournalRecord | undefined => {
  const matches = records.filter(({ event }) =>
    event._tag === "IntegratorSessionFixed"
      ? dependencies.correlationsEqual(event.correlation, run.session)
      : event._tag === "IntegratorSuccessorSessionFixed" && dependencies.correlationsEqual(event.successor, run.session)
  )
  return matches.length === 1 ? matches[0] : undefined
}

const runStateWithoutStarted = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  runRelated: ReadonlyArray<JournalRecord>,
  dependencies: IntegratorRunStateDependencies
): IntegratorRunState => {
  const session = exactSessionRecordForRun(records, run, dependencies)
  if (session?.event._tag === "IntegratorSuccessorSessionFixed") {
    return runRelated.length === 0
      ? IntegratorRunState.cases.RunUnfinished.make({ run })
      : runContradictionState("run result or Git record exists without IntegratorRunStarted")
  }
  if (runRelated.length !== 0)
    return runContradictionState("run result or Git record exists without IntegratorRunStarted")
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
  records: ReadonlyArray<JournalRecord>,
  started: JournalRecord,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): string | undefined => {
  const session = exactSessionRecordForRun(records, run, dependencies)
  const lineageRecord = records.find(({ position }) => position === run.session.targetLineageObservedAt)
  const valid =
    runStartHasExactSession(session, run, dependencies) &&
    lineageMatchesCorrelation(lineageRecord, run.session) &&
    runStartFollowsSession(started, session)
  return valid ? undefined : "IntegratorRunStarted does not follow its exact fixed session and target lineage"
}

const hasForeignRelatedSession = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): boolean => {
  const requestedFacts = dependencies.responsibilityFactsFromCorrelation(run.session)
  const successorRelations = records.filter(
    ({ event }) =>
      event._tag === "IntegratorSuccessorSessionFixed" &&
      (dependencies.correlationsEqual(event.successor, run.session) ||
        dependencies.correlationsEqual(event.predecessor, run.session))
  )
  const activeRelation = successorRelations.find(
    ({ event }) =>
      event._tag === "IntegratorSuccessorSessionFixed" && dependencies.correlationsEqual(event.successor, run.session)
  )
  const expectedBase =
    activeRelation?.event._tag === "IntegratorSuccessorSessionFixed" ? activeRelation.event.predecessor : run.session
  const baseSessions = records.filter(
    ({ event }) =>
      event._tag === "IntegratorSessionFixed" &&
      dependencies.responsibilityFactsEqual(
        dependencies.responsibilityFactsFromCorrelation(event.correlation),
        requestedFacts
      )
  )
  return (
    baseSessions.length !== 1 ||
    baseSessions.some(
      ({ event }) =>
        event._tag !== "IntegratorSessionFixed" || !dependencies.correlationsEqual(event.correlation, expectedBase)
    ) ||
    successorRelations.some(
      /* v8 ignore next -- @preserve an exact run start rejects a second successor relation for the requested successor session before this foreign-relation guard. */
      ({ event }) =>
        event._tag !== "IntegratorSuccessorSessionFixed" ||
        (!dependencies.correlationsEqual(event.predecessor, expectedBase) &&
          /* v8 ignore next -- @preserve an exact run start admits one successor relation for this session; a distinct predecessor would make that exact session ambiguous before this check. */
          !dependencies.correlationsEqual(event.predecessor, run.session))
    )
  )
}

const runHasGitFacts = (related: ReadonlyArray<JournalRecord>): boolean =>
  related.some(
    ({ event }) =>
      event._tag === "IntegratorRunCandidateGitReadIntended" || event._tag === "IntegratorRunCandidateGitObserved"
  )

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
  records: ReadonlyArray<JournalRecord>,
  runRelated: ReadonlyArray<JournalRecord>,
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
  records: ReadonlyArray<JournalRecord>,
  runRelated: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  started: JournalRecord,
  dependencies: IntegratorRunStateDependencies
): IntegratorRunState => {
  if (runRelated.filter(({ event }) => event._tag === "IntegratorRunResultRecorded").length > 1) {
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

/** Reconstructs only the explicit run vocabulary. Unknown historical event tags are rejected by journal decoding. */
export const deriveIntegratorRunStateFromHistory = (
  records: ReadonlyArray<JournalRecord>,
  _responsibility: StartedIntegrationResponsibility,
  run: IntegratorRunCorrelation,
  dependencies: IntegratorRunStateDependencies
): IntegratorRunState => {
  const runStarted = records.filter(({ event }) => event._tag === "IntegratorRunStarted" && runEventMatches(event, run))
  const runRelated = records.filter(({ event }) => runEventMatches(event, run))
  if (runStarted.length === 0) return runStateWithoutStarted(records, run, runRelated, dependencies)
  if (runStarted.length !== 1) return runContradictionState("an exact Integrator run was started more than once")
  const started = runStarted[0]
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
