import { Context, Effect, Layer, Schema } from "effect"
import {
  AcceptedResult,
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
import { type JournalRecord, JournalStore } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "./events.js"
import { integrationResponsibilityEquivalence } from "./responsibility.js"

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
export class IntegrationTargetUnavailable extends Schema.TaggedErrorClass<IntegrationTargetUnavailable>()(
  "IntegrationTargetUnavailable",
  { attemptId: AttemptId, runId: RunId }
) {}

/** A journal-free synthetic run cannot assume durable integration responsibility. */
export class IntegrationJournalUnavailable extends Schema.TaggedErrorClass<IntegrationJournalUnavailable>()(
  "IntegrationJournalUnavailable",
  { attemptId: AttemptId, runId: RunId }
) {}

/** The coordinator tried to queue a result before that exact executor outcome was durable. */
export class AcceptedResultNotDurable extends Schema.TaggedErrorClass<AcceptedResultNotDurable>()(
  "AcceptedResultNotDurable",
  { attemptId: AttemptId, runId: RunId }
) {}

const sameAcceptedResult = (left: AcceptedResult, right: AcceptedResult): boolean => left.commit === right.commit

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
      sameAcceptedResult(event.report.result.acceptedResult, acceptedResult)
  )
}

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

/** Finds accepted terminal facts that still need their exact durable integration responsibility. */
export const deriveUnqueuedAcceptedResults = (
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<UnqueuedAcceptedResult> => {
  const queuedAttemptIds = new Set(
    records.flatMap(({ event }) =>
      event._tag === "IntegrationResponsibilityBegan" ? [event.plannedAttempt.attemptId] : []
    )
  )
  const executorResponsibilities = new Map(
    records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
        ? [[event.plannedAttempt.attemptId, event.plannedAttempt] as const]
        : []
    )
  )
  return records.flatMap((record) => {
    const event = record.event
    if (
      event._tag !== "PlannedAttemptExecutorWorkReported" ||
      event.report._tag !== "Terminal" ||
      event.report.result._tag !== "Accepted" ||
      queuedAttemptIds.has(event.report.correlation.attemptId)
    ) {
      return []
    }
    const plannedAttempt = executorResponsibilities.get(event.report.correlation.attemptId)
    return plannedAttempt === undefined
      ? []
      : [
          UnqueuedAcceptedResult.make({
            acceptedResult: event.report.result.acceptedResult,
            plannedAttempt,
            terminalAt: record.position
          })
        ]
  })
}

/** Reconstructs FIFO and cutoff state solely from immutable journal records. */
export const deriveIntegrationAdmission = (records: ReadonlyArray<JournalRecord>): IntegrationAdmission => ({
  responsibilities: records
    .filter(
      (record): record is JournalRecord & { readonly event: typeof IntegrationResponsibilityBeganEvent.Type } =>
        record.event._tag === "IntegrationResponsibilityBegan"
    )
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
})

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
  const journal = yield* JournalStore
  const records = yield* journal.read(plannedAttempt.runId)
  if (!hasDurableAcceptedResult(records, plannedAttempt, acceptedResult)) {
    return yield* new AcceptedResultNotDurable({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  }
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
  const journal = yield* JournalStore
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
