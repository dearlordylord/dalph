/* eslint-disable max-lines -- Admission reconstruction and its process-local prefix indexes stay co-located for chronology auditability. */
import { Chunk, Context, Effect, HashMap, HashSet, Layer, Option, Schema } from "effect"
import {
  AcceptedResult,
  AcceptedResultEvidenceManifest,
  AttemptId,
  IntegrationTarget,
  PlannedTaskAttempt,
  RunId,
  plannedTaskAttemptEquivalence
} from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "./events.js"
import { acceptedResultEquivalence, integrationResponsibilityEquivalence } from "./responsibility.js"
import {
  completionSuccessObservationEquals,
  completionTaskClaimEquals,
  type CompletionClaimDeletedEvent,
  type CompletionClaimDeletionIntendedEvent,
  type CompletionClaimReplacedEvent,
  type CompletionClaimReplacementIntendedEvent,
  type CompletionTaskClaim,
  type IntegrationFinalitySettledEvent
} from "../integration-finality/events.js"
import { EvidenceReference, EvidenceStore, EvidenceStoreFailure } from "../evidence-store.js"
import { journalPrefixPredecessorOf } from "../../../workflow-journal/prefix-lineage.js"

/**
 * Exists only before the exact integration-start occurrence. It is derived
 * from journal history and is never persisted as a separate authority fact.
 */
export const PreIntegrationCancellationCapability = Schema.Struct({
  attemptId: AttemptId,
  queuedAt: JournalPosition,
  runId: RunId
})
export type PreIntegrationCancellationCapability = typeof PreIntegrationCancellationCapability.Type

export const QueuedIntegrationResponsibility = Schema.TaggedStruct("QueuedIntegrationResponsibility", {
  acceptedResult: AcceptedResult,
  integrationTarget: IntegrationTarget,
  plannedAttempt: PlannedTaskAttempt,
  preIntegrationCancellation: PreIntegrationCancellationCapability,
  queuedAt: JournalPosition
})
export type QueuedIntegrationResponsibility = typeof QueuedIntegrationResponsibility.Type

export const StartedIntegrationResponsibility = Schema.TaggedStruct("StartedIntegrationResponsibility", {
  acceptedResult: AcceptedResult,
  integrationTarget: IntegrationTarget,
  plannedAttempt: PlannedTaskAttempt,
  queuedAt: JournalPosition,
  startedAt: JournalPosition
})
export type StartedIntegrationResponsibility = typeof StartedIntegrationResponsibility.Type

export const IntegrationResponsibility = Schema.Union([
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility
])
export type IntegrationResponsibility = typeof IntegrationResponsibility.Type

export interface IntegrationAdmission {
  readonly responsibilities: ReadonlyArray<IntegrationResponsibility>
}

export const UnqueuedAcceptedResult = Schema.Struct({
  acceptedResult: AcceptedResult,
  plannedAttempt: PlannedTaskAttempt,
  terminalAt: JournalPosition
})
export type UnqueuedAcceptedResult = typeof UnqueuedAcceptedResult.Type

/** Coordinator configuration owns the exact serialized Git integration stream. */
export class IntegrationTargetSelection extends Context.Service<IntegrationTargetSelection, IntegrationTarget>()(
  "@dalph/IntegrationTargetSelection"
) {}

export const integrationTargetSelectionLayer = (target: IntegrationTarget) =>
  Layer.succeed(IntegrationTargetSelection, target)

/** An accepted result cannot be queued until coordinator integration policy selects a target. */
export class IntegrationTargetUnavailable extends Schema.TaggedError<IntegrationTargetUnavailable>()(
  "IntegrationTargetUnavailable",
  { attemptId: AttemptId, runId: RunId }
) {}

/** An unjournaled invocation cannot assume durable integration responsibility. */
export class IntegrationJournalUnavailable extends Schema.TaggedError<IntegrationJournalUnavailable>()(
  "IntegrationJournalUnavailable",
  { attemptId: AttemptId, runId: RunId }
) {}

/** The coordinator tried to queue a result before that exact executor outcome was durable. */
export class AcceptedResultNotDurable extends Schema.TaggedError<AcceptedResultNotDurable>()(
  "AcceptedResultNotDurable",
  { attemptId: AttemptId, runId: RunId }
) {}

/** The immutable acceptance manifest could not be read, so admission may retry after a later reread. */
export class AcceptedResultEvidenceUnavailable extends Schema.TaggedError<AcceptedResultEvidenceUnavailable>()(
  "AcceptedResultEvidenceUnavailable",
  { attemptId: AttemptId, detail: Schema.String, reference: EvidenceReference, runId: RunId }
) {}

/** The immutable acceptance manifest was readable but did not prove this exact accepted result. */
export class AcceptedResultEvidenceConflict extends Schema.TaggedError<AcceptedResultEvidenceConflict>()(
  "AcceptedResultEvidenceConflict",
  { attemptId: AttemptId, detail: Schema.String, reference: EvidenceReference, runId: RunId }
) {}

/** An Accepted result published after exact Restart is preserved as evidence but never enters integration. */
export class AcceptedResultSuppressedByRestart extends Schema.TaggedError<AcceptedResultSuppressedByRestart>()(
  "AcceptedResultSuppressedByRestart",
  { attemptId: AttemptId, runId: RunId }
) {}

type RestartChoiceApplication = { readonly plannedAttempt: PlannedTaskAttempt; readonly recordedAt: JournalPosition }

type IndexedAcceptedTerminal = {
  readonly acceptedResult: AcceptedResult
  readonly position: JournalPosition
  readonly runId: RunId
}

type FinalityClaimFacts = {
  readonly claim: CompletionTaskClaim
  readonly replacementIntent?: CompletionClaimReplacementIntendedEvent
  readonly replacement?: CompletionClaimReplacedEvent
  readonly deletionIntent?: CompletionClaimDeletionIntendedEvent
  readonly deleted?: CompletionClaimDeletedEvent
  readonly settlement?: IntegrationFinalitySettledEvent
}

type ClaimFinalityEvent =
  | CompletionClaimReplacementIntendedEvent
  | CompletionClaimReplacedEvent
  | CompletionClaimDeletionIntendedEvent
  | CompletionClaimDeletedEvent
  | IntegrationFinalitySettledEvent

const isClaimFinalityEvent = (event: JournalRecord["event"]): event is ClaimFinalityEvent =>
  event._tag === "CompletionClaimReplacementIntended" ||
  event._tag === "CompletionClaimReplaced" ||
  event._tag === "CompletionClaimDeletionIntended" ||
  event._tag === "CompletionClaimDeleted" ||
  event._tag === "IntegrationFinalitySettled"

/** Memoizes structural claim keys for repeated event objects without retaining primitive identities. */
const completionClaimKeysByIdentity = new WeakMap<object, string>()

const completionClaimKey = (claim: CompletionTaskClaim): string => {
  const cached = completionClaimKeysByIdentity.get(claim)
  if (cached !== undefined) return cached
  const key = JSON.stringify(claim)
  completionClaimKeysByIdentity.set(claim, key)
  return key
}

const finalityFactsAreSettled = (facts: FinalityClaimFacts): boolean => {
  const { deleted, replacement, settlement } = facts
  return (
    facts.replacementIntent !== undefined &&
    facts.deletionIntent !== undefined &&
    replacement !== undefined &&
    deleted !== undefined &&
    settlement !== undefined &&
    settlement.replacementOperationId === replacement.operationId &&
    settlement.deletionOperationId === deleted.operationId &&
    completionSuccessObservationEquals(settlement.successObservation, deleted.successObservation)
  )
}

/**
 * Process-local indexes for one exact journal prefix.
 *
 * Every collection is persistent: advancing a prefix returns a new index and
 * leaves the predecessor untouched. This is required because validated journal
 * prefixes can have several successors, and each branch must retain the same
 * predecessor facts without an ownership handoff or cache eviction.
 */
type IntegrationAdmissionPrefixIndexes = {
  readonly queuedAttemptIds: HashSet.HashSet<AttemptId>
  readonly executorResponsibilities: HashMap.HashMap<AttemptId, PlannedTaskAttempt>
  readonly executorResponsibilitiesFirst: HashMap.HashMap<AttemptId, PlannedTaskAttempt>
  readonly acceptedTerminalsByAttempt: HashMap.HashMap<AttemptId, Chunk.Chunk<IndexedAcceptedTerminal>>
  readonly restartChoices: HashMap.HashMap<AttemptId, Chunk.Chunk<RestartChoiceApplication>>
  readonly finalityFacts: HashMap.HashMap<string, FinalityClaimFacts>
  readonly settledClaimsByAttempt: HashMap.HashMap<AttemptId, Chunk.Chunk<CompletionTaskClaim>>
}

const emptyIntegrationAdmissionPrefixIndexes = (): IntegrationAdmissionPrefixIndexes => ({
  queuedAttemptIds: HashSet.empty<AttemptId>(),
  executorResponsibilities: HashMap.empty<AttemptId, PlannedTaskAttempt>(),
  executorResponsibilitiesFirst: HashMap.empty<AttemptId, PlannedTaskAttempt>(),
  acceptedTerminalsByAttempt: HashMap.empty<AttemptId, Chunk.Chunk<IndexedAcceptedTerminal>>(),
  restartChoices: HashMap.empty<AttemptId, Chunk.Chunk<RestartChoiceApplication>>(),
  finalityFacts: HashMap.empty<string, FinalityClaimFacts>(),
  settledClaimsByAttempt: HashMap.empty<AttemptId, Chunk.Chunk<CompletionTaskClaim>>()
})

const hashMapValue = <Key, Value>(map: HashMap.HashMap<Key, Value>, key: Key): Value | undefined =>
  Option.getOrUndefined(HashMap.get(map, key))

const settledClaimsForAttempt = (
  indexes: IntegrationAdmissionPrefixIndexes,
  plannedAttempt: PlannedTaskAttempt
): Chunk.Chunk<CompletionTaskClaim> =>
  hashMapValue(indexes.settledClaimsByAttempt, plannedAttempt.attemptId) ?? Chunk.empty<CompletionTaskClaim>()

const exactSettledClaim = (indexes: IntegrationAdmissionPrefixIndexes, claim: CompletionTaskClaim): boolean =>
  Chunk.some(settledClaimsForAttempt(indexes, claim.plannedAttempt), (settled) =>
    completionTaskClaimEquals(settled, claim)
  )

const restartChoiceCommittedBefore = (
  indexes: IntegrationAdmissionPrefixIndexes,
  plannedAttempt: PlannedTaskAttempt,
  terminalAt: JournalPosition
): boolean =>
  Chunk.some(
    hashMapValue(indexes.restartChoices, plannedAttempt.attemptId) ?? Chunk.empty<RestartChoiceApplication>(),
    (choice) => choice.recordedAt < terminalAt && plannedTaskAttemptEquivalence(choice.plannedAttempt, plannedAttempt)
  )

const finalityFactsWithReplacementIntent = (
  facts: FinalityClaimFacts,
  event: CompletionClaimReplacementIntendedEvent
): FinalityClaimFacts => (facts.replacementIntent === undefined ? { ...facts, replacementIntent: event } : facts)

const finalityFactsWithReplacement = (
  facts: FinalityClaimFacts,
  event: CompletionClaimReplacedEvent
): FinalityClaimFacts => (facts.replacement === undefined ? { ...facts, replacement: event } : facts)

const finalityFactsWithDeletionIntent = (
  facts: FinalityClaimFacts,
  event: CompletionClaimDeletionIntendedEvent
): FinalityClaimFacts => (facts.deletionIntent === undefined ? { ...facts, deletionIntent: event } : facts)

const finalityFactsWithDeleted = (facts: FinalityClaimFacts, event: CompletionClaimDeletedEvent): FinalityClaimFacts =>
  facts.deleted === undefined ? { ...facts, deleted: event } : facts

const finalityFactsWithSettlement = (
  facts: FinalityClaimFacts,
  event: IntegrationFinalitySettledEvent
): FinalityClaimFacts => ({ ...facts, settlement: event })

const finalityFactsForEvent = (prior: FinalityClaimFacts, event: ClaimFinalityEvent): FinalityClaimFacts => {
  switch (event._tag) {
    case "CompletionClaimReplacementIntended":
      return finalityFactsWithReplacementIntent(prior, event)
    case "CompletionClaimReplaced":
      return finalityFactsWithReplacement(prior, event)
    case "CompletionClaimDeletionIntended":
      return finalityFactsWithDeletionIntent(prior, event)
    case "CompletionClaimDeleted":
      return finalityFactsWithDeleted(prior, event)
    case "IntegrationFinalitySettled":
      return finalityFactsWithSettlement(prior, event)
  }
}

const updateFinalityFacts = (
  indexes: IntegrationAdmissionPrefixIndexes,
  event: ClaimFinalityEvent
): IntegrationAdmissionPrefixIndexes => {
  const key = completionClaimKey(event.claim)
  const nextFacts = finalityFactsForEvent(hashMapValue(indexes.finalityFacts, key) ?? { claim: event.claim }, event)
  const finalityFacts = HashMap.set(indexes.finalityFacts, key, nextFacts)
  if (event._tag !== "IntegrationFinalitySettled") return { ...indexes, finalityFacts }

  const attemptId = event.claim.plannedAttempt.attemptId
  const remaining = Chunk.filter(
    hashMapValue(indexes.settledClaimsByAttempt, attemptId) ?? Chunk.empty<CompletionTaskClaim>(),
    (claim) => !completionTaskClaimEquals(claim, event.claim)
  )
  const nextSettled = finalityFactsAreSettled(nextFacts) ? Chunk.append(event.claim)(remaining) : remaining
  return {
    ...indexes,
    finalityFacts,
    settledClaimsByAttempt: HashMap.set(indexes.settledClaimsByAttempt, attemptId, nextSettled)
  }
}

type IntegrationResponsibilityBeganJournalEvent = Extract<
  JournalRecord["event"],
  { readonly _tag: "IntegrationResponsibilityBegan" }
>

const advanceQueuedResponsibility = (
  prior: IntegrationAdmissionPrefixIndexes,
  event: IntegrationResponsibilityBeganJournalEvent
): IntegrationAdmissionPrefixIndexes => ({
  ...prior,
  queuedAttemptIds: HashSet.add(event.plannedAttempt.attemptId)(prior.queuedAttemptIds)
})

type ExecutorResponsibilityBeganJournalEvent = Extract<
  JournalRecord["event"],
  { readonly _tag: "PlannedAttemptExecutorWorkResponsibilityBegan" }
>

const advanceExecutorResponsibility = (
  prior: IntegrationAdmissionPrefixIndexes,
  event: ExecutorResponsibilityBeganJournalEvent
): IntegrationAdmissionPrefixIndexes => {
  const attemptId = event.plannedAttempt.attemptId
  return {
    ...prior,
    executorResponsibilities: HashMap.set(prior.executorResponsibilities, attemptId, event.plannedAttempt),
    executorResponsibilitiesFirst: HashMap.has(prior.executorResponsibilitiesFirst, attemptId)
      ? prior.executorResponsibilitiesFirst
      : HashMap.set(prior.executorResponsibilitiesFirst, attemptId, event.plannedAttempt)
  }
}

type AttemptChoiceAppliedJournalEvent = Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>

const advanceRestartChoice = (
  prior: IntegrationAdmissionPrefixIndexes,
  event: AttemptChoiceAppliedJournalEvent,
  recordedAt: JournalPosition
): IntegrationAdmissionPrefixIndexes => {
  if (event.choice !== "RestartTaskImplementation") return prior
  const attemptId = event.subject.plannedAttempt.attemptId
  const choice = { plannedAttempt: event.subject.plannedAttempt, recordedAt }
  const choices = hashMapValue(prior.restartChoices, attemptId) ?? Chunk.empty<RestartChoiceApplication>()
  return { ...prior, restartChoices: HashMap.set(prior.restartChoices, attemptId, Chunk.append(choice)(choices)) }
}

const advanceAcceptedTerminal = (
  prior: IntegrationAdmissionPrefixIndexes,
  event: ExecutorWorkReportedEvent,
  terminalAt: JournalPosition
): IntegrationAdmissionPrefixIndexes => {
  if (event.report._tag !== "Terminal" || event.report.result._tag !== "Accepted") return prior
  const attemptId = event.report.correlation.attemptId
  const terminal: IndexedAcceptedTerminal = {
    acceptedResult: event.report.result.acceptedResult,
    position: terminalAt,
    runId: event.report.correlation.runId
  }
  const terminals = hashMapValue(prior.acceptedTerminalsByAttempt, attemptId) ?? Chunk.empty<IndexedAcceptedTerminal>()
  return {
    ...prior,
    acceptedTerminalsByAttempt: HashMap.set(
      prior.acceptedTerminalsByAttempt,
      attemptId,
      Chunk.append(terminal)(terminals)
    )
  }
}

const advanceIntegrationAdmissionPrefixIndexes = (
  prior: IntegrationAdmissionPrefixIndexes,
  record: JournalRecord
): IntegrationAdmissionPrefixIndexes => {
  const event = record.event
  if (event._tag === "IntegrationResponsibilityBegan") return advanceQueuedResponsibility(prior, event)
  if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") return advanceExecutorResponsibility(prior, event)
  if (event._tag === "AttemptChoiceApplied") return advanceRestartChoice(prior, event, record.position)
  if (event._tag === "PlannedAttemptExecutorWorkReported") return advanceAcceptedTerminal(prior, event, record.position)
  return isClaimFinalityEvent(event) ? updateFinalityFacts(prior, event) : prior
}

const admissionIndexesByPrefix = new WeakMap<ReadonlyArray<JournalRecord>, IntegrationAdmissionPrefixIndexes>()

const transferredAdmissionIndexesFor = (
  records: ReadonlyArray<JournalRecord>
): IntegrationAdmissionPrefixIndexes | undefined => {
  const predecessor = journalPrefixPredecessorOf(records)
  if (predecessor === undefined || predecessor.appended !== records[records.length - 1]) return undefined
  const prior = integrationAdmissionPrefixIndexesFor(predecessor.prior)
  return advanceIntegrationAdmissionPrefixIndexes(prior, predecessor.appended)
}

const replayIntegrationAdmissionPrefixIndexes = (
  records: ReadonlyArray<JournalRecord>
): IntegrationAdmissionPrefixIndexes => {
  const indexes = emptyIntegrationAdmissionPrefixIndexes()
  let next = indexes
  for (const record of records) {
    if (!isClaimFinalityEvent(record.event)) next = advanceIntegrationAdmissionPrefixIndexes(next, record)
  }
  for (const record of records.toSorted((left, right) => left.position - right.position)) {
    if (isClaimFinalityEvent(record.event)) next = updateFinalityFacts(next, record.event)
  }
  return next
}

const integrationAdmissionPrefixIndexesFor = (
  records: ReadonlyArray<JournalRecord>
): IntegrationAdmissionPrefixIndexes => {
  const cached = admissionIndexesByPrefix.get(records)
  if (cached !== undefined) return cached

  const indexes = transferredAdmissionIndexesFor(records) ?? replayIntegrationAdmissionPrefixIndexes(records)
  admissionIndexesByPrefix.set(records, indexes)
  return indexes
}

const acceptedTerminalFor = (
  indexes: IntegrationAdmissionPrefixIndexes,
  plannedAttempt: PlannedTaskAttempt,
  acceptedResult: AcceptedResult
): IndexedAcceptedTerminal | undefined =>
  Option.getOrUndefined(
    Chunk.findFirst(
      hashMapValue(indexes.acceptedTerminalsByAttempt, plannedAttempt.attemptId) ??
        Chunk.empty<IndexedAcceptedTerminal>(),
      (terminal) =>
        terminal.runId === plannedAttempt.runId && acceptedResultEquivalence(terminal.acceptedResult, acceptedResult)
    )
  )

const hasDurableAcceptedResult = (
  indexes: IntegrationAdmissionPrefixIndexes,
  plannedAttempt: PlannedTaskAttempt,
  acceptedResult: AcceptedResult
): boolean => {
  const responsibility = hashMapValue(indexes.executorResponsibilitiesFirst, plannedAttempt.attemptId)
  return (
    responsibility !== undefined &&
    plannedTaskAttemptEquivalence(responsibility, plannedAttempt) &&
    acceptedTerminalFor(indexes, plannedAttempt, acceptedResult) !== undefined
  )
}

const acceptanceEvidenceConflict = (
  plannedAttempt: PlannedTaskAttempt,
  reference: EvidenceReference,
  detail: string
): AcceptedResultEvidenceConflict =>
  new AcceptedResultEvidenceConflict({
    attemptId: plannedAttempt.attemptId,
    detail,
    reference,
    runId: plannedAttempt.runId
  })

/** Reads and qualifies one immutable executor acceptance envelope before admission. */
export const qualifyAcceptedResultEvidence = Effect.fn("IntegrationAdmission.qualifyAcceptedResultEvidence")(function* (
  plannedAttempt: PlannedTaskAttempt,
  acceptedResult: AcceptedResult
) {
  const reference = acceptedResult.evidenceManifest
  const evidence = Context.getOption(yield* Effect.context<never>(), EvidenceStore)
  if (evidence._tag === "None") {
    return yield* new AcceptedResultEvidenceUnavailable({
      attemptId: plannedAttempt.attemptId,
      detail: "acceptance evidence store is not configured for this run activation",
      reference,
      runId: plannedAttempt.runId
    })
  }
  const bytes = yield* evidence.value
    .read(reference)
    .pipe(
      Effect.mapError(
        (failure) =>
          new AcceptedResultEvidenceUnavailable({
            attemptId: plannedAttempt.attemptId,
            detail: failure instanceof EvidenceStoreFailure ? failure.detail : String(failure),
            reference,
            runId: plannedAttempt.runId
          })
      )
    )
  const decoded = yield* Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(bytes)),
    catch: (cause) => acceptanceEvidenceConflict(plannedAttempt, reference, `manifest is not JSON: ${String(cause)}`)
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(AcceptedResultEvidenceManifest)),
    Effect.mapError((cause) =>
      cause instanceof AcceptedResultEvidenceConflict
        ? cause
        : acceptanceEvidenceConflict(plannedAttempt, reference, `manifest has an invalid envelope: ${String(cause)}`)
    )
  )
  if (
    decoded.commit !== acceptedResult.commit ||
    decoded.correlation.attemptId !== plannedAttempt.attemptId ||
    decoded.correlation.runId !== plannedAttempt.runId
  ) {
    return yield* acceptanceEvidenceConflict(
      plannedAttempt,
      reference,
      "manifest does not bind the exact accepted commit, RunId, and AttemptId"
    )
  }
  return decoded
})

const startedFor = (
  records: ReadonlyArray<JournalRecord>,
  queued: JournalRecord & { readonly event: typeof IntegrationResponsibilityBeganEvent.Type }
) =>
  records.find(
    (record): record is JournalRecord & { readonly event: typeof IntegrationStartedEvent.Type } =>
      record.event._tag === "IntegrationStarted" &&
      record.event.responsibilityBeganAt === queued.position &&
      integrationResponsibilityEquivalence(record.event, queued.event)
  )

/**
 * A completion settlement names the same immutable planned attempt that
 * began this integration responsibility. It releases only this logical FIFO
 * blocker; the settlement remains available separately as delivery evidence.
 */
const settledFor = (
  indexes: IntegrationAdmissionPrefixIndexes,
  queued: JournalRecord & { readonly event: typeof IntegrationResponsibilityBeganEvent.Type }
): boolean =>
  Chunk.some(settledClaimsForAttempt(indexes, queued.event.plannedAttempt), (claim) =>
    plannedTaskAttemptEquivalence(claim.plannedAttempt, queued.event.plannedAttempt)
  )

/** Finds accepted terminal facts that still need their exact durable integration responsibility. */
const unqueuedAcceptedResultsByPrefix = new WeakMap<
  ReadonlyArray<JournalRecord>,
  ReadonlyArray<UnqueuedAcceptedResult>
>()

type ExecutorWorkReportedEvent = Extract<
  JournalRecord["event"],
  { readonly _tag: "PlannedAttemptExecutorWorkReported" }
>

const incrementalUnqueuedAcceptedResultsForTerminal = (
  indexes: IntegrationAdmissionPrefixIndexes,
  prior: ReadonlyArray<UnqueuedAcceptedResult>,
  appended: ExecutorWorkReportedEvent,
  terminalAt: JournalPosition
): ReadonlyArray<UnqueuedAcceptedResult> => {
  if (appended.report._tag !== "Terminal" || appended.report.result._tag !== "Accepted") return prior
  if (HashSet.has(indexes.queuedAttemptIds, appended.report.correlation.attemptId)) return prior
  const plannedAttempt = hashMapValue(indexes.executorResponsibilities, appended.report.correlation.attemptId)
  if (plannedAttempt === undefined || restartChoiceCommittedBefore(indexes, plannedAttempt, terminalAt)) {
    return prior
  }
  return [
    ...prior,
    UnqueuedAcceptedResult.make({ acceptedResult: appended.report.result.acceptedResult, plannedAttempt, terminalAt })
  ]
}

const incrementalUnqueuedAcceptedResultsFor = (
  indexes: IntegrationAdmissionPrefixIndexes,
  prior: ReadonlyArray<UnqueuedAcceptedResult>,
  appendedRecord: JournalRecord
): ReadonlyArray<UnqueuedAcceptedResult> => {
  const appended = appendedRecord.event
  if (appended._tag === "IntegrationResponsibilityBegan") {
    return prior.filter(({ plannedAttempt }) => plannedAttempt.attemptId !== appended.plannedAttempt.attemptId)
  }
  if (appended._tag !== "PlannedAttemptExecutorWorkReported") return prior
  return incrementalUnqueuedAcceptedResultsForTerminal(indexes, prior, appended, appendedRecord.position)
}

export const deriveUnqueuedAcceptedResults = (
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<UnqueuedAcceptedResult> => {
  const cached = unqueuedAcceptedResultsByPrefix.get(records)
  if (cached !== undefined) return cached

  const indexes = integrationAdmissionPrefixIndexesFor(records)
  const predecessor = journalPrefixPredecessorOf(records)
  if (predecessor !== undefined) {
    const prior = unqueuedAcceptedResultsByPrefix.get(predecessor.prior)
    if (prior !== undefined && predecessor.appended === records[records.length - 1]) {
      const results = incrementalUnqueuedAcceptedResultsFor(indexes, prior, predecessor.appended)
      unqueuedAcceptedResultsByPrefix.set(records, results)
      return results
    }
  }

  const results = records.flatMap((record) => {
    const event = record.event
    if (
      event._tag !== "PlannedAttemptExecutorWorkReported" ||
      event.report._tag !== "Terminal" ||
      event.report.result._tag !== "Accepted" ||
      HashSet.has(indexes.queuedAttemptIds, event.report.correlation.attemptId)
    ) {
      return []
    }
    const plannedAttempt = hashMapValue(indexes.executorResponsibilities, event.report.correlation.attemptId)
    return plannedAttempt === undefined || restartChoiceCommittedBefore(indexes, plannedAttempt, record.position)
      ? []
      : [
          UnqueuedAcceptedResult.make({
            acceptedResult: event.report.result.acceptedResult,
            plannedAttempt,
            terminalAt: record.position
          })
        ]
  })
  unqueuedAcceptedResultsByPrefix.set(records, results)
  return results
}

/** Reconstructs FIFO and cutoff state solely from immutable journal records. */
const integrationAdmissionByPrefix = new WeakMap<ReadonlyArray<JournalRecord>, IntegrationAdmission>()

export const deriveIntegrationAdmission = (records: ReadonlyArray<JournalRecord>): IntegrationAdmission => {
  const cached = integrationAdmissionByPrefix.get(records)
  if (cached !== undefined) return cached

  const indexes = integrationAdmissionPrefixIndexesFor(records)
  const predecessor = journalPrefixPredecessorOf(records)
  if (predecessor !== undefined) {
    const prior = integrationAdmissionByPrefix.get(predecessor.prior)
    if (prior !== undefined && predecessor.appended === records[records.length - 1]) {
      const appendedRecord = predecessor.appended
      const appended = appendedRecord.event
      const next = (() => {
        if (appended._tag === "IntegrationResponsibilityBegan") {
          const queued: JournalRecord & { readonly event: typeof IntegrationResponsibilityBeganEvent.Type } = {
            ...appendedRecord,
            event: appended
          }
          if (settledFor(indexes, queued)) return prior
          return {
            responsibilities: [
              ...prior.responsibilities,
              QueuedIntegrationResponsibility.make({
                acceptedResult: appended.acceptedResult,
                integrationTarget: appended.integrationTarget,
                plannedAttempt: appended.plannedAttempt,
                preIntegrationCancellation: PreIntegrationCancellationCapability.make({
                  attemptId: appended.plannedAttempt.attemptId,
                  queuedAt: appendedRecord.position,
                  runId: appendedRecord.runId
                }),
                queuedAt: appendedRecord.position
              })
            ]
          }
        }
        if (appended._tag === "IntegrationStarted") {
          return {
            responsibilities: prior.responsibilities.map((responsibility) =>
              responsibility._tag === "QueuedIntegrationResponsibility" &&
              responsibility.queuedAt === appended.responsibilityBeganAt &&
              integrationResponsibilityEquivalence(responsibility, appended)
                ? StartedIntegrationResponsibility.make({
                    acceptedResult: responsibility.acceptedResult,
                    integrationTarget: responsibility.integrationTarget,
                    plannedAttempt: responsibility.plannedAttempt,
                    queuedAt: responsibility.queuedAt,
                    startedAt: appendedRecord.position
                  })
                : responsibility
            )
          }
        }
        if (appended._tag === "IntegrationFinalitySettled") {
          if (exactSettledClaim(indexes, appended.claim)) {
            return {
              responsibilities: prior.responsibilities.filter(
                (responsibility) =>
                  !plannedTaskAttemptEquivalence(responsibility.plannedAttempt, appended.claim.plannedAttempt)
              )
            }
          }
        }
        return prior
      })()
      integrationAdmissionByPrefix.set(records, next)
      return next
    }
  }

  const admission: IntegrationAdmission = {
    responsibilities: records
      .filter(
        (record): record is JournalRecord & { readonly event: typeof IntegrationResponsibilityBeganEvent.Type } =>
          record.event._tag === "IntegrationResponsibilityBegan"
      )
      .filter((record) => !settledFor(indexes, record))
      .toSorted((left, right) => left.position - right.position)
      .map((queued) => {
        const started = startedFor(records, queued)
        return started === undefined
          ? QueuedIntegrationResponsibility.make({
              acceptedResult: queued.event.acceptedResult,
              integrationTarget: queued.event.integrationTarget,
              plannedAttempt: queued.event.plannedAttempt,
              preIntegrationCancellation: PreIntegrationCancellationCapability.make({
                attemptId: queued.event.plannedAttempt.attemptId,
                queuedAt: queued.position,
                runId: queued.runId
              }),
              queuedAt: queued.position
            })
          : StartedIntegrationResponsibility.make({
              acceptedResult: queued.event.acceptedResult,
              integrationTarget: queued.event.integrationTarget,
              plannedAttempt: queued.event.plannedAttempt,
              queuedAt: queued.position,
              startedAt: started.position
            })
      })
  }
  integrationAdmissionByPrefix.set(records, admission)
  return admission
}

const integrationTargetKey = (responsibility: IntegrationResponsibility): string =>
  JSON.stringify(responsibility.integrationTarget)

/**
 * Selects at most the earliest queued responsibility for each free target.
 * A started responsibility holds its target unless current facts release it.
 */
export const selectStartableIntegrationResponsibilities = (
  admission: IntegrationAdmission
): ReadonlyArray<QueuedIntegrationResponsibility> => {
  const unavailableTargets = new Set(
    admission.responsibilities.flatMap((responsibility) =>
      responsibility._tag === "StartedIntegrationResponsibility" ? [integrationTargetKey(responsibility)] : []
    )
  )
  return admission.responsibilities.flatMap((responsibility) => {
    if (responsibility._tag !== "QueuedIntegrationResponsibility") return []
    const target = integrationTargetKey(responsibility)
    if (unavailableTargets.has(target)) return []
    unavailableTargets.add(target)
    return [responsibility]
  })
}

/** Records one exact accepted result; the returned envelope position owns FIFO order. */
export const queueAcceptedResultIntegrationResponsibility = Effect.fn(
  "IntegrationAdmission.queueAcceptedResultResponsibility"
)(function* (plannedAttempt: PlannedTaskAttempt, acceptedResult: AcceptedResult, integrationTarget: IntegrationTarget) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(plannedAttempt.runId)
  const indexes = integrationAdmissionPrefixIndexesFor(records)
  const acceptedTerminal = acceptedTerminalFor(indexes, plannedAttempt, acceptedResult)
  if (
    acceptedTerminal !== undefined &&
    restartChoiceCommittedBefore(indexes, plannedAttempt, acceptedTerminal.position)
  ) {
    return yield* new AcceptedResultSuppressedByRestart({
      attemptId: plannedAttempt.attemptId,
      runId: plannedAttempt.runId
    })
  }
  if (!hasDurableAcceptedResult(indexes, plannedAttempt, acceptedResult)) {
    return yield* new AcceptedResultNotDurable({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  }
  yield* qualifyAcceptedResultEvidence(plannedAttempt, acceptedResult)
  const record = yield* journal.append(
    plannedAttempt.runId,
    integrationResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult,
      integrationTarget,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  return QueuedIntegrationResponsibility.make({
    acceptedResult,
    integrationTarget,
    plannedAttempt,
    preIntegrationCancellation: PreIntegrationCancellationCapability.make({
      attemptId: plannedAttempt.attemptId,
      queuedAt: record.position,
      runId: plannedAttempt.runId
    }),
    queuedAt: record.position
  })
})

/**
 * Crosses the non-cancellable cutoff idempotently. Reusing a stale capability
 * can only rediscover the same exact start record; it cannot create another.
 */
export const startQueuedIntegration = Effect.fn("IntegrationAdmission.startQueuedIntegration")(function* (
  queued: QueuedIntegrationResponsibility
) {
  const journal = yield* InRunJournal
  const record = yield* journal.append(
    queued.plannedAttempt.runId,
    integrationStartedRecordKey(queued.plannedAttempt.attemptId),
    IntegrationStartedEvent.make({
      acceptedResult: queued.acceptedResult,
      integrationTarget: queued.integrationTarget,
      plannedAttempt: queued.plannedAttempt,
      responsibilityBeganAt: queued.queuedAt,
      version: workflowJournalEventVersion
    })
  )
  return StartedIntegrationResponsibility.make({
    acceptedResult: queued.acceptedResult,
    integrationTarget: queued.integrationTarget,
    plannedAttempt: queued.plannedAttempt,
    queuedAt: queued.queuedAt,
    startedAt: record.position
  })
})
