import { Schema } from "effect"
import { JournalRecord } from "./journal-store.js"
import { RecordedCassette, type RecordedCassette as RecordedCassetteType } from "./recorded-cassette-domain.js"

const EncodingSize = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const ObservationEncodingSize = Schema.Struct({
  journalBytes: EncodingSize,
  occurrenceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  recordedCassetteBytes: EncodingSize
})

/** Measured UTF-8 sizes for the two graph-observation representations. */
export const TrackerObservationEncodingMeasurement = Schema.Struct({
  changedGraphObservations: ObservationEncodingSize,
  unchangedGraphReconfirmations: ObservationEncodingSize
})
export type TrackerObservationEncodingMeasurement = typeof TrackerObservationEncodingMeasurement.Type

const encodedByteLength = (encoded: unknown): number => new TextEncoder().encode(JSON.stringify(encoded)).byteLength

const observationSize = (
  records: ReadonlyArray<JournalRecord>,
  cassette: RecordedCassetteType,
  observationTag: "CompleteTaskTrackerFacts" | "UnchangedTaskTrackerFactsReconfirmed"
) => {
  const selectedRecords = records.filter(
    ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.observation._tag === observationTag
  )
  const selectedEntries = cassette.entries.filter(
    (entry) => entry._tag === "TaskTrackerFactsObserved" && entry.evidence._tag === observationTag
  )
  return {
    journalBytes: encodedByteLength(Schema.encodeUnknownSync(Schema.Array(JournalRecord))(selectedRecords)),
    occurrenceCount: selectedRecords.length,
    recordedCassetteBytes: encodedByteLength(
      Schema.encodeUnknownSync(RecordedCassette)(RecordedCassette.make({ ...cassette, entries: selectedEntries }))
    )
  }
}

/** Reports measured changed/full and unchanged/reconfirmed observation sizes. */
export const measureTrackerObservationEncoding = (
  records: ReadonlyArray<JournalRecord>,
  cassette: RecordedCassetteType
): TrackerObservationEncodingMeasurement =>
  TrackerObservationEncodingMeasurement.make({
    changedGraphObservations: observationSize(records, cassette, "CompleteTaskTrackerFacts"),
    unchangedGraphReconfirmations: observationSize(records, cassette, "UnchangedTaskTrackerFactsReconfirmed")
  })
