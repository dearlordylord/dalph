import { Schema } from "effect"
import {
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { exactTargetLineageRecord } from "../integration-quarantine/canonical-lineage.js"
import {
  integrationQuarantineDirectionSubject,
  type IntegrationQuarantineDirectionAppliedEvent,
  type IntegrationQuarantinedEvent
} from "../integration-quarantine/events.js"
import {
  IntegratorSessionCorrelation,
  integratorSuccessorResponsibilityMatches,
  integratorSuccessorIdentitiesAreDistinct
} from "./events.js"

type SuccessorRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSuccessorSessionFixed" }>
}
type QuarantineRecord = JournalRecord & { readonly event: IntegrationQuarantinedEvent }
type DirectionRecord = JournalRecord & { readonly event: IntegrationQuarantineDirectionAppliedEvent }
type ExactLineageEvidence = NonNullable<ReturnType<typeof exactTargetLineageRecord>>

const correlationEquivalence = Schema.toEquivalence(IntegratorSessionCorrelation)

const runIdFor = (correlation: IntegratorSessionCorrelation) => correlation.plannedAttempt.runId

const recordAt = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): JournalRecord | undefined => {
  const matches = records.filter((record) => record.position === position)
  return matches.length === 1 ? matches[0] : undefined
}

const isSuccessorRecord = (record: JournalRecord | undefined): record is SuccessorRecord =>
  record?.event._tag === "IntegratorSuccessorSessionFixed"

const isQuarantineRecord = (record: JournalRecord | undefined): record is QuarantineRecord =>
  record?.event._tag === "IntegrationQuarantined"

const isDirectionRecord = (record: JournalRecord | undefined): record is DirectionRecord =>
  record?.event._tag === "IntegrationQuarantineDirectionApplied"

const exactPredecessorLineage = (
  records: ReadonlyArray<JournalRecord>,
  predecessor: IntegratorSessionCorrelation,
  beforePosition: JournalPosition
): boolean =>
  exactTargetLineageRecord(
    records,
    {
      expectedTargetHead: predecessor.expectedTargetHead,
      integrationTarget: predecessor.integrationTarget,
      plannedAttempt: predecessor.plannedAttempt,
      targetLineageObservedAt: predecessor.targetLineageObservedAt
    },
    { beforePosition }
  ) !== undefined

const exactPredecessorSession = (
  records: ReadonlyArray<JournalRecord>,
  predecessor: IntegratorSessionCorrelation,
  beforePosition: JournalPosition
): JournalRecord | undefined => {
  const key = integratorSessionFixedRecordKey({
    acceptedResult: predecessor.acceptedResult,
    integrationTarget: predecessor.integrationTarget,
    plannedAttempt: predecessor.plannedAttempt,
    queuedAt: predecessor.queuedAt,
    startedAt: predecessor.startedAt
  })
  const matches = records.filter(
    (record) =>
      record.event._tag === "IntegratorSessionFixed" &&
      record.key === key &&
      record.runId === runIdFor(predecessor) &&
      correlationEquivalence(record.event.correlation, predecessor) &&
      record.position > predecessor.targetLineageObservedAt &&
      record.position < beforePosition
  )
  return matches.length === 1 ? matches[0] : undefined
}

const exactQuarantine = (
  records: ReadonlyArray<JournalRecord>,
  successor: SuccessorRecord,
  predecessor: IntegratorSessionCorrelation
): QuarantineRecord | undefined => {
  const record = recordAt(records, successor.event.quarantineAt)
  if (!isQuarantineRecord(record)) return undefined
  return record.runId === runIdFor(predecessor) &&
    record.key === integrationQuarantinedRecordKey(predecessor.sessionId, record.event.basis) &&
    correlationEquivalence(record.event.correlation, predecessor) &&
    predecessor.targetLineageObservedAt < record.position &&
    record.position < successor.event.directionAppliedAt
    ? record
    : undefined
}

const exactDirection = (
  records: ReadonlyArray<JournalRecord>,
  successor: SuccessorRecord,
  predecessor: IntegratorSessionCorrelation,
  quarantine: QuarantineRecord
): DirectionRecord | undefined => {
  const record = recordAt(records, successor.event.directionAppliedAt)
  if (!isDirectionRecord(record)) return undefined
  const subject = integrationQuarantineDirectionSubject(record.event.fingerprint)
  return record.runId === runIdFor(predecessor) &&
    record.key === integrationQuarantineDirectionAppliedRecordKey(subject) &&
    record.event.fingerprint.direction === "FullRerun" &&
    record.event.fingerprint.quarantineAt === quarantine.position &&
    record.event.fingerprint.sessionId === predecessor.sessionId &&
    record.event.requestId.runId === runIdFor(predecessor) &&
    quarantine.position < record.position
    ? record
    : undefined
}

const exactSuccessorLineage = (
  records: ReadonlyArray<JournalRecord>,
  successor: SuccessorRecord,
  direction: DirectionRecord
): ExactLineageEvidence | undefined =>
  exactTargetLineageRecord(
    records,
    {
      expectedTargetHead: successor.event.successor.expectedTargetHead,
      integrationTarget: successor.event.successor.integrationTarget,
      plannedAttempt: successor.event.successor.plannedAttempt,
      targetLineageObservedAt: successor.event.successor.targetLineageObservedAt
    },
    { afterPosition: direction.position, beforePosition: successor.position }
  )

/**
 * Reconstructs the one canonical FullRerun S1/Q/D/L/S2 relation.  State
 * reconstruction and delivery use this evaluator so a record position alone
 * can never promote a successor: each authority fact must retain its durable
 * Run, deterministic key, operation identity, and exact chronology.
 */
export const evaluateIntegratorFullRerunSuccessor = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord,
  predecessor: IntegratorSessionCorrelation
):
  | {
      readonly _tag: "Valid"
      readonly direction: DirectionRecord
      readonly lineage: ExactLineageEvidence
      readonly quarantine: QuarantineRecord
      readonly record: SuccessorRecord
      readonly successor: IntegratorSessionCorrelation
    }
  | { readonly _tag: "Invalid"; readonly detail: string } => {
  if (!isSuccessorRecord(record)) {
    return { _tag: "Invalid", detail: "FullRerun successor record has an unknown event" }
  }
  const successor = record
  if (!correlationEquivalence(successor.event.predecessor, predecessor)) {
    return { _tag: "Invalid", detail: "FullRerun successor names a foreign predecessor" }
  }
  if (successor.runId !== runIdFor(predecessor)) {
    return { _tag: "Invalid", detail: "FullRerun successor is recorded under a foreign Journal Run" }
  }
  if (
    successor.key !==
    integratorSuccessorSessionFixedRecordKey(
      predecessor,
      successor.event.quarantineAt,
      successor.event.directionAppliedAt
    )
  ) {
    return { _tag: "Invalid", detail: "FullRerun successor appears under a foreign key" }
  }
  if (!integratorSuccessorIdentitiesAreDistinct(predecessor, successor.event.successor)) {
    return { _tag: "Invalid", detail: "FullRerun successor reuses predecessor identity" }
  }
  if (!integratorSuccessorResponsibilityMatches(predecessor, successor.event.successor)) {
    return { _tag: "Invalid", detail: "FullRerun successor changes the planned responsibility" }
  }
  if (exactPredecessorSession(records, predecessor, successor.event.quarantineAt) === undefined) {
    return { _tag: "Invalid", detail: "FullRerun successor lacks the exact predecessor fixed session S1" }
  }
  if (!exactPredecessorLineage(records, predecessor, successor.event.quarantineAt)) {
    return { _tag: "Invalid", detail: "FullRerun successor lacks the exact predecessor target-lineage read" }
  }
  const quarantine = exactQuarantine(records, successor, predecessor)
  if (quarantine === undefined) {
    return { _tag: "Invalid", detail: "FullRerun successor lacks the exact canonical quarantine Q" }
  }
  const direction = exactDirection(records, successor, predecessor, quarantine)
  if (direction === undefined) {
    return { _tag: "Invalid", detail: "FullRerun successor lacks the exact canonical FullRerun direction D" }
  }
  if (successor.event.successor.targetLineageObservedAt <= direction.position) {
    return { _tag: "Invalid", detail: "FullRerun successor fresh target-lineage read must follow D" }
  }
  const lineage = exactSuccessorLineage(records, successor, direction)
  if (lineage === undefined) {
    return { _tag: "Invalid", detail: "FullRerun successor lacks the exact fresh target-lineage read L" }
  }
  if (successor.position <= successor.event.successor.targetLineageObservedAt) {
    return { _tag: "Invalid", detail: "FullRerun successor must be fixed after its fresh target-lineage read" }
  }
  return { _tag: "Valid", direction, lineage, quarantine, record: successor, successor: successor.event.successor }
}
