/* eslint-disable functional/immutable-data -- Build one derived identity set from immutable journal evidence. */
import type { JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import { journalRecordsOfKind } from "../../../workflow-journal/record-evidence.js"
import {
  integratorSuccessorResponsibilityMatches,
  maximumIntegratorSessionsPerResponsibility,
  type IntegratorSessionId,
  type IntegratorSessionCorrelation
} from "./events.js"

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
      readonly nextGeneration: number
    }
  | { readonly _tag: "Exhausted"; readonly fixedSessionIds: ReadonlySet<IntegratorSessionId> }

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
  return fixedSessionIds.size < maximumIntegratorSessionsPerResponsibility
    ? { _tag: "Available", fixedSessionIds, nextGeneration: fixedSessionIds.size + 1 }
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
    event._tag === "IntegratorSessionFixed"
      ? [{ _tag: "Initial" as const, correlation: event.correlation }]
      : []
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
