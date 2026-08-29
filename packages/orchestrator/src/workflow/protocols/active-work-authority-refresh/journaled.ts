import { plannedTaskAttemptEquivalence, type RunId } from "@dalph/contracts"
import { Cause, Effect } from "effect"
import type { GitTargetLineageReadFailure } from "../../../authorities/git/target-lineage.js"
import type { GitWorktreeReadFailure } from "../../../authorities/git/worktree.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTargetLineageObserved,
  InterruptibleWorkflowBoundaryIntent,
  runInterruptibleBoundary,
  type InterruptibleWorkflowBoundaryExecution,
  type WorkflowInterpreterService
} from "../../interpretation/interpreter.js"
import {
  ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent
} from "../../registry/event.js"
import type { WorkflowOperation as WorkflowOperationType } from "../../registry/operation.js"
import {
  ActiveWorkAuthorityRefreshAuthority,
  ActiveWorkAuthorityRefreshGitReadFailedEvent,
  ActiveWorkAuthorityRefreshOrdinal,
  makeActiveWorkAuthorityRefreshGitReadOperation,
  type ActiveWorkAuthorityRefreshGitReadOperation,
  type ActiveWorkAuthorityRefreshSource
} from "./events.js"
import {
  activeWorkAuthorityRefreshGitReadFailedRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import type { InRunJournalService, JournalAppendError, JournalRecord } from "../../../workflow-journal/store.js"

type GitReadOperation = Extract<WorkflowOperationType, { readonly _tag: "ReadTaskWorktree" | "ReadTargetLineage" }>
type ActiveRefreshGitReadFailure = GitWorktreeReadFailure | GitTargetLineageReadFailure

type ActiveRefreshIdentity = {
  readonly authority: ActiveWorkAuthorityRefreshAuthority
  readonly operation: ActiveWorkAuthorityRefreshGitReadOperation
  readonly ordinal: ActiveWorkAuthorityRefreshOrdinal
}

/** An ordinary Git intent keeps a captured read on the ordinary journal protocol. */
export const ordinaryGitReadIntentWasRecorded = (
  records: ReadonlyArray<JournalRecord>,
  operation: GitReadOperation
): boolean =>
  records.some(
    ({ event }) =>
      event._tag === "GitReadIntentRecorded" &&
      event.operation.operationId === operation.operationId &&
      event.operation._tag === operation._tag &&
      plannedTaskAttemptEquivalence(event.operation.plannedAttempt, operation.plannedAttempt)
  )

const activeRefreshFailureFor = (
  records: ReadonlyArray<JournalRecord>,
  operation: GitReadOperation
): Extract<JournalRecord["event"], { readonly _tag: "ActiveWorkAuthorityRefreshGitReadFailed" }> | undefined => {
  const record = records.findLast(
    ({ event }) =>
      event._tag === "ActiveWorkAuthorityRefreshGitReadFailed" && event.operation.operationId === operation.operationId
  )
  return record?.event._tag === "ActiveWorkAuthorityRefreshGitReadFailed" ? record.event : undefined
}

const makeActiveRefreshIdentity = (
  records: ReadonlyArray<JournalRecord>,
  operation: GitReadOperation
): ActiveRefreshIdentity => {
  const priorIntent = records.findLast(
    ({ event }) =>
      event._tag === "ActiveWorkAuthorityRefreshGitReadIntentRecorded" &&
      event.operation.operationId === operation.operationId
  )
  if (priorIntent?.event._tag === "ActiveWorkAuthorityRefreshGitReadIntentRecorded") {
    return {
      authority: priorIntent.event.operation.authority,
      operation: priorIntent.event.operation,
      ordinal: priorIntent.event.operation.ordinal
    }
  }
  const authority = ActiveWorkAuthorityRefreshAuthority.make({
    attemptId: operation.plannedAttempt.attemptId,
    runId: operation.plannedAttempt.runId
  })
  const latestDurableOrdinal = records.reduce(
    (latest, { event }) =>
      event._tag === "ActiveWorkAuthorityRefreshGitReadIntentRecorded" &&
      event.operation.authority.attemptId === operation.plannedAttempt.attemptId &&
      event.operation.authority.runId === operation.plannedAttempt.runId
        ? Math.max(latest, event.operation.ordinal)
        : latest,
    0
  )
  const ordinal = ActiveWorkAuthorityRefreshOrdinal.make(latestDurableOrdinal + 1)
  const activeOperation = makeActiveWorkAuthorityRefreshGitReadOperation(operation, authority, ordinal)
  return { authority, operation: activeOperation, ordinal }
}

const recordActiveRefreshGitReadFailure = <Failure extends ActiveRefreshGitReadFailure>(
  journal: InRunJournalService,
  runId: RunId,
  operation: GitReadOperation,
  identity: ActiveRefreshIdentity,
  source: ActiveWorkAuthorityRefreshSource,
  failure: Failure
): Effect.Effect<never, JournalAppendError | Failure> =>
  journal
    .append(
      runId,
      activeWorkAuthorityRefreshGitReadFailedRecordKey(operation.operationId, identity.ordinal),
      ActiveWorkAuthorityRefreshGitReadFailedEvent.make({
        authority: identity.authority,
        failure,
        occurrenceClassification: "NonActionOccurrence",
        operation: identity.operation,
        ordinal: identity.ordinal,
        source,
        version: workflowJournalEventVersion
      })
    )
    .pipe(Effect.andThen(Effect.fail(failure)))

type ActiveRefreshGitReadState = {
  readonly boundary: InterruptibleWorkflowBoundaryExecution | undefined
  readonly journal: InRunJournalService
  readonly onIntentRecorded: Effect.Effect<void> | undefined
  readonly operation: GitReadOperation
  readonly runId: RunId
  readonly source: ActiveWorkAuthorityRefreshSource
}

type ActiveRefreshGitReadCallbacks<Result, Failure extends ActiveRefreshGitReadFailure> = {
  readonly appendObserved: (result: Result) => Effect.Effect<Result, JournalAppendError>
  readonly failureFor: (failure: ActiveRefreshGitReadFailure | JournalAppendError) => Failure | undefined
  readonly read: (
    recordFailure: (failure: Failure) => Effect.Effect<never, Failure | JournalAppendError>
  ) => Effect.Effect<Result, Failure | JournalAppendError>
  readonly replay: (records: ReadonlyArray<JournalRecord>) => Result | undefined
}

type ActiveRefreshGitReadOptions<Result, Failure extends ActiveRefreshGitReadFailure> = ActiveRefreshGitReadState &
  ActiveRefreshGitReadCallbacks<Result, Failure>

const isActiveWorktreeReadFailure = (
  failure: ActiveRefreshGitReadFailure | JournalAppendError
): GitWorktreeReadFailure | undefined => (failure._tag === "GitWorktreeReadFailure" ? failure : undefined)

const isActiveTargetLineageReadFailure = (
  failure: ActiveRefreshGitReadFailure | JournalAppendError
): GitTargetLineageReadFailure | undefined => (failure._tag === "GitTargetLineageReadFailure" ? failure : undefined)

/** Journal-first active-refresh Git read with durable replay and failure identity. */
const runActiveWorkAuthorityRefreshGitRead = <Result, Failure extends ActiveRefreshGitReadFailure>(
  options: ActiveRefreshGitReadOptions<Result, Failure>
): Effect.Effect<Result, Failure | JournalAppendError> =>
  Effect.gen<Effect.Effect<unknown, Failure | JournalAppendError>, Result>(function* () {
    const records = yield* options.journal.read(options.runId)
    const identity = makeActiveRefreshIdentity(records, options.operation)
    yield* Effect.uninterruptible(
      options.journal
        .append(
          options.runId,
          intentRecordKey(options.operation.operationId),
          ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent.make({
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            operation: identity.operation,
            version: workflowJournalEventVersion
          })
        )
        .pipe(Effect.andThen(options.onIntentRecorded ?? Effect.void))
    )
    const existingRecords = yield* options.journal.read(options.runId)
    const existing = options.replay(existingRecords)
    if (existing !== undefined) return existing
    const priorFailure = activeRefreshFailureFor(existingRecords, options.operation)
    const priorTypedFailure = priorFailure === undefined ? undefined : options.failureFor(priorFailure.failure)
    if (priorTypedFailure !== undefined) {
      return yield* Effect.failCause(Cause.fail(priorTypedFailure))
    }
    const read = options.read((failure) =>
      recordActiveRefreshGitReadFailure(
        options.journal,
        options.runId,
        options.operation,
        identity,
        options.source,
        failure
      )
    )
    return yield* runInterruptibleBoundary(
      options.boundary,
      InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
        family: "Git",
        operationId: options.operation.operationId
      }),
      read,
      options.appendObserved
    )
  })

type ActiveRefreshWorktreeReadOptions = {
  readonly boundary: InterruptibleWorkflowBoundaryExecution | undefined
  readonly interpreter: WorkflowInterpreterService
  readonly journal: InRunJournalService
  readonly onIntentRecorded?: Effect.Effect<void>
  readonly operation: Extract<WorkflowOperationType, { readonly _tag: "ReadTaskWorktree" }>
  readonly runId: RunId
  readonly source: ActiveWorkAuthorityRefreshSource
}

/** Journals one active-refresh worktree read and its exact non-action outcome. */
export const runActiveWorktreeAuthorityRefreshGitRead = (
  options: ActiveRefreshWorktreeReadOptions
): Effect.Effect<
  typeof AuthoritativePlannedAttemptWorktreeObserved.Type,
  GitWorktreeReadFailure | JournalAppendError
> =>
  runActiveWorkAuthorityRefreshGitRead({
    appendObserved: (result) =>
      options.journal
        .append(
          options.runId,
          outcomeRecordKey(options.operation.operationId),
          PlannedAttemptWorktreeObservedEvent.make({
            observation: result.observation,
            occurrenceClassification: "NonActionOccurrence",
            operationId: options.operation.operationId,
            version: workflowJournalEventVersion
          })
        )
        .pipe(Effect.as(result)),
    boundary: options.boundary,
    failureFor: isActiveWorktreeReadFailure,
    journal: options.journal,
    onIntentRecorded: options.onIntentRecorded,
    operation: options.operation,
    read: (recordFailure) =>
      options.interpreter
        .readTaskWorktree(options.operation)
        .pipe(Effect.catchTag("GitWorktreeReadFailure", recordFailure)),
    replay: (records) => replayActiveWorktreeObservation(records, options.operation.operationId),
    runId: options.runId,
    source: options.source
  })

type ActiveRefreshTargetLineageReadOptions = {
  readonly boundary: InterruptibleWorkflowBoundaryExecution | undefined
  readonly interpreter: WorkflowInterpreterService
  readonly journal: InRunJournalService
  readonly onIntentRecorded?: Effect.Effect<void>
  readonly operation: Extract<WorkflowOperationType, { readonly _tag: "ReadTargetLineage" }>
  readonly runId: RunId
  readonly source: ActiveWorkAuthorityRefreshSource
}

/** Journals one active-refresh lineage read and its exact non-action outcome. */
export const runActiveTargetLineageAuthorityRefreshGitRead = (
  options: ActiveRefreshTargetLineageReadOptions
): Effect.Effect<typeof AuthoritativeTargetLineageObserved.Type, GitTargetLineageReadFailure | JournalAppendError> =>
  runActiveWorkAuthorityRefreshGitRead({
    appendObserved: (result) =>
      options.journal
        .append(
          options.runId,
          outcomeRecordKey(options.operation.operationId),
          TargetLineageObservedEvent.make({
            observation: result.observation,
            occurrenceClassification: "NonActionOccurrence",
            operationId: options.operation.operationId,
            plannedAttempt: options.operation.plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        .pipe(Effect.as(result)),
    boundary: options.boundary,
    failureFor: isActiveTargetLineageReadFailure,
    journal: options.journal,
    onIntentRecorded: options.onIntentRecorded,
    operation: options.operation,
    read: (recordFailure) =>
      options.interpreter
        .readTargetLineage(options.operation)
        .pipe(Effect.catchTag("GitTargetLineageReadFailure", recordFailure)),
    replay: (records) => replayActiveTargetLineageObservation(records, options.operation.operationId),
    runId: options.runId,
    source: options.source
  })

/** Replays a previously journaled planned-attempt worktree observation. */
const replayActiveWorktreeObservation = (
  records: ReadonlyArray<JournalRecord>,
  operationId: GitReadOperation["operationId"]
): typeof AuthoritativePlannedAttemptWorktreeObserved.Type | undefined => {
  const existing = records.find(
    ({ event }) => event._tag === "PlannedAttemptWorktreeObserved" && event.operationId === operationId
  )?.event
  return existing?._tag === "PlannedAttemptWorktreeObserved"
    ? AuthoritativePlannedAttemptWorktreeObserved.make({ observation: existing.observation })
    : undefined
}

/** Replays a previously journaled target-lineage observation. */
const replayActiveTargetLineageObservation = (
  records: ReadonlyArray<JournalRecord>,
  operationId: GitReadOperation["operationId"]
): typeof AuthoritativeTargetLineageObserved.Type | undefined => {
  const existing = records.find(
    ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === operationId
  )?.event
  return existing?._tag === "TargetLineageObserved"
    ? AuthoritativeTargetLineageObserved.make({ observation: existing.observation })
    : undefined
}
