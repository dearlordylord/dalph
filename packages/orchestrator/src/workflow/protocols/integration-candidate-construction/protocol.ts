/* eslint-disable functional/immutable-data, max-lines -- The candidate protocol owns private memo maps alongside its auditable interpreter. */
import { Context, Effect, Option, Schema } from "effect"
import {
  AcceptedResult,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  evidenceReferenceEquals
} from "@dalph/contracts"
import { type TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import {
  integrationCandidateAgentReportRecordKey,
  integrationCandidateConstructedRecordKey,
  integrationCandidateConstructionIntentRecordKey,
  integrationCandidateGitObservationRecordKey,
  integrationCandidateGitValidationFailureRecordKey,
  integrationCandidateCorrectionLimitReachedRecordKey,
  integrationCandidateContinuationLimitReachedRecordKey,
  integrationCandidateSessionSupersededRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import { journalPrefixPredecessorOf } from "../../../workflow-journal/prefix-lineage.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import type { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import {
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateConstructedEvent,
  type ConstructedIntegrationCandidateOccurrence,
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateCorrelation,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateGitValidationFailedEvent,
  IntegrationCandidateGitValidationAttemptOrdinal,
  IntegrationCandidateCorrectionLimitReachedEvent,
  IntegrationCandidateContinuationLimitReachedEvent,
  IntegrationCandidateSessionSupersededEvent,
  IntegrationCandidateAgentReportOrdinal,
  CandidateCorrectionLimit,
  CandidateContinuationLimit,
  type IntegrationCandidateAgentReport as IntegrationCandidateAgentReportType,
  type IntegrationCandidateGitObservation as IntegrationCandidateGitObservationType,
  IntegrationCandidateId,
  IntegrationSessionId,
  IntegrationCandidateResourceLocator,
  IntegrationCandidateConstructionJournalEvent,
  integrationCandidateCorrelationEquals,
  integrationCandidateHasExactParents
} from "./events.js"

export {
  IntegrationCandidateAgentReport,
  CandidateCorrectionLimit,
  CandidateContinuationLimit,
  IntegrationCandidateCorrelation,
  IntegrationCandidateGitObservation,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "./events.js"

export interface IntegrationCandidateAgentService {
  readonly startOrContinue: (
    request: IntegrationCandidateAgentRequest
  ) => Effect.Effect<IntegrationCandidateAgentReportType, IntegrationCandidateAgentFailure>
}

export class IntegrationCandidateAgent extends Context.Service<
  IntegrationCandidateAgent,
  IntegrationCandidateAgentService
>()("@dalph/IntegrationCandidateAgent") {}

export class IntegrationCandidateAgentFailure extends Schema.TaggedError<IntegrationCandidateAgentFailure>()(
  "IntegrationCandidateAgentFailure",
  { detail: Schema.String, integrationSessionId: IntegrationSessionId }
) {}

export const IntegrationCandidateAgentRequest = Schema.Struct({
  candidateResource: IntegrationCandidateResourceLocator,
  correlation: IntegrationCandidateCorrelation,
  correction: Schema.NullOr(Schema.String)
})
export type IntegrationCandidateAgentRequest = typeof IntegrationCandidateAgentRequest.Type

export interface IntegrationCandidateGitService {
  readonly readSubmittedCommit: (
    repository: GitRepositoryLocator,
    candidateCommit: GitCommitSha
  ) => Effect.Effect<IntegrationCandidateGitObservationType, IntegrationCandidateGitReadFailure>
}

export class IntegrationCandidateGit extends Context.Service<IntegrationCandidateGit, IntegrationCandidateGitService>()(
  "@dalph/IntegrationCandidateGit"
) {}

export class IntegrationCandidateGitReadFailure extends Schema.TaggedError<IntegrationCandidateGitReadFailure>()(
  "IntegrationCandidateGitReadFailure",
  { candidateCommit: GitCommitSha, detail: Schema.String, repository: GitRepositoryLocator }
) {}

export class IntegrationCandidateTargetLineageRejected extends Schema.TaggedError<IntegrationCandidateTargetLineageRejected>()(
  "IntegrationCandidateTargetLineageRejected",
  { observedTargetHead: GitCommitSha, plannedBaseSha: GitCommitSha }
) {}

export const IntegrationCandidateConstructionState = Schema.TaggedUnion({
  CandidateConstructed: {
    acceptedResult: AcceptedResult,
    candidateCommit: GitCommitSha,
    correlation: IntegrationCandidateCorrelation,
    expectedTargetHead: GitCommitSha,
    reviewManifest: EvidenceReference
  },
  CandidateConstructionInProgress: { correlation: IntegrationCandidateCorrelation },
  CandidateCorrectionRequired: {
    candidateCommit: GitCommitSha,
    correlation: IntegrationCandidateCorrelation,
    correctionCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    detail: Schema.String,
    reason: Schema.Literals(["Missing", "NonCommit", "WrongParents"])
  },
  CandidateCorrelationContradiction: {
    expected: IntegrationCandidateCorrelation,
    received: IntegrationCandidateCorrelation
  },
  CandidateCorrectionLimitReached: {
    correctionCount: Schema.Int.check(Schema.isGreaterThan(0)),
    correctionLimit: CandidateCorrectionLimit,
    correlation: IntegrationCandidateCorrelation
  },
  CandidateContinuationLimitReached: {
    continuationCount: Schema.Int.check(Schema.isGreaterThan(0)),
    continuationLimit: CandidateContinuationLimit,
    correlation: IntegrationCandidateCorrelation
  },
  CandidateValidationPending: {
    candidateCommit: GitCommitSha,
    correlation: IntegrationCandidateCorrelation,
    submissionAt: Schema.Int.check(Schema.isGreaterThan(0))
  }
})
export type IntegrationCandidateConstructionState = typeof IntegrationCandidateConstructionState.Type

const sessionIdFor = (responsibility: StartedIntegrationResponsibility): IntegrationSessionId =>
  IntegrationSessionId.make(
    `integration-session:${responsibility.plannedAttempt.runId}:${responsibility.plannedAttempt.attemptId}:${responsibility.startedAt}`
  )

const candidateIdFor = (responsibility: StartedIntegrationResponsibility): IntegrationCandidateId =>
  IntegrationCandidateId.make(
    `integration-candidate:${responsibility.plannedAttempt.runId}:${responsibility.plannedAttempt.attemptId}:${responsibility.startedAt}`
  )

const candidateResourceFor = (responsibility: StartedIntegrationResponsibility): IntegrationCandidateResourceLocator =>
  IntegrationCandidateResourceLocator.make(`integration-candidate-resource:${candidateIdFor(responsibility)}`)

const correlationFor = (
  responsibility: StartedIntegrationResponsibility,
  expectedTargetHead: GitCommitSha
): IntegrationCandidateCorrelation =>
  IntegrationCandidateCorrelation.make({
    acceptanceManifest: responsibility.acceptedResult.evidenceManifest,
    acceptedResultCommit: responsibility.acceptedResult.commit,
    attemptId: responsibility.plannedAttempt.attemptId,
    candidateId: candidateIdFor(responsibility),
    candidateResource: candidateResourceFor(responsibility),
    expectedTargetHead,
    integrationSessionId: sessionIdFor(responsibility),
    integrationTarget: responsibility.integrationTarget,
    runId: responsibility.plannedAttempt.runId
  })

const successorCorrelationFor = (
  responsibility: StartedIntegrationResponsibility,
  expectedTargetHead: GitCommitSha,
  successorOrdinal: number
): IntegrationCandidateCorrelation => {
  const identity = `${responsibility.plannedAttempt.runId}:${responsibility.plannedAttempt.attemptId}:${responsibility.startedAt}:successor:${successorOrdinal}`
  return IntegrationCandidateCorrelation.make({
    acceptanceManifest: responsibility.acceptedResult.evidenceManifest,
    acceptedResultCommit: responsibility.acceptedResult.commit,
    attemptId: responsibility.plannedAttempt.attemptId,
    candidateId: IntegrationCandidateId.make(`integration-candidate:${identity}:${expectedTargetHead}`),
    candidateResource: IntegrationCandidateResourceLocator.make(`integration-candidate-resource:${identity}`),
    expectedTargetHead,
    integrationSessionId: IntegrationSessionId.make(`integration-session:${identity}`),
    integrationTarget: responsibility.integrationTarget,
    runId: responsibility.plannedAttempt.runId
  })
}

const constructedState = (
  event: typeof IntegrationCandidateConstructedEvent.Type
): IntegrationCandidateConstructionState =>
  IntegrationCandidateConstructionState.cases.CandidateConstructed.make({
    acceptedResult: {
      commit: event.correlation.acceptedResultCommit,
      evidenceManifest: event.correlation.acceptanceManifest
    },
    candidateCommit: event.candidateCommit,
    correlation: event.correlation,
    expectedTargetHead: event.correlation.expectedTargetHead,
    reviewManifest: event.reviewManifest
  })

type CandidateIntent = typeof IntegrationCandidateConstructionIntendedEvent.Type

const terminalCandidateState = (
  relevant: ReadonlyArray<JournalRecord>,
  correlation: IntegrationCandidateCorrelation
): IntegrationCandidateConstructionState | undefined => {
  const terminal = relevant.findLast(
    ({ event }) =>
      (event._tag === "IntegrationCandidateConstructed" ||
        event._tag === "IntegrationCandidateCorrectionLimitReached" ||
        event._tag === "IntegrationCandidateContinuationLimitReached") &&
      integrationCandidateCorrelationEquals(event.correlation, correlation)
  )?.event
  if (terminal?._tag === "IntegrationCandidateConstructed") return constructedState(terminal)
  if (terminal?._tag === "IntegrationCandidateContinuationLimitReached") {
    return IntegrationCandidateConstructionState.cases.CandidateContinuationLimitReached.make({
      continuationCount: terminal.continuationCount,
      continuationLimit: terminal.continuationLimit,
      correlation: terminal.correlation
    })
  }
  return terminal?._tag === "IntegrationCandidateCorrectionLimitReached"
    ? IntegrationCandidateConstructionState.cases.CandidateCorrectionLimitReached.make({
        correctionCount: terminal.correctionCount,
        correctionLimit: terminal.correctionLimit,
        correlation: terminal.correlation
      })
    : undefined
}

const correlationContradictionState = (
  relevant: ReadonlyArray<JournalRecord>,
  correlation: IntegrationCandidateCorrelation
): IntegrationCandidateConstructionState | undefined => {
  const report = relevant.find(
    ({ event }) =>
      event._tag === "IntegrationCandidateAgentReported" &&
      integrationCandidateCorrelationEquals(event.expectedCorrelation, correlation) &&
      !integrationCandidateCorrelationEquals(event.report.correlation, correlation)
  )?.event
  return report?._tag === "IntegrationCandidateAgentReported"
    ? IntegrationCandidateConstructionState.cases.CandidateCorrelationContradiction.make({
        expected: correlation,
        received: report.report.correlation
      })
    : undefined
}

const correctionState = (
  relevant: ReadonlyArray<JournalRecord>,
  intent: CandidateIntent,
  observation: typeof IntegrationCandidateGitObservedEvent.Type
): IntegrationCandidateConstructionState => {
  const invalidCount = relevant.filter(
    ({ event }) =>
      event._tag === "IntegrationCandidateGitObserved" &&
      integrationCandidateCorrelationEquals(event.correlation, intent.correlation) &&
      !integrationCandidateHasExactParents(event.observation, intent.correlation)
  ).length
  const mismatch = mismatchFor(observation.observation, intent.correlation)
  return IntegrationCandidateConstructionState.cases.CandidateCorrectionRequired.make({
    candidateCommit: observation.candidateCommit,
    correlation: intent.correlation,
    correctionCount: Math.max(0, invalidCount - 1),
    detail: mismatch.detail,
    reason: mismatch.reason
  })
}

const activeCandidateState = (
  relevant: ReadonlyArray<JournalRecord>,
  intent: CandidateIntent
): IntegrationCandidateConstructionState => {
  const lastReport = relevant.findLast(
    ({ event }) =>
      event._tag === "IntegrationCandidateAgentReported" &&
      integrationCandidateCorrelationEquals(event.report.correlation, intent.correlation)
  )
  if (lastReport?.event._tag !== "IntegrationCandidateAgentReported" || lastReport.event.report._tag !== "Submitted") {
    return IntegrationCandidateConstructionState.cases.CandidateConstructionInProgress.make({
      correlation: intent.correlation
    })
  }
  const observation = relevant.findLast(
    ({ event }) => event._tag === "IntegrationCandidateGitObserved" && event.submissionAt === lastReport.position
  )?.event
  if (
    observation?._tag !== "IntegrationCandidateGitObserved" ||
    integrationCandidateHasExactParents(observation.observation, intent.correlation)
  ) {
    return IntegrationCandidateConstructionState.cases.CandidateValidationPending.make({
      candidateCommit: lastReport.event.report.candidateCommit,
      correlation: intent.correlation,
      submissionAt: lastReport.position
    })
  }
  return correctionState(relevant, intent, observation)
}

const candidateConstructionByPrefix = new WeakMap<
  ReadonlyArray<JournalRecord>,
  Map<JournalPosition, IntegrationCandidateConstructionState | undefined>
>()

const deriveCandidateConstruction = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): IntegrationCandidateConstructionState | undefined => {
  const intendedRecord = records.findLast(
    ({ event }) =>
      event._tag === "IntegrationCandidateConstructionIntended" && event.startedAt === responsibility.startedAt
  )
  const intended = intendedRecord?.event
  const intendedPosition = intendedRecord?.position
  if (intended?._tag !== "IntegrationCandidateConstructionIntended" || intendedPosition === undefined) return undefined
  const relevant = records.filter(({ position }) => position > intendedPosition)
  return (
    terminalCandidateState(relevant, intended.correlation) ??
    correlationContradictionState(relevant, intended.correlation) ??
    activeCandidateState(relevant, intended)
  )
}

export const deriveIntegrationCandidateConstruction = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): IntegrationCandidateConstructionState | undefined => {
  const cachedByStart = candidateConstructionByPrefix.get(records)
  if (cachedByStart?.has(responsibility.startedAt) === true) return cachedByStart.get(responsibility.startedAt)
  const predecessor = journalPrefixPredecessorOf(records)
  if (
    predecessor !== undefined &&
    !Schema.is(IntegrationCandidateConstructionJournalEvent)(predecessor.appended.event)
  ) {
    const state = deriveIntegrationCandidateConstruction(predecessor.prior, responsibility)
    const cache = cachedByStart ?? new Map<JournalPosition, IntegrationCandidateConstructionState | undefined>()
    cache.set(responsibility.startedAt, state)
    candidateConstructionByPrefix.set(records, cache)
    return state
  }
  const state = deriveCandidateConstruction(records, responsibility)
  const cache = cachedByStart ?? new Map<JournalPosition, IntegrationCandidateConstructionState | undefined>()
  cache.set(responsibility.startedAt, state)
  candidateConstructionByPrefix.set(records, cache)
  return state
}

/** Finds the constructed occurrence through the responsibility's exact candidate-session intent. */
export const deriveConstructedIntegrationCandidateOccurrence = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): ConstructedIntegrationCandidateOccurrence | undefined => {
  const state = deriveIntegrationCandidateConstruction(records, responsibility)
  if (state?._tag !== "CandidateConstructed") return undefined
  const constructed = Option.getOrThrow(
    Option.fromUndefinedOr(
      records.findLast(
        ({ event }) =>
          event._tag === "IntegrationCandidateConstructed" &&
          event.candidateCommit === state.candidateCommit &&
          integrationCandidateCorrelationEquals(event.correlation, state.correlation)
      )
    )
  )
  return {
    candidateCommit: state.candidateCommit,
    constructedAt: constructed.position,
    correlation: state.correlation,
    reviewManifest: state.reviewManifest
  }
}

const stateAfterRecordedIntent = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  correlation: IntegrationCandidateCorrelation
): IntegrationCandidateConstructionState =>
  /* v8 ignore next -- @preserve A successful intent append makes this fallback reachable only through a corrupt store collision. */
  deriveIntegrationCandidateConstruction(records, responsibility) ??
  IntegrationCandidateConstructionState.cases.CandidateConstructionInProgress.make({ correlation })

const mismatchFor = (
  observation: IntegrationCandidateGitObservationType,
  correlation: IntegrationCandidateCorrelation
): { readonly detail: string; readonly reason: "Missing" | "NonCommit" | "WrongParents" } => {
  if (observation._tag === "Missing")
    return { detail: "Git reports that the submitted object is missing", reason: "Missing" }
  if (observation._tag === "NonCommit") {
    return {
      detail: `Git reports that the submitted object is a ${observation.objectType}, not a commit`,
      reason: "NonCommit"
    }
  }
  return {
    detail: `Git requires exact ordered direct parents [${correlation.expectedTargetHead}, ${correlation.acceptedResultCommit}]`,
    reason: "WrongParents"
  }
}

const submittedReportAt = (records: ReadonlyArray<JournalRecord>, position: number): JournalRecord | undefined => {
  const record = records.find((candidate) => candidate.position === position)
  return record?.event._tag === "IntegrationCandidateAgentReported" && record.event.report._tag === "Submitted"
    ? record
    : /* v8 ignore next -- @preserve The caller uses the journal position from a derived submitted-report state. */
      undefined
}

type SubmittedCandidateReport = Extract<IntegrationCandidateAgentReportType, { readonly _tag: "Submitted" }>

const submittedCandidateReport = (record: JournalRecord): SubmittedCandidateReport | undefined =>
  record.event._tag === "IntegrationCandidateAgentReported" && record.event.report._tag === "Submitted"
    ? record.event.report
    : /* v8 ignore next -- @preserve validateSubmittedCandidate receives only the record returned by submittedReportAt. */
      undefined

const recordConstructedCandidate = Effect.fn("IntegrationCandidateConstruction.recordConstructed")(function* (
  responsibility: StartedIntegrationResponsibility,
  report: SubmittedCandidateReport,
  gitObservationAt: JournalRecord["position"]
) {
  const journal = yield* InRunJournal
  const constructed = yield* journal.append(
    responsibility.plannedAttempt.runId,
    integrationCandidateConstructedRecordKey(report.correlation),
    IntegrationCandidateConstructedEvent.make({
      candidateCommit: report.candidateCommit,
      correlation: report.correlation,
      gitObservationAt,
      reviewManifest: report.reviewManifest,
      version: workflowJournalEventVersion
    })
  )
  return constructed.event._tag === "IntegrationCandidateConstructed"
    ? constructedState(constructed.event)
    : /* v8 ignore next -- @preserve The event-specific record key cannot collide in a valid journal. */
      stateAfterRecordedIntent(
        yield* journal.read(responsibility.plannedAttempt.runId),
        responsibility,
        report.correlation
      )
})

const recordGitValidationFailure = Effect.fn("IntegrationCandidateConstruction.recordGitFailure")(function* (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  submission: JournalRecord,
  report: SubmittedCandidateReport,
  failure: IntegrationCandidateGitReadFailure
) {
  const journal = yield* InRunJournal
  const attemptOrdinal = IntegrationCandidateGitValidationAttemptOrdinal.make(
    records.filter(
      ({ event }) =>
        /* v8 ignore next -- @preserve Failures for other submissions cannot share this submission-specific record-key prefix. */
        event._tag === "IntegrationCandidateGitValidationFailed" && event.submissionAt === submission.position
    ).length + 1
  )
  yield* journal.append(
    responsibility.plannedAttempt.runId,
    integrationCandidateGitValidationFailureRecordKey(report.correlation, submission.position, attemptOrdinal),
    IntegrationCandidateGitValidationFailedEvent.make({
      attemptOrdinal,
      candidateCommit: report.candidateCommit,
      correlation: report.correlation,
      detail: failure.detail,
      submissionAt: submission.position,
      version: workflowJournalEventVersion
    })
  )
  return stateAfterRecordedIntent(
    yield* journal.read(responsibility.plannedAttempt.runId),
    responsibility,
    report.correlation
  )
})

const stateAfterGitObservation = Effect.fn("IntegrationCandidateConstruction.afterGitObservation")(function* (
  responsibility: StartedIntegrationResponsibility,
  report: SubmittedCandidateReport,
  observationRecord: JournalRecord,
  observation: IntegrationCandidateGitObservationType,
  correctionLimit: CandidateCorrectionLimit
) {
  if (integrationCandidateHasExactParents(observation, report.correlation)) {
    return yield* recordConstructedCandidate(responsibility, report, observationRecord.position)
  }
  const journal = yield* InRunJournal
  const current = yield* journal.read(responsibility.plannedAttempt.runId)
  const invalidCount = current.filter(
    ({ event }) =>
      event._tag === "IntegrationCandidateGitObserved" &&
      integrationCandidateCorrelationEquals(event.correlation, report.correlation) &&
      !integrationCandidateHasExactParents(event.observation, report.correlation)
  ).length
  const correctionCount = Math.max(0, invalidCount - 1)
  if (correctionCount >= correctionLimit) {
    yield* journal.append(
      responsibility.plannedAttempt.runId,
      integrationCandidateCorrectionLimitReachedRecordKey(report.correlation),
      IntegrationCandidateCorrectionLimitReachedEvent.make({
        correctionCount,
        correctionLimit,
        correlation: report.correlation,
        invalidObservationAt: observationRecord.position,
        version: workflowJournalEventVersion
      })
    )
  }
  return stateAfterRecordedIntent(
    yield* journal.read(responsibility.plannedAttempt.runId),
    responsibility,
    report.correlation
  )
})

const resumeObservedCandidate = Effect.fn("IntegrationCandidateConstruction.resumeObserved")(function* (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  submission: JournalRecord,
  report: SubmittedCandidateReport,
  observation: typeof IntegrationCandidateGitObservedEvent.Type
) {
  /* v8 ignore next -- @preserve Derivation resumes an observed candidate here only when that observation has exact parents. */
  if (!integrationCandidateHasExactParents(observation.observation, report.correlation)) {
    return stateAfterRecordedIntent(records, responsibility, report.correlation)
  }
  const existingRecord = records.find(({ event }) => event === observation)
  return yield* recordConstructedCandidate(
    responsibility,
    report,
    /* v8 ignore next -- @preserve The observation passed here is selected from the same records array. */
    existingRecord?.position ?? submission.position
  )
})

const validateSubmittedCandidate = Effect.fn("IntegrationCandidateConstruction.validateSubmitted")(function* (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  submission: JournalRecord,
  correctionLimit: CandidateCorrectionLimit
) {
  const report = submittedCandidateReport(submission)
  /* v8 ignore next -- @preserve The submission argument is returned by the submitted-report selector above. */
  if (report === undefined) {
    return IntegrationCandidateConstructionState.cases.CandidateConstructionInProgress.make({
      correlation: correlationFor(responsibility, responsibility.plannedAttempt.baseSha)
    })
  }
  const journal = yield* InRunJournal
  const runId = responsibility.plannedAttempt.runId
  const correlation = report.correlation
  const existingObservation = records.findLast(
    ({ event }) => event._tag === "IntegrationCandidateGitObserved" && event.submissionAt === submission.position
  )?.event
  if (existingObservation?._tag === "IntegrationCandidateGitObserved") {
    return yield* resumeObservedCandidate(records, responsibility, submission, report, existingObservation)
  }
  const git = yield* IntegrationCandidateGit
  const validation = yield* git
    .readSubmittedCommit(responsibility.integrationTarget.repository, report.candidateCommit)
    .pipe(
      Effect.match({
        onFailure: (failure) => ({ _tag: "Failure" as const, failure }),
        onSuccess: (observation) => ({ _tag: "Observation" as const, observation })
      })
    )
  if (validation._tag === "Failure") {
    return yield* recordGitValidationFailure(records, responsibility, submission, report, validation.failure)
  }
  const observationRecord = yield* journal.append(
    runId,
    integrationCandidateGitObservationRecordKey(correlation, submission.position),
    IntegrationCandidateGitObservedEvent.make({
      candidateCommit: report.candidateCommit,
      correlation,
      observation: validation.observation,
      submissionAt: submission.position,
      version: workflowJournalEventVersion
    })
  )
  return yield* stateAfterGitObservation(
    responsibility,
    report,
    observationRecord,
    validation.observation,
    correctionLimit
  )
})

const continueCandidateAfterIntent = Effect.fn("IntegrationCandidateConstruction.afterIntent")(
  // eslint-disable-next-line complexity -- One ordered resumption boundary reconciles pending validation and both durable limits before invoking the agent.
  function* (
    records: ReadonlyArray<JournalRecord>,
    responsibility: StartedIntegrationResponsibility,
    correlation: IntegrationCandidateCorrelation,
    afterIntent: IntegrationCandidateConstructionState,
    correctionLimit: CandidateCorrectionLimit,
    continuationLimit: CandidateContinuationLimit
  ) {
    if (afterIntent._tag === "CandidateValidationPending") {
      const submission = submittedReportAt(records, afterIntent.submissionAt)
      return submission === undefined
        ? /* v8 ignore next -- @preserve A validation-pending state stores the position of its submitted agent report. */
          afterIntent
        : yield* validateSubmittedCandidate(records, responsibility, submission, correctionLimit)
    }
    if (afterIntent._tag === "CandidateCorrectionRequired" && afterIntent.correctionCount >= correctionLimit) {
      const invalidObservation = records.findLast(
        ({ event }) =>
          event._tag === "IntegrationCandidateGitObserved" &&
          integrationCandidateCorrelationEquals(event.correlation, correlation) &&
          !integrationCandidateHasExactParents(event.observation, correlation)
      )
      /* v8 ignore else -- @preserve A derived correction-required state necessarily has its invalid Git observation. */
      if (invalidObservation?.event._tag === "IntegrationCandidateGitObserved") {
        const journal = yield* InRunJournal
        yield* journal.append(
          responsibility.plannedAttempt.runId,
          integrationCandidateCorrectionLimitReachedRecordKey(correlation),
          IntegrationCandidateCorrectionLimitReachedEvent.make({
            correctionCount: afterIntent.correctionCount,
            correctionLimit,
            correlation,
            invalidObservationAt: invalidObservation.position,
            version: workflowJournalEventVersion
          })
        )
        return stateAfterRecordedIntent(
          yield* journal.read(responsibility.plannedAttempt.runId),
          responsibility,
          correlation
        )
      }
    }
    const nonSubmittingReports = records.filter(
      ({ event }) =>
        event._tag === "IntegrationCandidateAgentReported" &&
        integrationCandidateCorrelationEquals(event.expectedCorrelation, correlation) &&
        integrationCandidateCorrelationEquals(event.report.correlation, correlation) &&
        event.report._tag !== "Submitted"
    )
    if (nonSubmittingReports.length >= continuationLimit) {
      const finalReportOffset = 1
      const lastReport = nonSubmittingReports[nonSubmittingReports.length - finalReportOffset]
      /* v8 ignore else -- @preserve The positive limit and length guard make the final report present. */
      if (lastReport !== undefined) {
        const journal = yield* InRunJournal
        yield* journal.append(
          responsibility.plannedAttempt.runId,
          integrationCandidateContinuationLimitReachedRecordKey(correlation),
          IntegrationCandidateContinuationLimitReachedEvent.make({
            continuationCount: nonSubmittingReports.length,
            continuationLimit,
            correlation,
            lastReportAt: lastReport.position,
            version: workflowJournalEventVersion
          })
        )
        return stateAfterRecordedIntent(
          yield* journal.read(responsibility.plannedAttempt.runId),
          responsibility,
          correlation
        )
      }
    }
    const reportOrdinal = IntegrationCandidateAgentReportOrdinal.make(
      records.filter(({ event }) => event._tag === "IntegrationCandidateAgentReported").length + 1
    )
    const agent = yield* IntegrationCandidateAgent
    const report = yield* agent.startOrContinue(
      IntegrationCandidateAgentRequest.make({
        candidateResource: correlation.candidateResource,
        correlation,
        correction: afterIntent._tag === "CandidateCorrectionRequired" ? afterIntent.detail : null
      })
    )
    const journal = yield* InRunJournal
    const reportRecord = yield* journal.append(
      responsibility.plannedAttempt.runId,
      integrationCandidateAgentReportRecordKey(correlation, reportOrdinal),
      IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: correlation,
        ordinal: reportOrdinal,
        report,
        version: workflowJournalEventVersion
      })
    )
    if (!integrationCandidateCorrelationEquals(report.correlation, correlation)) {
      return stateAfterRecordedIntent(
        yield* journal.read(responsibility.plannedAttempt.runId),
        responsibility,
        correlation
      )
    }
    if (report._tag !== "Submitted") {
      return IntegrationCandidateConstructionState.cases.CandidateConstructionInProgress.make({ correlation })
    }
    return yield* validateSubmittedCandidate(
      yield* journal.read(responsibility.plannedAttempt.runId),
      responsibility,
      reportRecord,
      correctionLimit
    )
  }
)

const targetLineageAllowsCandidate = (
  responsibility: StartedIntegrationResponsibility,
  lineage: TargetLineageObservation
): boolean =>
  lineage.plannedBaseSha === responsibility.plannedAttempt.baseSha && lineage.plannedBaseIsAncestorOfTargetHead

const isTerminalCandidateState = (
  state: IntegrationCandidateConstructionState | undefined
): state is Extract<
  IntegrationCandidateConstructionState,
  {
    readonly _tag:
      | "CandidateConstructed"
      | "CandidateCorrelationContradiction"
      | "CandidateCorrectionLimitReached"
      | "CandidateContinuationLimitReached"
  }
> =>
  state?._tag === "CandidateConstructed" ||
  state?._tag === "CandidateCorrelationContradiction" ||
  state?._tag === "CandidateCorrectionLimitReached" ||
  state?._tag === "CandidateContinuationLimitReached"

const latestCandidateIntentFor = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): CandidateIntent | undefined => {
  const event = records.findLast(
    ({ event: candidateEvent }) =>
      candidateEvent._tag === "IntegrationCandidateConstructionIntended" &&
      candidateEvent.startedAt === responsibility.startedAt
  )?.event
  return event?._tag === "IntegrationCandidateConstructionIntended" ? event : undefined
}

export const supersededSessionMatches = (
  event: WorkflowJournalEvent,
  priorCorrelation: IntegrationCandidateCorrelation,
  targetHead: GitCommitSha
): event is IntegrationCandidateSessionSupersededEvent =>
  event._tag === "IntegrationCandidateSessionSuperseded" &&
  integrationCandidateCorrelationEquals(event.priorCorrelation, priorCorrelation) &&
  event.observedTargetHead === targetHead

const supersededSessionFor = (
  records: ReadonlyArray<JournalRecord>,
  priorCorrelation: IntegrationCandidateCorrelation,
  targetHead: GitCommitSha
) => records.findLast(({ event }) => supersededSessionMatches(event, priorCorrelation, targetHead))?.event

const supersessionBelongsToResponsibility = (
  event: IntegrationCandidateSessionSupersededEvent,
  responsibility: StartedIntegrationResponsibility
): boolean =>
  event.startedAt === responsibility.startedAt &&
  event.responsibilityBeganAt === responsibility.queuedAt &&
  event.priorCorrelation.runId === responsibility.plannedAttempt.runId &&
  event.priorCorrelation.attemptId === responsibility.plannedAttempt.attemptId &&
  event.priorCorrelation.acceptedResultCommit === responsibility.acceptedResult.commit &&
  evidenceReferenceEquals(event.priorCorrelation.acceptanceManifest, responsibility.acceptedResult.evidenceManifest) &&
  event.priorCorrelation.integrationTarget.repository === responsibility.integrationTarget.repository &&
  event.priorCorrelation.integrationTarget.ref === responsibility.integrationTarget.ref

/** Counts only supersessions in this responsibility's accepted-result/session chain. */
export const integrationCandidateSuccessorOrdinalFor = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): number =>
  records.filter(
    ({ event }) =>
      event._tag === "IntegrationCandidateSessionSuperseded" &&
      supersessionBelongsToResponsibility(event, responsibility)
  ).length + 1

const supersedeConstructedCandidate = Effect.fn("IntegrationCandidateConstruction.supersedeSession")(function* (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  priorIntent: CandidateIntent,
  priorState: Extract<IntegrationCandidateConstructionState, { readonly _tag: "CandidateConstructed" }>,
  lineage: TargetLineageObservation,
  correctionLimit: CandidateCorrectionLimit,
  continuationLimit: CandidateContinuationLimit
) {
  const journal = yield* InRunJournal
  const existing = supersededSessionFor(records, priorIntent.correlation, lineage.targetHeadSha)
  const successor =
    existing?._tag === "IntegrationCandidateSessionSuperseded"
      ? existing.successorCorrelation
      : successorCorrelationFor(
          responsibility,
          lineage.targetHeadSha,
          integrationCandidateSuccessorOrdinalFor(records, responsibility)
        )
  if (existing === undefined) {
    yield* journal.append(
      responsibility.plannedAttempt.runId,
      integrationCandidateSessionSupersededRecordKey(priorIntent.correlation, successor),
      IntegrationCandidateSessionSupersededEvent.make({
        observedTargetHead: lineage.targetHeadSha,
        priorCandidateCommit: priorState.candidateCommit,
        priorCorrelation: priorIntent.correlation,
        responsibilityBeganAt: responsibility.queuedAt,
        startedAt: responsibility.startedAt,
        successorCorrelation: successor,
        version: workflowJournalEventVersion
      })
    )
  }
  const afterSupersession = yield* journal.read(responsibility.plannedAttempt.runId)
  if (
    !afterSupersession.some(
      ({ event }) =>
        event._tag === "IntegrationCandidateConstructionIntended" &&
        integrationCandidateCorrelationEquals(event.correlation, successor)
    )
  ) {
    yield* journal.append(
      responsibility.plannedAttempt.runId,
      integrationCandidateConstructionIntentRecordKey(successor),
      IntegrationCandidateConstructionIntendedEvent.make({
        correlation: successor,
        correctionLimit,
        continuationLimit,
        plannedAttempt: responsibility.plannedAttempt,
        responsibilityBeganAt: responsibility.queuedAt,
        startedAt: responsibility.startedAt,
        version: workflowJournalEventVersion
      })
    )
  }
  return yield* journal.read(responsibility.plannedAttempt.runId)
})

export const continueIntegrationCandidateConstruction = Effect.fn("IntegrationCandidateConstruction.continue")(
  // eslint-disable-next-line complexity -- One resumable boundary dispatches the closed durable candidate states without hiding their ordering.
  function* (
    responsibility: StartedIntegrationResponsibility,
    lineage: TargetLineageObservation,
    correctionLimit: CandidateCorrectionLimit,
    continuationLimit: CandidateContinuationLimit
  ) {
    const journal = yield* InRunJournal
    const runId = responsibility.plannedAttempt.runId
    let records = yield* journal.read(runId)
    let existing = deriveIntegrationCandidateConstruction(records, responsibility)
    let durableIntent = latestCandidateIntentFor(records, responsibility)
    if (
      existing?._tag === "CandidateConstructed" &&
      durableIntent !== undefined &&
      durableIntent.correlation.expectedTargetHead !== lineage.targetHeadSha &&
      targetLineageAllowsCandidate(responsibility, lineage)
    ) {
      records = yield* supersedeConstructedCandidate(
        records,
        responsibility,
        durableIntent,
        existing,
        lineage,
        durableIntent.correctionLimit,
        durableIntent.continuationLimit
      )
      existing = deriveIntegrationCandidateConstruction(records, responsibility)
      durableIntent = latestCandidateIntentFor(records, responsibility)
    }
    if (
      existing?._tag === "CandidateConstructed" &&
      durableIntent !== undefined &&
      durableIntent.correlation.expectedTargetHead !== lineage.targetHeadSha &&
      !targetLineageAllowsCandidate(responsibility, lineage)
    ) {
      return yield* new IntegrationCandidateTargetLineageRejected({
        observedTargetHead: lineage.targetHeadSha,
        plannedBaseSha: responsibility.plannedAttempt.baseSha
      })
    }
    if (isTerminalCandidateState(existing)) return existing

    if (durableIntent === undefined && !targetLineageAllowsCandidate(responsibility, lineage)) {
      return yield* new IntegrationCandidateTargetLineageRejected({
        observedTargetHead: lineage.targetHeadSha,
        plannedBaseSha: responsibility.plannedAttempt.baseSha
      })
    }
    const correlation =
      durableIntent?._tag === "IntegrationCandidateConstructionIntended"
        ? durableIntent.correlation
        : correlationFor(responsibility, lineage.targetHeadSha)
    if (durableIntent?._tag !== "IntegrationCandidateConstructionIntended") {
      yield* journal.append(
        runId,
        integrationCandidateConstructionIntentRecordKey(correlation),
        IntegrationCandidateConstructionIntendedEvent.make({
          correlation,
          correctionLimit,
          continuationLimit,
          plannedAttempt: responsibility.plannedAttempt,
          responsibilityBeganAt: responsibility.queuedAt,
          startedAt: responsibility.startedAt,
          version: workflowJournalEventVersion
        })
      )
      records = yield* journal.read(runId)
    }
    const afterIntent = stateAfterRecordedIntent(records, responsibility, correlation)
    const durableCorrectionLimit =
      durableIntent?._tag === "IntegrationCandidateConstructionIntended"
        ? durableIntent.correctionLimit
        : correctionLimit
    const durableContinuationLimit =
      durableIntent?._tag === "IntegrationCandidateConstructionIntended"
        ? durableIntent.continuationLimit
        : continuationLimit
    return yield* continueCandidateAfterIntent(
      records,
      responsibility,
      correlation,
      afterIntent,
      durableCorrectionLimit,
      durableContinuationLimit
    )
  }
)
