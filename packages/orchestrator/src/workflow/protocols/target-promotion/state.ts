import { Match, Schema } from "effect"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  TargetPromotionAttemptLimit,
  type TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  type TargetPromotionIntendedEvent,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionCorrelation,
  TargetPromotionStaleObservation,
  TargetPromotionSuccessObservation,
  TargetPromotionTerminalBasis,
  type TargetPromotionJournalEvent,
  targetPromotionCorrelationEquals
} from "./events.js"

/** The next bounded action is either the mandatory initial read or a read after an ambiguous write. */
export const TargetPromotionPendingRetry = Schema.TaggedUnion({
  NeedInitialReconciliationRead: {},
  NeedReconciliationRead: { afterAttemptOrdinal: TargetPromotionAttemptOrdinal }
})
export type TargetPromotionPendingRetry = typeof TargetPromotionPendingRetry.Type

/** Durable state reconstructed from exact promotion occurrences. */
export const TargetPromotionState = Schema.TaggedUnion({
  PromotionPending: { correlation: TargetPromotionCorrelation, retry: TargetPromotionPendingRetry },
  PromotionSucceeded: {
    basis: TargetPromotionTerminalBasis,
    correlation: TargetPromotionCorrelation,
    observation: TargetPromotionSuccessObservation
  },
  PromotionStale: {
    basis: TargetPromotionTerminalBasis,
    correlation: TargetPromotionCorrelation,
    observation: TargetPromotionStaleObservation
  },
  PromotionNonConvergent: {
    attemptLimit: TargetPromotionAttemptLimit,
    attemptOrdinal: TargetPromotionAttemptOrdinal,
    correlation: TargetPromotionCorrelation,
    lastObservation: TargetPromotionNonConvergenceObservation
  }
})
export type TargetPromotionState = typeof TargetPromotionState.Type

/** Minimal journal occurrence accepted by the pure promotion reducer. */
export type JournalOccurrence = { readonly event: unknown; readonly position: JournalPosition }

type PromotionOccurrence = JournalOccurrence & { readonly event: TargetPromotionJournalEvent }

const hasTag = (value: unknown): value is { readonly _tag: string } =>
  typeof value === "object" && value !== null && "_tag" in value && typeof value._tag === "string"

const isPromotionOccurrence = (record: JournalOccurrence): record is PromotionOccurrence =>
  hasTag(record.event) && record.event._tag.startsWith("TargetPromotion")

const relevantPromotionOccurrences = (
  records: ReadonlyArray<JournalOccurrence>,
  request: TargetPromotionCorrelation
): ReadonlyArray<PromotionOccurrence> =>
  records
    .filter((record): record is PromotionOccurrence => {
      if (!isPromotionOccurrence(record)) return false
      return targetPromotionCorrelationEquals(record.event.correlation, request)
    })
    .toSorted((left, right) => left.position - right.position)

/** Finds a journaled promotion correlation that reuses an outer request id for different exact P facts. */
export const targetPromotionCorrelationConflictFor = (
  records: ReadonlyArray<JournalOccurrence>,
  request: TargetPromotionCorrelation
): TargetPromotionCorrelation | undefined =>
  records.find((record): record is PromotionOccurrence => {
    if (!isPromotionOccurrence(record)) return false
    return (
      record.event.correlation.requestId === request.requestId &&
      !targetPromotionCorrelationEquals(record.event.correlation, request)
    )
  })?.event.correlation

const latest = <A>(values: ReadonlyArray<A>): A | undefined => values[values.length - 1]

const attemptRecords = (
  records: ReadonlyArray<PromotionOccurrence>
): ReadonlyArray<PromotionOccurrence & { readonly event: TargetPromotionAttemptIntendedEvent }> =>
  records.filter(
    (record): record is PromotionOccurrence & { readonly event: TargetPromotionAttemptIntendedEvent } =>
      record.event._tag === "TargetPromotionAttemptIntended"
  )

const correlationFromIntent = (records: ReadonlyArray<PromotionOccurrence>): TargetPromotionCorrelation | undefined => {
  const intent = records.findLast(
    (record): record is PromotionOccurrence & { readonly event: TargetPromotionIntendedEvent } =>
      record.event._tag === "TargetPromotionIntended"
  )
  return intent?.event.correlation
}

type TerminalPromotionEvent = Extract<
  TargetPromotionJournalEvent,
  { readonly _tag: "TargetPromotionObservedSuccess" | "TargetPromotionStale" | "TargetPromotionNonConvergence" }
>

const isTerminalPromotionOccurrence = (
  record: PromotionOccurrence
): record is PromotionOccurrence & { readonly event: TerminalPromotionEvent } =>
  ["TargetPromotionObservedSuccess", "TargetPromotionStale", "TargetPromotionNonConvergence"].includes(
    record.event._tag
  )

const stateFromTerminal = (event: TerminalPromotionEvent): TargetPromotionState =>
  Match.valueTags(event, {
    TargetPromotionObservedSuccess: ({ basis, correlation, observation }) =>
      TargetPromotionState.cases.PromotionSucceeded.make({ basis, correlation, observation }),
    TargetPromotionStale: ({ basis, correlation, observation }) =>
      TargetPromotionState.cases.PromotionStale.make({ basis, correlation, observation }),
    TargetPromotionNonConvergence: ({ attemptLimit, attemptOrdinal, correlation, lastObservation }) =>
      TargetPromotionState.cases.PromotionNonConvergent.make({
        attemptLimit,
        attemptOrdinal,
        correlation,
        lastObservation
      })
  })

/** Reconstructs promotion state without treating a journal row as Git authority. */
export const deriveTargetPromotionState = (
  records: ReadonlyArray<JournalOccurrence>,
  request: TargetPromotionCorrelation
): TargetPromotionState | undefined => {
  if (targetPromotionCorrelationConflictFor(records, request) !== undefined) return undefined
  const relevant = relevantPromotionOccurrences(records, request)
  const terminal = latest(relevant.filter(isTerminalPromotionOccurrence))
  if (terminal !== undefined) return stateFromTerminal(terminal.event)
  const intentCorrelation = correlationFromIntent(relevant)
  if (intentCorrelation === undefined) return undefined
  const lastAttempt = latest(attemptRecords(relevant))
  return lastAttempt === undefined
    ? TargetPromotionState.cases.PromotionPending.make({
        correlation: intentCorrelation,
        retry: TargetPromotionPendingRetry.cases.NeedInitialReconciliationRead.make({})
      })
    : TargetPromotionState.cases.PromotionPending.make({
        correlation: lastAttempt.event.correlation,
        retry: TargetPromotionPendingRetry.cases.NeedReconciliationRead.make({
          afterAttemptOrdinal: lastAttempt.event.attemptOrdinal
        })
      })
}
