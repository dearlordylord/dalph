/* eslint-disable max-lines -- Admission reconstruction and its process-local prefix indexes stay co-located for chronology auditability. */
import { Context, Effect, Layer, Schema } from "effect"
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

const restartChoiceCommittedBeforeRecords = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  terminalAt: JournalPosition
): boolean =>
  records.some(
    ({ event, position }) =>
      position < terminalAt &&
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "RestartTaskImplementation" &&
      plannedTaskAttemptEquivalence(event.subject.plannedAttempt, plannedAttempt)
  )

type RestartChoiceApplication = { readonly plannedAttempt: PlannedTaskAttempt; readonly recordedAt: JournalPosition }

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

type IntegrationAdmissionPrefixIndexes = {
  readonly queuedAttemptIds: ReadonlySet<AttemptId>
  readonly executorResponsibilities: ReadonlyMap<AttemptId, PlannedTaskAttempt>
  readonly restartChoices: ReadonlyMap<AttemptId, ReadonlyArray<RestartChoiceApplication>>
  readonly finalityFacts: ReadonlyMap<string, FinalityClaimFacts>
  readonly settledClaimsByAttempt: ReadonlyMap<AttemptId, ReadonlyArray<CompletionTaskClaim>>
}

const emptyIntegrationAdmissionPrefixIndexes = (): IntegrationAdmissionPrefixIndexes => ({
  queuedAttemptIds: new Set(),
  executorResponsibilities: new Map(),
  restartChoices: new Map(),
  finalityFacts: new Map(),
  settledClaimsByAttempt: new Map()
})

const settledClaimsForAttempt = (
  indexes: IntegrationAdmissionPrefixIndexes,
  plannedAttempt: PlannedTaskAttempt
): ReadonlyArray<CompletionTaskClaim> => indexes.settledClaimsByAttempt.get(plannedAttempt.attemptId) ?? []

const exactSettledClaim = (indexes: IntegrationAdmissionPrefixIndexes, claim: CompletionTaskClaim): boolean =>
  settledClaimsForAttempt(indexes, claim.plannedAttempt).some((settled) => completionTaskClaimEquals(settled, claim))

const restartChoiceCommittedBefore = (
  indexes: IntegrationAdmissionPrefixIndexes,
  plannedAttempt: PlannedTaskAttempt,
  terminalAt: JournalPosition
): boolean =>
  (indexes.restartChoices.get(plannedAttempt.attemptId) ?? []).some(
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
  prior: IntegrationAdmissionPrefixIndexes,
  event: ClaimFinalityEvent
): IntegrationAdmissionPrefixIndexes => {
  const key = completionClaimKey(event.claim)
  const nextFacts = finalityFactsForEvent(prior.finalityFacts.get(key) ?? { claim: event.claim }, event)
  const finalityFacts = new Map([...prior.finalityFacts, [key, nextFacts] as const])
  if (event._tag !== "IntegrationFinalitySettled") return { ...prior, finalityFacts }

  const attemptId = event.claim.plannedAttempt.attemptId
  const remaining = (prior.settledClaimsByAttempt.get(attemptId) ?? []).filter(
    (claim) => !completionTaskClaimEquals(claim, event.claim)
  )
  const nextSettled = finalityFactsAreSettled(nextFacts) ? [...remaining, event.claim] : remaining
  const settledClaimsByAttempt = new Map([...prior.settledClaimsByAttempt, [attemptId, nextSettled] as const])
  return { ...prior, finalityFacts, settledClaimsByAttempt }
}

const advanceIntegrationAdmissionPrefixIndexes = (
  prior: IntegrationAdmissionPrefixIndexes,
  record: JournalRecord
): IntegrationAdmissionPrefixIndexes => {
  const event = record.event
  if (event._tag === "IntegrationResponsibilityBegan") {
    const queuedAttemptIds = new Set([...prior.queuedAttemptIds, event.plannedAttempt.attemptId])
    return { ...prior, queuedAttemptIds }
  }
  if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    const executorResponsibilities = new Map([
      ...prior.executorResponsibilities,
      [event.plannedAttempt.attemptId, event.plannedAttempt] as const
    ])
    return { ...prior, executorResponsibilities }
  }
  if (event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation") {
    const attemptId = event.subject.plannedAttempt.attemptId
    const restartChoices = new Map([
      ...prior.restartChoices,
      [
        attemptId,
        [
          ...(prior.restartChoices.get(attemptId) ?? []),
          { plannedAttempt: event.subject.plannedAttempt, recordedAt: record.position }
        ]
      ] as const
    ])
    return { ...prior, restartChoices }
  }
  return isClaimFinalityEvent(event) ? updateFinalityFacts(prior, event) : prior
}

const admissionIndexesByPrefix = new WeakMap<ReadonlyArray<JournalRecord>, IntegrationAdmissionPrefixIndexes>()

const integrationAdmissionPrefixIndexesFor = (
  records: ReadonlyArray<JournalRecord>
): IntegrationAdmissionPrefixIndexes => {
  const cached = admissionIndexesByPrefix.get(records)
  if (cached !== undefined) return cached

  const predecessor = journalPrefixPredecessorOf(records)
  if (predecessor !== undefined && predecessor.appended === records[records.length - 1]) {
    const prior = integrationAdmissionPrefixIndexesFor(predecessor.prior)
    const next = advanceIntegrationAdmissionPrefixIndexes(prior, predecessor.appended)
    admissionIndexesByPrefix.set(records, next)
    return next
  }

  let indexes = emptyIntegrationAdmissionPrefixIndexes()
  for (const record of records.toSorted((left, right) => left.position - right.position)) {
    indexes = advanceIntegrationAdmissionPrefixIndexes(indexes, record)
  }
  admissionIndexesByPrefix.set(records, indexes)
  return indexes
}

const hasDurableAcceptedResult = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  acceptedResult: AcceptedResult
): boolean => {
  const responsibility = records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  if (
    responsibility?.event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan" ||
    !plannedTaskAttemptEquivalence(responsibility.event.plannedAttempt, plannedAttempt)
  ) {
    return false
  }
  return records.some(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report._tag === "Terminal" &&
      event.report.correlation.attemptId === plannedAttempt.attemptId &&
      event.report.correlation.runId === plannedAttempt.runId &&
      event.report.result._tag === "Accepted" &&
      acceptedResultEquivalence(event.report.result.acceptedResult, acceptedResult)
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
  settledClaimsForAttempt(indexes, queued.event.plannedAttempt).some((claim) =>
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
  if (indexes.queuedAttemptIds.has(appended.report.correlation.attemptId)) return prior
  const plannedAttempt = indexes.executorResponsibilities.get(appended.report.correlation.attemptId)
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
      indexes.queuedAttemptIds.has(event.report.correlation.attemptId)
    ) {
      return []
    }
    const plannedAttempt = indexes.executorResponsibilities.get(event.report.correlation.attemptId)
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
  const acceptedTerminal = records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report._tag === "Terminal" &&
      event.report.result._tag === "Accepted" &&
      event.report.correlation.attemptId === plannedAttempt.attemptId &&
      event.report.correlation.runId === plannedAttempt.runId &&
      acceptedResultEquivalence(event.report.result.acceptedResult, acceptedResult)
  )
  if (
    acceptedTerminal !== undefined &&
    restartChoiceCommittedBeforeRecords(records, plannedAttempt, acceptedTerminal.position)
  ) {
    return yield* new AcceptedResultSuppressedByRestart({
      attemptId: plannedAttempt.attemptId,
      runId: plannedAttempt.runId
    })
  }
  if (!hasDurableAcceptedResult(records, plannedAttempt, acceptedResult)) {
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
