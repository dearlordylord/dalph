import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { PlannedAttemptExecutorReport, type PlannedTaskAttempt } from "@dalph/contracts"
import { acceptedResultFixture } from "../../../../test/support/evidence.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import {
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey
} from "../../../workflow-journal/record-key.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal
} from "../planned-attempt-executor-work/events.js"
import { AttemptQuiescenceProof } from "./events.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { exactExecutorQuiescenceEvidence } from "./restart-authority-evidence.js"
import { appendReplacementProvenance } from "../disposition-cleanup/provenance-fixtures.js"
import { attempt, runId, successor } from "../disposition-cleanup/fixtures.js"

const begin = Effect.gen(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make("restart-authority-evidence-test"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  yield* appendReplacementProvenance(attempt, successor)
  return journal
})

type RestartApplication = NonNullable<Parameters<typeof exactExecutorQuiescenceEvidence>[5]>

const restartApplication = (records: ReadonlyArray<JournalRecord>): RestartApplication | undefined =>
  records.find((record): record is RestartApplication => record.event._tag === "AttemptChoiceApplied")

const restartWindow = (records: ReadonlyArray<JournalRecord>) => {
  const application = restartApplication(records)
  const replacement = records.find(({ event }) => event._tag === "PlannedAttemptReplaced")
  if (application === undefined || replacement === undefined) expect.fail("replacement fixture is incomplete")
  return { after: application.position, before: replacement.position }
}

type ProjectionKind = "CommandProjection" | "StateProjection"
type ProjectionObservation = "ExactExecutorReport" | "Unavailable"

const replaceReportWithProjection = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  kind: ProjectionKind,
  observation: ProjectionObservation = "ExactExecutorReport"
): ReadonlyArray<JournalRecord> => {
  const reportRecord = records.find(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
  if (reportRecord?.event._tag !== "PlannedAttemptExecutorWorkReported") expect.fail("executor report is missing")
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  const projectionOrdinal = PlannedAttemptExecutorCommandProjectionOrdinal.make(1)
  const stateOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
  const projectedEvent =
    kind === "CommandProjection"
      ? PlannedAttemptExecutorCommandProjectionObservedEvent.make({
          commandOrdinal,
          observation:
            observation === "ExactExecutorReport"
              ? PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
                  report: reportRecord.event.report
                })
              : PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorStateTemporarilyUnavailable.make({}),
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt,
          projectionOrdinal,
          version: workflowJournalEventVersion
        })
      : PlannedAttemptExecutorStateObservedEvent.make({
          observation:
            observation === "ExactExecutorReport"
              ? PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
                  report: reportRecord.event.report
                })
              : PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({}),
          occurrenceClassification: "NonActionOccurrence",
          ordinal: stateOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
  const key =
    kind === "CommandProjection"
      ? plannedAttemptExecutorCommandProjectionObservedRecordKey(
          plannedAttempt.attemptId,
          commandOrdinal,
          projectionOrdinal
        )
      : plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, stateOrdinal)
  return records.map((record) => (record === reportRecord ? { ...record, event: projectedEvent, key } : record))
}

const replaceReport = (
  records: ReadonlyArray<JournalRecord>,
  report: PlannedAttemptExecutorReport
): ReadonlyArray<JournalRecord> =>
  records.map((record) =>
    record.event._tag === "PlannedAttemptExecutorWorkReported"
      ? { ...record, event: { ...record.event, report } }
      : record
  )

const expectedCommandResponse = AttemptQuiescenceProof.cases.CommandResponse.make({
  reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1)
})

const exact = (
  records: ReadonlyArray<JournalRecord>,
  expected: AttemptQuiescenceProof = expectedCommandResponse,
  application?: Parameters<typeof exactExecutorQuiescenceEvidence>[5]
) => {
  const window = restartWindow(records)
  return exactExecutorQuiescenceEvidence(records, attempt, window.after, window.before, expected, application)
}

it.effect("accepts exact command-response, command-projection, and state-projection witnesses", () =>
  Effect.gen(function* () {
    yield* begin
    const records = yield* (yield* JournalStore).read(runId)
    const application = restartApplication(records)
    expect(application).toBeDefined()
    expect(exact(records)).toBe(true)
    const commandRecords = replaceReportWithProjection(records, attempt, "CommandProjection")
    expect(
      exact(
        commandRecords,
        AttemptQuiescenceProof.cases.CommandProjection.make({
          commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
          projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1)
        })
      )
    ).toBe(true)
    expect(
      exact(
        commandRecords.map((record) =>
          record.event._tag === "PlannedAttemptExecutorCommandProjectionObserved"
            ? { ...record, key: JournalRecordKey.make("foreign-projection-key") }
            : record
        ),
        AttemptQuiescenceProof.cases.CommandProjection.make({
          commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
          projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1)
        })
      )
    ).toBe(false)
    const stateRecords = replaceReportWithProjection(records, attempt, "StateProjection")
    expect(
      exact(
        stateRecords,
        AttemptQuiescenceProof.cases.StateProjection.make({
          observationOrdinal: PlannedAttemptExecutorStateObservationOrdinal.make(1)
        })
      )
    ).toBe(true)
    expect(exact(commandRecords, expectedCommandResponse)).toBe(false)
    expect(exact(stateRecords, expectedCommandResponse)).toBe(false)
    if (application !== undefined) {
      expect(exact(records, expectedCommandResponse, application)).toBe(true)
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects executor witnesses with missing responsibility, command, projection, or exact proof", () =>
  Effect.gen(function* () {
    yield* begin
    const records = yield* (yield* JournalStore).read(runId)
    expect(exact(records.filter(({ event }) => event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan"))).toBe(
      false
    )
    expect(exact(records.filter(({ event }) => event._tag !== "PlannedAttemptExecutorCommandIntended"))).toBe(false)
    expect(exact(replaceReportWithProjection(records, attempt, "CommandProjection", "Unavailable"))).toBe(false)
    expect(
      exact(
        replaceReportWithProjection(records, attempt, "CommandProjection"),
        AttemptQuiescenceProof.cases.CommandProjection.make({
          commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(2),
          projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1)
        })
      )
    ).toBe(false)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects an executor report followed by another command and rejects completed Restart reports", () =>
  Effect.gen(function* () {
    yield* begin
    const records = yield* (yield* JournalStore).read(runId)
    const command = records.find(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
    const report = records.find(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
    if (command?.event._tag !== "PlannedAttemptExecutorCommandIntended" || report === undefined) {
      expect.fail("replacement fixture lacks command or report")
    }
    const ordinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    const laterCommand: JournalRecord = {
      ...command,
      event: PlannedAttemptExecutorCommandIntendedEvent.make({ ...command.event, ordinal }),
      key: plannedAttemptExecutorCommandIntendedRecordKey(attempt.attemptId, ordinal),
      position: JournalPosition.make(Number(report.position) + 1)
    }
    expect(exact([...records, laterCommand])).toBe(false)
    const completed = replaceReport(
      records,
      PlannedAttemptExecutorReport.cases.Terminal.make({
        correlation: { attemptId: attempt.attemptId, runId },
        result: { _tag: "Completed" }
      })
    )
    const application = restartApplication(records)
    expect(application).toBeDefined()
    if (application !== undefined) expect(exact(completed, expectedCommandResponse, application)).toBe(false)
    const accepted = replaceReport(
      records,
      PlannedAttemptExecutorReport.cases.Terminal.make({
        correlation: { attemptId: attempt.attemptId, runId },
        result: { _tag: "Accepted", acceptedResult: acceptedResultFixture(attempt.baseSha) }
      })
    )
    if (application !== undefined) expect(exact(accepted, expectedCommandResponse, application)).toBe(true)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
