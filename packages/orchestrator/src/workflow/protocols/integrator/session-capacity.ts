/* eslint-disable functional/immutable-data -- Build one derived identity set from immutable journal evidence. */
import type { JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import { journalRecordByPosition, journalRecordsOfKind } from "../../../workflow-journal/record-evidence.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  IntegratorAutomaticSuccessorGeneration,
  integratorSuccessorResponsibilityMatches,
  maximumIntegratorSessionsPerResponsibility,
  type IntegratorSessionId,
  type IntegratorSessionCorrelation
} from "./events.js"

const lastElementOffset = -1

/** One journaled fixation relation. Every distinct identity in the relation consumes a slot. */
export type IntegratorSessionFixation =
  | { readonly _tag: "Initial"; readonly correlation: IntegratorSessionCorrelation }
  | {
      readonly _tag: "Successor"
      readonly predecessor: IntegratorSessionCorrelation
      readonly successor: IntegratorSessionCorrelation
    }

export type IntegratorSessionCapacity =
  | {
      readonly _tag: "Available"
      readonly fixedSessionIds: ReadonlySet<IntegratorSessionId>
      readonly nextGeneration: IntegratorAutomaticSuccessorGeneration
    }
  | { readonly _tag: "NoFixedSession"; readonly fixedSessionIds: ReadonlySet<IntegratorSessionId> }
  | { readonly _tag: "Exhausted"; readonly fixedSessionIds: ReadonlySet<IntegratorSessionId> }

/** One Full rerun receipt authorizes at most three newly fixed automatic sessions. */
export const maximumIntegratorSessionsPerPublicationBatch = 3 // eslint-disable-line no-magic-numbers -- accepted #386 bound

/** Applies one responsibility and identity rule to initial and successor fixations. */
export const integratorSessionCapacityFor = (
  responsibility: IntegratorSessionCorrelation,
  fixations: Iterable<IntegratorSessionFixation>
): IntegratorSessionCapacity => {
  const fixedSessionIds = new Set<IntegratorSessionId>()
  const addIfSameResponsibility = (session: IntegratorSessionCorrelation) => {
    if (integratorSuccessorResponsibilityMatches(responsibility, session)) fixedSessionIds.add(session.sessionId)
  }
  for (const fixation of fixations) {
    if (fixation._tag === "Initial") {
      addIfSameResponsibility(fixation.correlation)
    } else {
      addIfSameResponsibility(fixation.predecessor)
      addIfSameResponsibility(fixation.successor)
    }
  }
  if (fixedSessionIds.size === 0) return { _tag: "NoFixedSession", fixedSessionIds }
  return fixedSessionIds.size < maximumIntegratorSessionsPerResponsibility
    ? {
        _tag: "Available",
        fixedSessionIds,
        nextGeneration: IntegratorAutomaticSuccessorGeneration.make(fixedSessionIds.size + 1)
      }
    : { _tag: "Exhausted", fixedSessionIds }
}

/** Extracts the same initial and predecessor/successor identities from accepted journal records. */
export const integratorSessionCapacityForJournal = (
  records: JournalHistorySource,
  responsibility: IntegratorSessionCorrelation
): IntegratorSessionCapacity => {
  const initialFixations: ReadonlyArray<IntegratorSessionFixation> = [
    ...journalRecordsOfKind(records, "IntegratorSessionFixed")
  ].flatMap(({ event }) =>
    event._tag === "IntegratorSessionFixed" ? [{ _tag: "Initial" as const, correlation: event.correlation }] : []
  )
  const successorFixations: ReadonlyArray<IntegratorSessionFixation> = [
    ...journalRecordsOfKind(records, "IntegratorSuccessorSessionFixed"),
    ...journalRecordsOfKind(records, "IntegratorAutomaticSuccessorSessionFixed")
  ].flatMap(({ event }) =>
    event._tag === "IntegratorSuccessorSessionFixed" || event._tag === "IntegratorAutomaticSuccessorSessionFixed"
      ? [{ _tag: "Successor" as const, predecessor: event.predecessor, successor: event.successor }]
      : []
  )
  return integratorSessionCapacityFor(responsibility, [...initialFixations, ...successorFixations])
}

/** Finds the latest exact committed publication grant for this Run responsibility. */
export const latestPublicationBatchGrantAtForResponsibility = (
  records: JournalHistorySource,
  responsibility: IntegratorSessionCorrelation
): JournalPosition | undefined => {
  const runId = responsibility.plannedAttempt.runId
  const matching = Array.from(journalRecordsOfKind(records, "RemotePublicationBatchGrantApplied")).filter(
    ({ event, position, runId: recordRunId }) => {
      if (
        event._tag !== "RemotePublicationBatchGrantApplied" ||
        recordRunId !== runId ||
        event.request.runId !== runId ||
        event.request.responsibility.runId !== runId ||
        event.request.responsibility.queuedAt !== responsibility.queuedAt
      ) {
        return false
      }
      const exhaustion = journalRecordByPosition(records, event.request.exhaustionAt)
      return (
        exhaustion !== undefined &&
        exhaustion.runId === runId &&
        exhaustion.position < position &&
        exhaustion.event._tag === "RemotePublicationRetained" &&
        exhaustion.event.correlation.qualifiedCandidate.run.session.queuedAt === responsibility.queuedAt &&
        (exhaustion.event.cause._tag === "AttemptsExhausted" ||
          exhaustion.event.cause._tag === "CompatibleCompetingHead")
      )
    }
  )
  return matching.sort((left, right) => Number(left.position) - Number(right.position)).at(lastElementOffset)?.position
}

/** Grant-specific capacity leaves the legacy three-session aggregate unchanged. */
export const integratorSessionCapacityAfterPublicationBatchGrantForJournal = (
  records: JournalHistorySource,
  responsibility: IntegratorSessionCorrelation,
  grantAt: JournalPosition
): IntegratorSessionCapacity => {
  const aggregate = integratorSessionCapacityForJournal(records, responsibility)
  if (aggregate._tag === "NoFixedSession") return aggregate
  const latestGrantAt = latestPublicationBatchGrantAtForResponsibility(records, responsibility)
  if (latestGrantAt !== grantAt) return { _tag: "Exhausted", fixedSessionIds: aggregate.fixedSessionIds }
  const consumedSessionIds = new Set<IntegratorSessionId>()
  for (const record of journalRecordsOfKind(records, "IntegratorAutomaticSuccessorSessionFixed")) {
    const { event } = record
    if (
      event._tag === "IntegratorAutomaticSuccessorSessionFixed" &&
      record.position > grantAt &&
      event.publicationBatchGrantAt === grantAt &&
      integratorSuccessorResponsibilityMatches(responsibility, event.successor)
    ) {
      consumedSessionIds.add(event.successor.sessionId)
    }
  }
  return consumedSessionIds.size < maximumIntegratorSessionsPerPublicationBatch
    ? {
        _tag: "Available",
        fixedSessionIds: aggregate.fixedSessionIds,
        nextGeneration: IntegratorAutomaticSuccessorGeneration.make(aggregate.fixedSessionIds.size + 1)
      }
    : { _tag: "Exhausted", fixedSessionIds: aggregate.fixedSessionIds }
}
