/* eslint-disable functional/immutable-data, max-lines -- Attempt and replacement chronology validation preserves exact ordered issue reporting. */
import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt, type RunId, type TaskId } from "@dalph/contracts"
import { HashMap, HashSet, Option } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import type { WorkflowJournalHistoryIssue, WorkflowJournalHistorySemanticIssue } from "./history-result.js"
import { emptyIndexes, identityIssue, mapGet, semanticIssue, type FoldIndexes } from "./history-kernel-state.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import { evaluatePlannedAttemptContinuationAuthorization } from "../../workflow/protocols/planned-attempt-continuation/protocol.js"
import {
  currentUnconsumedAcceptedSafeEvidence,
  latestPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand,
  plannedAttemptExecutorEvidence
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { authorizedClaimForAttempt } from "../../workflow/claim-authority-history.js"
import {
  attemptChoiceSubjectKey,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject
} from "../../workflow/protocols/attempt-choice/events.js"
import { reconstructedTaskGraphFromEvents } from "./graph-knowledge.js"
import { claimReadMatchesTarget, exactWorkflowRunTargetFor } from "../../workflow-journal/run-target.js"
import { recordedTaskAttemptPlanFor } from "../../workflow/protocols/task-attempt-planning/journal-evidence.js"
import { taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { restartAuthorityReadOperationMatches } from "../../workflow/protocols/attempt-choice/replacement-events.js"
import {
  restartChoiceWasInvalidatedByLaterSpecification,
  restartClaimAuthorityAtApplication,
  type RestartApplicationRecord
} from "../../workflow/protocols/attempt-choice/restart-authority.js"
import { acceptedFreshAttemptLineage } from "../admission/fresh-attempt-lineage.js"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import {
  firstJournalRecordOfKind,
  isJournalRecordEvidence,
  journalEvidenceBefore,
  journalRecordsForAttempt,
  journalRecordsForOperationId,
  journalRecordsForTask,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"

const historyBefore = (source: JournalHistorySource, exclusivePosition: JournalPosition): JournalHistorySource =>
  isJournalRecordEvidence(source)
    ? journalEvidenceBefore(source, exclusivePosition)
    : source.filter(({ position }) => position < exclusivePosition)

function findFirst<A, B extends A>(source: Iterable<A>, predicate: (value: A) => value is B): B | undefined
function findFirst<A>(source: Iterable<A>, predicate: (value: A) => boolean): A | undefined
function findFirst<A>(source: Iterable<A>, predicate: (value: A) => boolean): A | undefined {
  for (const value of source) if (predicate(value)) return value
  return undefined
}

function findLast<A, B extends A>(source: Iterable<A>, predicate: (value: A) => value is B): B | undefined
function findLast<A>(source: Iterable<A>, predicate: (value: A) => boolean): A | undefined
function findLast<A>(source: Iterable<A>, predicate: (value: A) => boolean): A | undefined {
  let found: A | undefined
  for (const value of source) if (predicate(value)) found = value
  return found
}

const hasMatching = <A>(source: Iterable<A>, predicate: (value: A) => boolean): boolean =>
  findFirst(source, predicate) !== undefined

type AttemptChoiceRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptChoiceApplied" }>
}

const validateAttemptChoiceAuthority = (
  record: AttemptChoiceRecord,
  runId: RunId,
  prior: JournalHistorySource,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const { subject } = record.event
  const bindsRun = () => record.event.requestId.runId === runId && subject.plannedAttempt.runId === runId
  if (!bindsRun()) {
    identityIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} binds run ${subject.plannedAttempt.runId}`
    )
  }
  if (recordedTaskAttemptPlanFor(prior, subject.plannedAttempt) === undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} has no prior matching planned attempt`
    )
  }
  if (currentUnconsumedAcceptedSafeEvidence(prior, subject.plannedAttempt) === undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} requires the latest accepted safely-suspended executor report`
    )
  }
  const immutableRunTarget = exactWorkflowRunTargetFor(prior)
  const latestSpecification = findLast(
    journalRecordsForTask(prior, subject.plannedAttempt.taskId),
    ({ event }) =>
      immutableRunTarget !== undefined &&
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === subject.plannedAttempt.taskId &&
      taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(immutableRunTarget)
  )?.event
  const specificationMatches = () =>
    latestSpecification?._tag === "TaskTrackerFactsObserved" &&
    latestSpecification.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
    latestSpecification.observation.factFamily.fingerprint === subject.observedTaskRevision
  if (!specificationMatches()) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} does not name the latest observed task fingerprint`
    )
  }
}

/** Rejects a direction that was not exposed by the exact prior plan, changed specification, and safe report. */
export const validateAttemptChoice = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  if (record.event._tag !== "AttemptChoiceApplied") return indexes
  const { subject } = record.event
  const prior = historyBefore(records, record.position)
  const attemptRecords = journalRecordsForAttempt(prior, subject.plannedAttempt.attemptId)
  validateAttemptChoiceAuthority({ ...record, event: record.event }, runId, prior, issues)
  if (
    hasMatching(
      attemptRecords,
      ({ event }) =>
        event._tag === "PlannedAttemptReplaced" &&
        plannedTaskAttemptEquivalence(event.subject.plannedAttempt, subject.plannedAttempt)
    )
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} follows the atomic replacement of the same attempt`
    )
  }
  if (
    hasMatching(
      journalRecordsForAttempt(prior, subject.plannedAttempt.attemptId),
      ({ event }) =>
        event._tag === "IntegrationStarted" &&
        event.plannedAttempt.runId === subject.plannedAttempt.runId &&
        event.plannedAttempt.attemptId === subject.plannedAttempt.attemptId
    )
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} follows the exact integration-start cutoff`
    )
  }
  const priorStop = findFirst(
    journalRecordsForAttempt(prior, subject.plannedAttempt.attemptId),
    ({ event }) =>
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "StopTaskImplementation" &&
      plannedTaskAttemptEquivalence(event.subject.plannedAttempt, subject.plannedAttempt)
  )
  if (priorStop !== undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} follows the terminal Stop direction for the same attempt`
    )
  }
  const priorRestart = findFirst(
    journalRecordsForAttempt(prior, subject.plannedAttempt.attemptId),
    ({ event }) =>
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "RestartTaskImplementation" &&
      plannedTaskAttemptEquivalence(event.subject.plannedAttempt, subject.plannedAttempt)
  )
  if (record.event.choice === "ContinueExistingAttempt" && priorRestart !== undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `Continue request ${record.event.requestId.nonce} follows the terminal Restart direction for the same attempt`
    )
  }
  const subjectKey = attemptChoiceSubjectKey(subject)
  if (HashSet.has(indexes.attemptChoiceSubjects, subjectKey)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} follows the winning direction for the same fingerprint pair`
    )
  }
  return { ...indexes, attemptChoiceSubjects: HashSet.add(indexes.attemptChoiceSubjects, subjectKey) }
}

const matchingAppliedStop = (
  prior: JournalHistorySource,
  event: Extract<
    WorkflowJournalEvent,
    {
      readonly _tag:
        | "AttemptImplementationAbandoned"
        | "AttemptStoppageIntended"
        | "StoppedAttemptClaimNoReleaseObserved"
    }
  >
) =>
  findFirst(
    journalRecordsForAttempt(prior, event.subject.plannedAttempt.attemptId),
    (candidate) =>
      candidate.event._tag === "AttemptChoiceApplied" &&
      candidate.event.choice === "StopTaskImplementation" &&
      sameAttemptChoiceRequestId(candidate.event.requestId, event.requestId) &&
      sameAttemptChoiceSubject(candidate.event.subject, event.subject)
  )

const matchingAbandonment = (
  prior: JournalHistorySource,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "StoppedAttemptClaimNoReleaseObserved" }>
) =>
  findLast(
    journalRecordsForAttempt(prior, event.subject.plannedAttempt.attemptId),
    (candidate): candidate is AbandonmentJournalRecord =>
      candidate.event._tag === "AttemptImplementationAbandoned" &&
      sameAttemptChoiceRequestId(candidate.event.requestId, event.requestId) &&
      sameAttemptChoiceSubject(candidate.event.subject, event.subject)
  )

const matchingAppliedStopByRequest = (
  prior: JournalHistorySource,
  requestId: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptChoiceApplied" }>["requestId"]
) =>
  findFirst(
    journalRecordsOfKind(prior, "AttemptChoiceApplied"),
    (record): record is AttemptChoiceRecord =>
      record.event._tag === "AttemptChoiceApplied" &&
      record.event.choice === "StopTaskImplementation" &&
      sameAttemptChoiceRequestId(record.event.requestId, requestId)
  )

type AbandonmentJournalRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptImplementationAbandoned" }>
}

const matchingAbandonmentForAppliedStop = (
  prior: JournalHistorySource,
  appliedStop: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptChoiceApplied" }>
) =>
  findLast(
    journalRecordsForAttempt(prior, appliedStop.subject.plannedAttempt.attemptId),
    (record): record is AbandonmentJournalRecord =>
      record.event._tag === "AttemptImplementationAbandoned" &&
      sameAttemptChoiceRequestId(record.event.requestId, appliedStop.requestId) &&
      sameAttemptChoiceSubject(record.event.subject, appliedStop.subject)
  )

const latestFocusedClaimObservationAfter = (
  prior: JournalHistorySource,
  baselinePosition: JournalPosition,
  taskId: TaskId,
  immutableRunTarget: ReturnType<typeof exactWorkflowRunTargetFor>
) =>
  findLast(
    journalRecordsForTask(prior, taskId),
    ({ event, position }) =>
      position > baselinePosition &&
      immutableRunTarget !== undefined &&
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "FocusedTaskClaimFacts" ||
        event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      event.observation.coverage.taskId === taskId &&
      taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(immutableRunTarget)
  )

const matchingFocusedClaimReadIntentAfter = (
  prior: JournalHistorySource,
  baselinePosition: JournalPosition,
  observationOperationId: OperationId,
  observationPosition: JournalPosition,
  taskId: TaskId
) =>
  findFirst(
    journalRecordsForTask(prior, taskId),
    ({ event, position }) =>
      position > baselinePosition &&
      position < observationPosition &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskClaim" &&
      event.operation.operationId === observationOperationId &&
      event.operation.taskId === taskId
  )?.event

const releaseIntentForOutcome = (
  prior: JournalHistorySource,
  released: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleased" }>
) =>
  findLast(
    journalRecordsForTask(prior, released.release.claim.taskId),
    ({ event }) =>
      event._tag === "TaskClaimReleaseIntended" && event.operation.release.operationId === released.release.operationId
  )

const stoppedReleaseAuthorityForOutcome = (
  prior: JournalHistorySource,
  released: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleased" }>
) => {
  const intent = releaseIntentForOutcome(prior, released)?.event
  return intent?._tag === "TaskClaimReleaseIntended" &&
    intent.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority"
    ? intent.operation.authority
    : undefined
}

const stoppedReleaseOutcomeMatchesRequest = (
  prior: JournalHistorySource,
  released: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleased" }>,
  requestId: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptChoiceApplied" }>["requestId"]
): boolean => {
  const authority = stoppedReleaseAuthorityForOutcome(prior, released)
  return authority !== undefined && sameAttemptChoiceRequestId(authority.requestId, requestId)
}

const proofEvidenceFor = (
  prior: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  proof: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptImplementationAbandoned" }>["proof"]
) =>
  plannedAttemptExecutorEvidence(prior, plannedAttempt).find(
    (evidence) => evidence.source._tag === "AcceptedReport" && evidence.source.ordinal === proof.reportOrdinal
  )

const sameClaimObservation = (
  left: Extract<WorkflowJournalEvent, { readonly _tag: "StoppedAttemptClaimNoReleaseObserved" }>["observation"],
  right: Extract<WorkflowJournalEvent, { readonly _tag: "StoppedAttemptClaimNoReleaseObserved" }>["observation"]
): boolean =>
  left._tag === "ActiveTaskClaim" && right._tag === "ActiveTaskClaim"
    ? isExactTaskClaim(left, right)
    : left._tag === "UnclaimedTask" && right._tag === "UnclaimedTask" && left.taskId === right.taskId

/** Validates Stop chronology and every exact executor/claim authority reference. */
export const validateAttemptStop = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const event = record.event
  const prior = historyBefore(records, record.position)
  const immutableRunTarget = exactWorkflowRunTargetFor(prior)
  const validateStopEventAuthority = () => {
    if (
      event._tag === "AttemptStoppageIntended" ||
      event._tag === "AttemptImplementationAbandoned" ||
      event._tag === "StoppedAttemptClaimNoReleaseObserved"
    ) {
      if (event.requestId.runId !== runId || event.subject.plannedAttempt.runId !== runId) {
        identityIssue(issues, runId, record.position, `attempt Stop request ${event.requestId.nonce} binds another Run`)
      }
      if (matchingAppliedStop(prior, event) === undefined) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `attempt Stop event ${event._tag} requires its exact prior applied Stop choice`
        )
      }
    }
  }
  const validateAbandonment = () => {
    if (event._tag === "AttemptImplementationAbandoned") {
      const evidence = proofEvidenceFor(prior, event.subject.plannedAttempt, event.proof)
      const currentEvidence = latestPlannedAttemptExecutorEvidence(prior, event.subject.plannedAttempt)
      const evidenceProvesQuiescence = () =>
        evidence !== undefined &&
        currentEvidence?.observedAt === evidence.observedAt &&
        evidence.report._tag === "ExecutorWorkSafelySuspended"
      if (!evidenceProvesQuiescence()) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `attempt abandonment for ${event.subject.plannedAttempt.attemptId} requires its exact accepted Safe executor proof`
        )
      } else if (latestUnsettledPlannedAttemptExecutorCommand(prior, event.subject.plannedAttempt) !== undefined) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `attempt abandonment for ${event.subject.plannedAttempt.attemptId} follows a later executor command`
        )
      }
      const authorizedClaim = authorizedClaimForAttempt(prior, event.subject.plannedAttempt)?.claim
      const claimMatches = () => authorizedClaim !== undefined && isExactTaskClaim(authorizedClaim, event.expectedClaim)
      if (!claimMatches()) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `attempt abandonment for ${event.subject.plannedAttempt.attemptId} requires its exact authorized claim`
        )
      }
    }
  }
  const validateNoRelease = () => {
    if (event._tag === "StoppedAttemptClaimNoReleaseObserved") {
      const abandonment = matchingAbandonment(prior, event)
      const abandonmentMatches = () =>
        abandonment?.event._tag === "AttemptImplementationAbandoned" &&
        isExactTaskClaim(abandonment.event.expectedClaim, event.expectedClaim)
      if (!abandonmentMatches() || abandonment === undefined) {
        semanticIssue(issues, runId, record.position, "stopped-attempt no-release requires its exact prior abandonment")
        return
      }
      const validateNoReleaseObservation = () => {
        const latestReleaseIntent = findLast(
          journalRecordsForTask(prior, event.subject.plannedAttempt.taskId),
          ({ event: priorEvent, position }) =>
            position > abandonment.position &&
            priorEvent._tag === "TaskClaimReleaseIntended" &&
            priorEvent.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority" &&
            sameAttemptChoiceRequestId(priorEvent.operation.authority.requestId, event.requestId)
        )
        const baselinePosition = latestReleaseIntent?.position ?? abandonment.position
        const observationRecord = latestFocusedClaimObservationAfter(
          prior,
          baselinePosition,
          event.subject.plannedAttempt.taskId,
          immutableRunTarget
        )
        const observation = observationRecord?.event
        const findObservationIntent = () =>
          observationRecord?.event._tag === "TaskTrackerFactsObserved"
            ? matchingFocusedClaimReadIntentAfter(
                prior,
                baselinePosition,
                observationRecord.event.operationId,
                observationRecord.position,
                event.subject.plannedAttempt.taskId
              )
            : undefined
        const observationIntent = findObservationIntent()
        const observationReadMatchesRunTarget =
          observationRecord !== undefined &&
          claimReadMatchesTarget(
            prior,
            event.observationOperationId,
            event.subject.plannedAttempt.taskId,
            baselinePosition,
            observationRecord.position,
            immutableRunTarget
          )
        const observationMatches = () =>
          observation?._tag !== "TaskTrackerFactsObserved" ||
          observation.observation._tag !== "FocusedTaskClaimFacts" ||
          observation.operationId !== event.observationOperationId ||
          observationIntent?._tag !== "TaskTrackerReadIntentRecorded" ||
          !observationReadMatchesRunTarget ||
          !sameClaimObservation(observation.observation.observation, event.observation)
        if (observationMatches()) {
          semanticIssue(
            issues,
            runId,
            record.position,
            "stopped-attempt no-release requires the latest exact post-baseline claim read"
          )
        }
        const preservesExactClaim = () =>
          event.observation._tag === "ActiveTaskClaim" && isExactTaskClaim(event.observation, event.expectedClaim)
        if (preservesExactClaim()) {
          semanticIssue(
            issues,
            runId,
            record.position,
            "stopped-attempt no-release cannot preserve the exact owned claim"
          )
        }
      }
      validateNoReleaseObservation()
      const priorTerminalDisposition = findFirst(
        journalRecordsForTask(prior, event.subject.plannedAttempt.taskId),
        ({ event: priorEvent, position }) =>
          position > abandonment.position &&
          ((priorEvent._tag === "StoppedAttemptClaimNoReleaseObserved" &&
            sameAttemptChoiceRequestId(priorEvent.requestId, event.requestId) &&
            sameAttemptChoiceSubject(priorEvent.subject, event.subject)) ||
            (priorEvent._tag === "TaskClaimReleased" &&
              stoppedReleaseOutcomeMatchesRequest(prior, priorEvent, event.requestId)))
      )
      if (priorTerminalDisposition !== undefined) {
        semanticIssue(issues, runId, record.position, "stopped-attempt claim disposition is already terminal")
      }
    }
  }
  const validateReleaseIntent = () => {
    if (event._tag === "TaskClaimReleaseIntended") {
      const authority = event.operation.authority
      if (authority._tag === "StoppedAttemptClaimReleaseAuthority") {
        const appliedStop = matchingAppliedStopByRequest(prior, authority.requestId)
        if (appliedStop === undefined) {
          semanticIssue(issues, runId, record.position, "stopped-attempt claim release requires its exact applied Stop")
          return
        }
        const abandonment = matchingAbandonmentForAppliedStop(prior, appliedStop.event)
        if (abandonment === undefined) {
          semanticIssue(
            issues,
            runId,
            record.position,
            "stopped-attempt claim release precedes implementation abandonment"
          )
          return
        }
        if (!isExactTaskClaim(event.operation.release.claim, abandonment.event.expectedClaim)) {
          semanticIssue(
            issues,
            runId,
            record.position,
            "stopped-attempt claim release contradicts its authorized claim"
          )
        }
        const validateReleaseUniqueness = () => {
          if (
            hasMatching(
              journalRecordsForTask(prior, event.operation.release.claim.taskId),
              ({ event: priorEvent, position }) =>
                position > abandonment.position &&
                priorEvent._tag === "TaskClaimReleaseIntended" &&
                priorEvent.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority" &&
                sameAttemptChoiceRequestId(priorEvent.operation.authority.requestId, authority.requestId)
            )
          ) {
            semanticIssue(
              issues,
              runId,
              record.position,
              "stopped-attempt claim release already has one durable intent"
            )
          }
          if (
            hasMatching(
              journalRecordsForTask(prior, event.operation.release.claim.taskId),
              ({ event: priorEvent, position }) =>
                position > abandonment.position &&
                ((priorEvent._tag === "StoppedAttemptClaimNoReleaseObserved" &&
                  sameAttemptChoiceRequestId(priorEvent.requestId, authority.requestId)) ||
                  (priorEvent._tag === "TaskClaimReleased" &&
                    stoppedReleaseOutcomeMatchesRequest(prior, priorEvent, authority.requestId)))
            )
          ) {
            semanticIssue(issues, runId, record.position, "stopped-attempt claim disposition is already terminal")
          }
        }
        validateReleaseUniqueness()
        const validateReleaseObservation = () => {
          const observationRecord = latestFocusedClaimObservationAfter(
            prior,
            abandonment.position,
            appliedStop.event.subject.plannedAttempt.taskId,
            immutableRunTarget
          )
          const observation = observationRecord?.event
          const findObservationIntent = () =>
            observationRecord?.event._tag === "TaskTrackerFactsObserved"
              ? claimReadMatchesTarget(
                  prior,
                  authority.observationOperationId,
                  appliedStop.event.subject.plannedAttempt.taskId,
                  abandonment.position,
                  observationRecord.position,
                  immutableRunTarget
                )
                ? matchingFocusedClaimReadIntentAfter(
                    prior,
                    abandonment.position,
                    observationRecord.event.operationId,
                    observationRecord.position,
                    appliedStop.event.subject.plannedAttempt.taskId
                  )
                : undefined
              : undefined
          const observationIntent = findObservationIntent()
          const observationContradicts = () =>
            observation?._tag !== "TaskTrackerFactsObserved" ||
            observation.observation._tag !== "FocusedTaskClaimFacts" ||
            observation.operationId !== authority.observationOperationId ||
            observationIntent?._tag !== "TaskTrackerReadIntentRecorded" ||
            observation.observation.observation._tag !== "ActiveTaskClaim" ||
            !isExactTaskClaim(observation.observation.observation, abandonment.event.expectedClaim)
          if (observationContradicts()) {
            semanticIssue(
              issues,
              runId,
              record.position,
              "stopped-attempt claim release requires its latest exact post-abandonment claim read"
            )
          }
        }
        validateReleaseObservation()
      } else {
        const abandonedClaim = findLast(
          journalRecordsForTask(prior, event.operation.release.claim.taskId),
          ({ event: priorEvent }) =>
            priorEvent._tag === "AttemptImplementationAbandoned" &&
            isExactTaskClaim(priorEvent.expectedClaim, event.operation.release.claim)
        )
        if (abandonedClaim !== undefined) {
          semanticIssue(
            issues,
            runId,
            record.position,
            "an abandoned attempt claim release requires explicit stopped-attempt authority"
          )
        }
      }
    }
  }
  const validateReleaseOutcome = () => {
    if (event._tag === "TaskClaimReleased") {
      const releaseIntent = releaseIntentForOutcome(prior, event)
      const releaseAuthority = () =>
        releaseIntent?.event._tag === "TaskClaimReleaseIntended" ? releaseIntent.event.operation.authority : undefined
      const authority = releaseAuthority()
      if (authority?._tag === "StoppedAttemptClaimReleaseAuthority") {
        const appliedStop = matchingAppliedStopByRequest(prior, authority.requestId)
        const appliedStopEvent = appliedStop?.event
        const findAbandonment = () =>
          appliedStopEvent?._tag === "AttemptChoiceApplied"
            ? matchingAbandonmentForAppliedStop(prior, appliedStopEvent)
            : undefined
        const abandonment = findAbandonment()
        if (abandonment === undefined) {
          semanticIssue(issues, runId, record.position, "stopped-attempt claim release has no exact prior abandonment")
          return
        }
        const priorTerminalDisposition = findFirst(
          journalRecordsForTask(prior, event.release.claim.taskId),
          ({ event: priorEvent, position }) =>
            position > abandonment.position &&
            ((priorEvent._tag === "StoppedAttemptClaimNoReleaseObserved" &&
              sameAttemptChoiceRequestId(priorEvent.requestId, authority.requestId)) ||
              (priorEvent._tag === "TaskClaimReleased" &&
                stoppedReleaseOutcomeMatchesRequest(prior, priorEvent, authority.requestId)))
        )
        if (priorTerminalDisposition !== undefined) {
          semanticIssue(issues, runId, record.position, "stopped-attempt claim disposition is already terminal")
        }
      }
    }
  }
  validateStopEventAuthority()
  validateAbandonment()
  validateNoRelease()
  validateReleaseIntent()
  validateReleaseOutcome()
  return event._tag === "AttemptImplementationAbandoned"
    ? {
        ...indexes,
        abandonedExecutorAttempts: HashSet.add(
          indexes.abandonedExecutorAttempts,
          event.subject.plannedAttempt.attemptId
        )
      }
    : indexes
}

/**
 * Reuses the canonical Stop/abandonment/claim-disposition validator for a
 * presentation prefix without reconstructing the complete run state. The
 * production reducer remains the owner of these chronology rules; trace
 * readers only need its exact issues before projecting a facet.
 */
export const validateAttemptStopHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<WorkflowJournalHistorySemanticIssue> => {
  const issues = new Array<WorkflowJournalHistorySemanticIssue>()
  let indexes = emptyIndexes()
  for (const record of records) {
    indexes = validateAttemptStop(record, runId, records, indexes, issues)
  }
  return issues
}

export const validateOperationEvent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const next = recordGitReadIntent(record, indexes)
  validateWorktreeObservationIntent(record, runId, indexes, issues)
  validateTargetLineageObservationIntent(record, runId, indexes, issues)
  return validateOperationDescriptor(record, runId, next, issues)
}

/** Validates the generic authorization's causal current-fact witnesses before reconstruction. */
export const validateContinuationAuthorization = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "PlannedAttemptContinuationAuthorized") return
  const event = record.event
  if (event.plannedAttempt.runId !== runId) {
    identityIssue(issues, runId, record.position, "continuation authorization binds another Run")
  }
  const prior = historyBefore(records, record.position)
  const evaluation = evaluatePlannedAttemptContinuationAuthorization(prior, event.plannedAttempt, event.witness)
  if (evaluation._tag === "Rejected") {
    semanticIssue(issues, runId, record.position, evaluation.detail)
  }
}
export const recordGitReadIntent = (record: JournalRecord, indexes: FoldIndexes): FoldIndexes => {
  if (record.event._tag !== "GitReadIntentRecorded") return indexes
  return {
    ...indexes,
    gitReadIntents: HashMap.set(indexes.gitReadIntents, record.event.operation.operationId, record.event.operation)
  }
}

const gitReadOperationForObservation = (
  indexes: FoldIndexes,
  operationId: OperationId
): Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" | "ReadTaskWorktree" }> | undefined => {
  return mapGet(indexes.gitReadIntents, operationId)
}

export const validateWorktreeObservationIntent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag === "PlannedAttemptWorktreeObserved") {
    const intent = gitReadOperationForObservation(indexes, record.event.operationId)
    if (
      intent?._tag !== "ReadTaskWorktree" ||
      !plannedAttemptWorktreeObservationMatchesPlan(record.event.observation, intent.plannedAttempt)
    ) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `worktree observation ${record.event.operationId} requires its exact prior worktree-read intent and planned attempt`
      )
    }
  }
}

export const validateTargetLineageObservationIntent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag === "TargetLineageObserved") {
    const intent = gitReadOperationForObservation(indexes, record.event.operationId)
    if (
      intent?._tag !== "ReadTargetLineage" ||
      !plannedTaskAttemptEquivalence(intent.plannedAttempt, record.event.plannedAttempt)
    ) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `target-lineage observation ${record.event.operationId} requires its exact prior target-lineage-read intent and planned attempt`
      )
    }
  }
}

type RestartAuthorityReadFailureEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "AttemptRestartAuthorityReadFailed" }
>

const restartFailureIntentIsExact = (event: RestartAuthorityReadFailureEvent, intent: JournalRecord | undefined) => {
  const operation =
    /* v8 ignore next -- @preserve Restart authority failure validation accepts only the task-tracker or Git intent selected by its failure tag. */
    intent?.event._tag === "TaskTrackerReadIntentRecorded" || intent?.event._tag === "GitReadIntentRecorded"
      ? intent.event.operation
      : undefined
  return operation !== undefined && restartAuthorityReadOperationMatches(operation, event.failure, event.subject)
}

/** Rejects a forged failure that is not the result of this exact applied Restart read. */
export const validateAttemptRestartAuthorityReadFailure = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "AttemptRestartAuthorityReadFailed") return
  const event = record.event
  const prior = historyBefore(records, record.position)
  const applied = findLast(
    journalRecordsForAttempt(prior, event.subject.plannedAttempt.attemptId),
    ({ event: candidate }) =>
      candidate._tag === "AttemptChoiceApplied" &&
      candidate.choice === "RestartTaskImplementation" &&
      sameAttemptChoiceRequestId(candidate.requestId, event.requestId) &&
      sameAttemptChoiceSubject(candidate.subject, event.subject)
  )
  if (event.subject.plannedAttempt.runId !== runId || applied === undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      "Restart authority read failure requires its exact prior applied Restart"
    )
  }
  const intent = findLast(
    journalRecordsForTask(prior, event.subject.plannedAttempt.taskId),
    ({ event: candidate }) =>
      (candidate._tag === "TaskTrackerReadIntentRecorded" || candidate._tag === "GitReadIntentRecorded") &&
      candidate.operation.operationId === event.operationId
  )
  if (
    applied === undefined ||
    intent === undefined ||
    intent.position <= applied.position ||
    !restartFailureIntentIsExact(event, intent)
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `Restart authority read failure ${event.operationId} requires its exact prior task or Git read intent`
    )
  }
}

export const validateOperationDescriptor = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag !== "OperationEventDescriptor") return indexes
  validateRequiredOperationIds(record, runId, indexes, issues, descriptor)
  validateRequiredPredecessorKinds(record, runId, indexes, issues, descriptor)
  validateRequiredRecordPredecessor(record, runId, indexes, issues, descriptor)
  const previousKinds = mapGet(indexes.seenEventKindsByOperation, descriptor.operationId) ?? HashSet.empty()
  return {
    ...indexes,
    seenOperationIds: HashSet.add(indexes.seenOperationIds, descriptor.operationId),
    seenEventKindsByOperation: HashMap.set(
      indexes.seenEventKindsByOperation,
      descriptor.operationId,
      HashSet.add(previousKinds, record.event._tag)
    )
  }
}

type OperationEventDescriptor = Extract<
  ReturnType<typeof describeJournalEvent>,
  { readonly _tag: "OperationEventDescriptor" }
>

const validateRequiredOperationIds = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>,
  descriptor: OperationEventDescriptor
): void => {
  for (const requiredOperationId of descriptor.requiredOperationIds) {
    if (!HashSet.has(indexes.seenOperationIds, requiredOperationId)) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `event ${record.event._tag} requires prior operation ${requiredOperationId}`
      )
    }
  }
}

const validateRequiredPredecessorKinds = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>,
  descriptor: OperationEventDescriptor
): void => {
  for (const requiredKind of descriptor.requiredPredecessorKinds) {
    const kinds = mapGet(indexes.seenEventKindsByOperation, descriptor.operationId)
    if (kinds === undefined || !HashSet.has(kinds, requiredKind)) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `event ${record.event._tag} requires prior ${requiredKind} for operation ${descriptor.operationId}`
      )
    }
  }
  for (const alternatives of descriptor.requiredPredecessorKindAlternatives) {
    const kinds = mapGet(indexes.seenEventKindsByOperation, descriptor.operationId)
    if (kinds === undefined || !alternatives.some((requiredKind) => HashSet.has(kinds, requiredKind))) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `event ${record.event._tag} requires one of ${alternatives.join(", ")} for operation ${descriptor.operationId}`
      )
    }
  }
}

const validateRequiredRecordPredecessor = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>,
  descriptor: OperationEventDescriptor
): void => {
  if (
    descriptor.recordPredecessor._tag === "RequiredRecordPredecessor" &&
    !HashSet.has(indexes.seenKeys, descriptor.recordPredecessor.key)
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `event ${record.event._tag} has no prior record ${descriptor.recordPredecessor.key}`
    )
  }
}

type PlannedAttemptReplacementRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptReplaced" }>
}

type TaskTrackerFactsEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>
type ReplacementGraphFacts = Extract<
  TaskTrackerFactsEvent["observation"],
  { readonly _tag: "CompleteTaskTrackerFacts" | "UnchangedTaskTrackerFactsReconfirmed" }
>
type ReplacementSpecificationFacts = Extract<
  TaskTrackerFactsEvent["observation"],
  { readonly _tag: "FocusedTaskWorkSpecificationFacts" }
>
type ReplacementClaimFacts = Extract<TaskTrackerFactsEvent["observation"], { readonly _tag: "FocusedTaskClaimFacts" }>
type TaskTrackerFactsRecord<Observation extends TaskTrackerFactsEvent["observation"]> = Omit<JournalRecord, "event"> & {
  readonly event: TaskTrackerFactsEvent & { readonly observation: Observation }
}
type ReplacementWorktreeRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptWorktreeObserved" }>
}
type ReplacementTargetRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TargetLineageObserved" }>
}
type ReplacementTrackerReadIntent = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerReadIntentRecorded" }>
}
type ReplacementGitReadIntent = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "GitReadIntentRecorded" }>
}

const freshReplacementTrackerReadIntent = (
  prior: JournalHistorySource,
  operationId: OperationId,
  applicationPosition: JournalPosition
): ReplacementTrackerReadIntent | undefined =>
  findLast(
    journalRecordsForOperationId(prior, operationId),
    (record): record is ReplacementTrackerReadIntent =>
      record.position > applicationPosition &&
      record.event._tag === "TaskTrackerReadIntentRecorded" &&
      record.event.operation.operationId === operationId
  )

const freshReplacementGitReadIntent = (
  prior: JournalHistorySource,
  operationId: OperationId,
  applicationPosition: JournalPosition
): ReplacementGitReadIntent | undefined =>
  findLast(
    journalRecordsForOperationId(prior, operationId),
    (record): record is ReplacementGitReadIntent =>
      record.position > applicationPosition &&
      record.event._tag === "GitReadIntentRecorded" &&
      record.event.operation.operationId === operationId
  )

const replacementGraphIntentIsExact = (
  intent: ReplacementTrackerReadIntent | undefined,
  taskId: TaskId,
  trackerTarget: string
): boolean => {
  const operation = intent?.event.operation
  return (
    operation?._tag === "ReadTrackerGraph" &&
    taskTrackerTargetKey(operation.target) === trackerTarget &&
    operation.readShape.explicitlyCoveredTaskIds.includes(taskId)
  )
}

const replacementFocusedIntentIsExact = (
  intent: ReplacementTrackerReadIntent | undefined,
  expectedTag: "ReadTaskClaim" | "ReadTaskWorkSpecification",
  taskId: TaskId,
  trackerTarget: string
): boolean => {
  const operation = intent?.event.operation
  return (
    operation?._tag === expectedTag &&
    taskTrackerTargetKey(operation.target) === trackerTarget &&
    operation.taskId === taskId
  )
}

const replacementGitIntentIsExact = (
  intent: ReplacementGitReadIntent | undefined,
  expectedTag: "ReadTargetLineage" | "ReadTaskWorktree",
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const operation = intent?.event.operation
  return operation?._tag === expectedTag && plannedTaskAttemptEquivalence(operation.plannedAttempt, plannedAttempt)
}

const replacementReadIntentPredecessorsAreExact = (
  graph: ReplacementTrackerReadIntent | undefined,
  specification: ReplacementTrackerReadIntent | undefined,
  claim: ReplacementTrackerReadIntent | undefined,
  worktree: ReplacementGitReadIntent | undefined,
  target: ReplacementGitReadIntent | undefined,
  witness: PlannedAttemptReplacementRecord["event"]["witness"]
): boolean =>
  [
    specification?.event.operation.predecessorOperationIds.includes(witness.graphObservationOperationId) === true,
    claim?.event.operation.predecessorOperationIds.includes(witness.graphObservationOperationId) === true,
    claim?.event.operation.predecessorOperationIds.includes(witness.specificationObservationOperationId) === true,
    worktree?.event.operation.predecessorOperationIds.includes(witness.graphObservationOperationId) === true,
    worktree?.event.operation.predecessorOperationIds.includes(witness.specificationObservationOperationId) === true,
    worktree?.event.operation.predecessorOperationIds.includes(witness.claimObservationOperationId) === true,
    target?.event.operation.predecessorOperationIds.includes(witness.oldWorktreeObservationOperationId) === true,
    graph !== undefined
  ].every(Boolean)

const replacementReadIntentsAreFreshAndExact = (
  prior: JournalHistorySource,
  event: PlannedAttemptReplacementRecord["event"],
  applicationPosition: JournalPosition
): boolean => {
  const { plannedAttempt } = event.subject
  const { witness } = event
  const graph = freshReplacementTrackerReadIntent(prior, witness.graphObservationOperationId, applicationPosition)
  const specification = freshReplacementTrackerReadIntent(
    prior,
    witness.specificationObservationOperationId,
    applicationPosition
  )
  const claim = freshReplacementTrackerReadIntent(prior, witness.claimObservationOperationId, applicationPosition)
  const worktree = freshReplacementGitReadIntent(prior, witness.oldWorktreeObservationOperationId, applicationPosition)
  const target = freshReplacementGitReadIntent(prior, witness.targetLineageObservationOperationId, applicationPosition)
  const began = firstJournalRecordOfKind(prior, "WorkflowRunBegan")?.event
  /* v8 ignore next -- @preserve An accepted PlannedAttemptReplaced history is anchored to the prior WorkflowRunBegan authority. */
  if (began?._tag !== "WorkflowRunBegan") return false
  const trackerTarget = taskTrackerTargetKey(began.target)
  return [
    replacementGraphIntentIsExact(graph, plannedAttempt.taskId, trackerTarget),
    replacementFocusedIntentIsExact(specification, "ReadTaskWorkSpecification", plannedAttempt.taskId, trackerTarget),
    replacementFocusedIntentIsExact(claim, "ReadTaskClaim", plannedAttempt.taskId, trackerTarget),
    replacementGitIntentIsExact(worktree, "ReadTaskWorktree", plannedAttempt),
    replacementGitIntentIsExact(target, "ReadTargetLineage", plannedAttempt),
    replacementReadIntentPredecessorsAreExact(graph, specification, claim, worktree, target, witness)
  ].every(Boolean)
}

const isReplacementGraphFacts = (
  observation: TaskTrackerFactsEvent["observation"]
): observation is ReplacementGraphFacts =>
  observation._tag === "CompleteTaskTrackerFacts" || observation._tag === "UnchangedTaskTrackerFactsReconfirmed"

const isReplacementGraphRecord = (
  record: JournalRecord,
  operationId: OperationId
): record is TaskTrackerFactsRecord<ReplacementGraphFacts> => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return false
  return record.event.operationId === operationId && isReplacementGraphFacts(record.event.observation)
}

const isReplacementSpecificationRecord = (
  record: JournalRecord,
  operationId: OperationId
): record is TaskTrackerFactsRecord<ReplacementSpecificationFacts> => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return false
  return (
    record.event.operationId === operationId && record.event.observation._tag === "FocusedTaskWorkSpecificationFacts"
  )
}

const isReplacementClaimRecord = (
  record: JournalRecord,
  operationId: OperationId
): record is TaskTrackerFactsRecord<ReplacementClaimFacts> => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return false
  return record.event.operationId === operationId && record.event.observation._tag === "FocusedTaskClaimFacts"
}

const isReplacementWorktreeRecord = (
  record: JournalRecord,
  operationId: OperationId
): record is ReplacementWorktreeRecord =>
  record.event._tag === "PlannedAttemptWorktreeObserved" && record.event.operationId === operationId

const isReplacementTargetRecord = (
  record: JournalRecord,
  operationId: OperationId
): record is ReplacementTargetRecord =>
  record.event._tag === "TargetLineageObserved" && record.event.operationId === operationId

const replacementGraphIsExact = (
  prior: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  operationId: OperationId,
  applicationPosition: JournalPosition
): boolean => {
  const record = findLast(
    isJournalRecordEvidence(prior)
      ? journalRecordsForOperationId(prior, operationId)
      : journalRecordsForTask(prior, plannedAttempt.taskId),
    (candidate) => isReplacementGraphRecord(candidate, operationId)
  )
  if (record === undefined) return false
  if (record.position <= applicationPosition) return false
  if (
    hasMatching(
      journalRecordsForTask(prior, plannedAttempt.taskId),
      ({ event, position }) =>
        position > record.position &&
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTrackerGraph" &&
        event.operation.readShape.explicitlyCoveredTaskIds.includes(plannedAttempt.taskId) &&
        taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(record.event.observation.target)
    )
  ) {
    return false
  }
  const graphState = reconstructedTaskGraphFromEvents(
    Array.from(journalRecordsForTask(prior, plannedAttempt.taskId))
      .filter(({ position }) => position <= record.position)
      .map(({ event }) => event),
    record.event.observation.target
  )
  return Option.exists(graphState, (snapshot) =>
    snapshot.eligibleTasks().some(({ id }) => id === plannedAttempt.taskId)
  )
}

const replacementSpecificationIsExact = (
  prior: JournalHistorySource,
  subject: PlannedAttemptReplacementRecord["event"]["subject"],
  operationId: OperationId,
  applicationPosition: JournalPosition
): boolean => {
  const record = findLast(
    isJournalRecordEvidence(prior)
      ? journalRecordsForOperationId(prior, operationId)
      : journalRecordsForTask(prior, subject.plannedAttempt.taskId),
    (candidate) => isReplacementSpecificationRecord(candidate, operationId)
  )
  if (record === undefined) return false
  if (record.position <= applicationPosition) return false
  const intent = freshReplacementTrackerReadIntent(prior, operationId, applicationPosition)
  if (intent?.event.operation._tag !== "ReadTaskWorkSpecification") return false
  if (
    hasMatching(
      journalRecordsForTask(prior, subject.plannedAttempt.taskId),
      ({ event, position }) =>
        position > record.position &&
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTaskWorkSpecification" &&
        event.operation.taskId === subject.plannedAttempt.taskId &&
        taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(intent.event.operation.target)
    )
  ) {
    return false
  }
  return [
    record.event.observation.factFamily.taskId === subject.plannedAttempt.taskId,
    record.event.observation.factFamily.fingerprint === subject.observedTaskRevision
  ].every(Boolean)
}

const replacementClaimIsExact = (
  prior: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptReplacementRecord["event"]["witness"],
  application: RestartApplicationRecord
): boolean => {
  const record = findLast(
    isJournalRecordEvidence(prior)
      ? journalRecordsForOperationId(prior, witness.claimObservationOperationId)
      : journalRecordsForTask(prior, plannedAttempt.taskId),
    (candidate) => isReplacementClaimRecord(candidate, witness.claimObservationOperationId)
  )
  if (record === undefined) return false
  if (record.position <= application.position) return false
  const intent = freshReplacementTrackerReadIntent(prior, witness.claimObservationOperationId, application.position)
  if (intent?.event.operation._tag !== "ReadTaskClaim") return false
  if (
    hasMatching(
      journalRecordsForTask(prior, plannedAttempt.taskId),
      ({ event, position }) =>
        position > record.position &&
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTaskClaim" &&
        event.operation.taskId === plannedAttempt.taskId &&
        taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(intent.event.operation.target)
    )
  ) {
    return false
  }
  const observation = record.event.observation.observation
  if (observation._tag !== "ActiveTaskClaim") return false
  const authorizedClaim = restartClaimAuthorityAtApplication(prior, application)
  if (authorizedClaim === undefined) return false
  return [
    isExactTaskClaim(observation, witness.expectedClaim),
    isExactTaskClaim(authorizedClaim.claim, witness.expectedClaim)
  ].every(Boolean)
}

export const replacementResourceConflict = (
  event: WorkflowJournalEvent,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptReplacementRecord["event"]["witness"]
): boolean => {
  if (event._tag === "TaskClaimReacquisitionDirected") {
    return event.subject.runId === plannedAttempt.runId && event.subject.taskId === plannedAttempt.taskId
  }
  if (event._tag === "TaskClaimAcquisitionIntended") {
    return event.operation.acquisition.taskId === plannedAttempt.taskId
  }
  if (event._tag === "TaskClaimReleaseIntended") {
    return isExactTaskClaim(event.operation.release.claim, witness.expectedClaim)
  }
  if (event._tag === "TaskClaimReleased") {
    return isExactTaskClaim(event.release.claim, witness.expectedClaim)
  }
  return (
    event._tag === "TaskWorktreeReconciliationIntended" &&
    plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plannedAttempt)
  )
}

const replacementPreservesPriorResources = (
  prior: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptReplacementRecord["event"]["witness"],
  applicationPosition: JournalPosition
): boolean =>
  !hasMatching(journalRecordsForTask(prior, plannedAttempt.taskId), ({ event, position }) => {
    if (position <= applicationPosition) return false
    return replacementResourceConflict(event, plannedAttempt, witness)
  })

const replacementWorktreeIsExact = (
  prior: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptReplacementRecord["event"]["witness"],
  applicationPosition: JournalPosition
): boolean => {
  const record = findLast(journalRecordsForOperationId(prior, witness.oldWorktreeObservationOperationId), (candidate) =>
    isReplacementWorktreeRecord(candidate, witness.oldWorktreeObservationOperationId)
  )
  if (record === undefined) return false
  if (record.position <= applicationPosition) return false
  if (
    hasMatching(
      journalRecordsForAttempt(prior, plannedAttempt.attemptId),
      ({ event, position }) =>
        position > record.position &&
        event._tag === "GitReadIntentRecorded" &&
        event.operation._tag === "ReadTaskWorktree" &&
        plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plannedAttempt)
    )
  ) {
    return false
  }
  if (record.event.observation._tag !== "PlannedWorktreeReady") return false
  return [
    record.event.observation.baseSha === witness.oldWorktreeProof.baseSha,
    record.event.observation.branch === witness.oldWorktreeProof.branch,
    record.event.observation.headSha === witness.oldWorktreeProof.headSha,
    record.event.observation.worktree === witness.oldWorktreeProof.worktree
  ].every(Boolean)
}

type IntegrationTargetAuthority = Extract<
  WorkflowOperation,
  { readonly _tag: "ReadTargetLineage" }
>["integrationTarget"]

const sameIntegrationTarget = (left: IntegrationTargetAuthority, right: IntegrationTargetAuthority): boolean =>
  left.repository === right.repository && left.ref === right.ref

const isLaterTargetLineageRead = (
  event: WorkflowJournalEvent,
  target: IntegrationTargetAuthority,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  event._tag === "GitReadIntentRecorded" &&
  event.operation._tag === "ReadTargetLineage" &&
  plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plannedAttempt) &&
  sameIntegrationTarget(event.operation.integrationTarget, target)

const isLaterTargetAuthority =
  (baselinePosition: JournalPosition, target: IntegrationTargetAuthority, plannedAttempt: PlannedTaskAttempt) =>
  ({ event, position }: JournalRecord): boolean =>
    position > baselinePosition && isLaterTargetLineageRead(event, target, plannedAttempt)

const replacementTargetIsExact = (
  prior: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptReplacementRecord["event"]["witness"],
  applicationPosition: JournalPosition
): boolean => {
  const record = findLast(
    isJournalRecordEvidence(prior)
      ? journalRecordsForOperationId(prior, witness.targetLineageObservationOperationId)
      : journalRecordsForAttempt(prior, plannedAttempt.attemptId),
    (candidate) => isReplacementTargetRecord(candidate, witness.targetLineageObservationOperationId)
  )
  if (record === undefined) return false
  if (record.position <= applicationPosition) return false
  const intent = freshReplacementGitReadIntent(prior, witness.targetLineageObservationOperationId, applicationPosition)
  if (intent?.event.operation._tag !== "ReadTargetLineage") return false
  const currentTarget = intent.event.operation.integrationTarget
  if (
    hasMatching(
      journalRecordsForAttempt(prior, plannedAttempt.attemptId),
      isLaterTargetAuthority(record.position, currentTarget, plannedAttempt)
    )
  ) {
    return false
  }
  return [
    plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt),
    record.event.observation.targetHeadSha === witness.targetHeadSha
  ].every(Boolean)
}

const plannedAttemptReplacementFactsAreExact = (
  record: PlannedAttemptReplacementRecord,
  prior: JournalHistorySource,
  application: AppliedRestartRecord
): boolean => {
  const event = record.event
  const { plannedAttempt } = event.subject
  const { witness } = event
  const immutableRunTarget = exactWorkflowRunTargetFor(prior)
  if (immutableRunTarget === undefined) return false
  return [
    !restartChoiceWasInvalidatedByLaterSpecification(prior, application.position, event.subject, immutableRunTarget),
    replacementPreservesPriorResources(prior, plannedAttempt, witness, application.position),
    replacementReadIntentsAreFreshAndExact(prior, event, application.position),
    replacementGraphIsExact(prior, plannedAttempt, witness.graphObservationOperationId, application.position),
    replacementSpecificationIsExact(
      prior,
      event.subject,
      witness.specificationObservationOperationId,
      application.position
    ),
    replacementClaimIsExact(prior, plannedAttempt, witness, application),
    replacementWorktreeIsExact(prior, plannedAttempt, witness, application.position),
    replacementTargetIsExact(prior, plannedAttempt, witness, application.position)
  ].every(Boolean)
}

type AppliedRestartRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "RestartTaskImplementation"
  }
}

const appliedRestartForReplacement = (
  prior: JournalHistorySource,
  event: PlannedAttemptReplacementRecord["event"]
): AppliedRestartRecord | undefined =>
  findLast(
    journalRecordsForAttempt(prior, event.subject.plannedAttempt.attemptId),
    (record): record is AppliedRestartRecord => {
      if (record.event._tag !== "AttemptChoiceApplied") return false
      return [
        record.event.choice === "RestartTaskImplementation",
        sameAttemptChoiceRequestId(record.event.requestId, event.requestId),
        sameAttemptChoiceSubject(record.event.subject, event.subject)
      ].every(Boolean)
    }
  )

const replacementBindsRun = (event: PlannedAttemptReplacementRecord["event"], runId: RunId): boolean =>
  [event.requestId.runId === runId, event.subject.plannedAttempt.runId === runId].every(Boolean)

export const replacementFollowsIntegrationCutoff = (
  prior: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  hasMatching(journalRecordsForAttempt(prior, plannedAttempt.attemptId), ({ event }) => {
    if (event._tag !== "IntegrationStarted") return false
    return [
      event.plannedAttempt.runId === plannedAttempt.runId,
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
    ].every(Boolean)
  })

type ReplacementQuiescenceEvidence = NonNullable<ReturnType<typeof proofEvidenceFor>>

export const replacementProofIsAcceptedSafe = (proof: ReplacementQuiescenceEvidence): boolean =>
  proof.report._tag === "ExecutorWorkSafelySuspended"

const replacementHasNoUnsettledCommand = (prior: JournalHistorySource, plannedAttempt: PlannedTaskAttempt): boolean =>
  latestUnsettledPlannedAttemptExecutorCommand(prior, plannedAttempt) === undefined

const replacementQuiescenceIsCurrent = (
  prior: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  quiescenceProof: PlannedAttemptReplacementRecord["event"]["witness"]["quiescenceProof"]
): boolean => {
  const proof = proofEvidenceFor(prior, plannedAttempt, quiescenceProof)
  if (proof === undefined) return false
  const latestEvidence = latestPlannedAttemptExecutorEvidence(prior, plannedAttempt)
  return [
    latestEvidence?.observedAt === proof.observedAt,
    replacementHasNoUnsettledCommand(prior, plannedAttempt),
    replacementProofIsAcceptedSafe(proof)
  ].every(Boolean)
}

/** Validates the one atomic P1-supersession/P2-plan chronology and its fresh authorities. */
export const validatePlannedAttemptReplacement = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  if (record.event._tag !== "PlannedAttemptReplaced") return indexes
  const event = record.event
  const prior = historyBefore(records, record.position)
  if (!replacementBindsRun(event, runId)) {
    identityIssue(
      issues,
      runId,
      record.position,
      `planned-attempt replacement ${event.requestId.nonce} binds another Run`
    )
  }
  const applied = appliedRestartForReplacement(prior, event)
  if (applied === undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      "PlannedAttemptReplaced requires its exact prior applied Restart choice"
    )
    return indexes
  }
  const priorAttempt = event.subject.plannedAttempt
  /* v8 ignore next -- @preserve Journal record-key uniqueness rejects a second successor before semantic replacement validation. */
  if (HashSet.has(indexes.supersededExecutorAttempts, priorAttempt.attemptId)) {
    semanticIssue(issues, runId, record.position, `attempt ${priorAttempt.attemptId} already has a recorded successor`)
  }
  /* v8 ignore next -- @preserve The integration-start record owns this exact attempt and prevents its Restart controller from allocating a successor. */
  if (replacementFollowsIntegrationCutoff(prior, priorAttempt)) {
    semanticIssue(issues, runId, record.position, "PlannedAttemptReplaced follows the exact integration-start cutoff")
  }
  if (!replacementQuiescenceIsCurrent(prior, priorAttempt, event.witness.quiescenceProof)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      "PlannedAttemptReplaced requires current unbroken accepted Safe suspension"
    )
  }
  if (!plannedAttemptReplacementFactsAreExact({ ...record, event }, prior, applied)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      "PlannedAttemptReplaced lacks exact fresh F2, K1, W1, or H2 authority"
    )
  }
  return {
    ...indexes,
    supersededExecutorAttempts: HashSet.add(indexes.supersededExecutorAttempts, priorAttempt.attemptId)
  }
}

export const validatePlan = (
  record: JournalRecord,
  runId: RunId,
  recordsThroughPlan: JournalHistorySource,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  if (record.event._tag !== "TaskAttemptPlanned" && record.event._tag !== "PlannedAttemptReplaced") return indexes
  const plannedAttempt =
    record.event._tag === "TaskAttemptPlanned"
      ? record.event.operation.plannedAttempt
      : record.event.successorPlan.plannedAttempt
  if (record.event._tag === "TaskAttemptPlanned") {
    if (acceptedFreshAttemptLineage(recordsThroughPlan, plannedAttempt, "Plan") === undefined) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `planned attempt ${plannedAttempt.attemptId} requires exact claim, post-claim graph, and focused specification lineage`
      )
    }
  }
  const prior = mapGet(indexes.plans, plannedAttempt.attemptId)
  if (prior !== undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      plannedTaskAttemptEquivalence(prior, plannedAttempt)
        ? `duplicate planned task attempt for attempt ${plannedAttempt.attemptId}`
        : `contradictory planned task attempts for attempt ${plannedAttempt.attemptId}`
    )
    return indexes
  }
  return { ...indexes, plans: HashMap.set(indexes.plans, plannedAttempt.attemptId, plannedAttempt) }
}
