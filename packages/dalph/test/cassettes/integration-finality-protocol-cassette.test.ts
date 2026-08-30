import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  AttemptQuiescenceProof,
  JournalPosition,
  JournalRecord,
  PlannedAttemptExecutorWorkReportedEvent,
  reduceWorkflowJournalHistory
} from "@dalph/orchestrator"
import {
  maintainedAuthoredCassetteCatalog,
  maintainedIntegrationFinalityProtocolCassetteCatalog,
  runAuthoredScenarioCassette,
  runIntegrationFinalityProtocolCassetteFromPromotedRecords
} from "../../src/cassettes/index.js"
import { IntegrationFinalityProtocolCassette } from "../../src/cassettes/integration-finality-protocol-cassette-domain.js"

const runAuthored = (input: unknown) => runAuthoredScenarioCassette(input).pipe(Effect.provide(NodeCrypto.layer))

type ReplacementRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptReplaced" }>
}

type ExecutorWorkReportedRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorWorkReported" }>
}

const replacementRecordFor = Effect.fn("IntegrationFinalityProtocolCassetteTest.replacementRecordFor")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const replacement = records.findLast(
    (record): record is ReplacementRecord => record.event._tag === "PlannedAttemptReplaced"
  )
  if (replacement?.event._tag !== "PlannedAttemptReplaced") {
    return yield* Effect.die("replacement fixture did not record its replacement event")
  }
  return replacement
})

it.effect("accepts a promoted history containing a replacement plan while selecting the promoted plan", () =>
  Effect.gen(function* () {
    const promoted = yield* runAuthored(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const unrelated = yield* runAuthored(maintainedAuthoredCassetteCatalog.changedAttemptRestartsCleanly)
    const replacement = yield* replacementRecordFor(unrelated.records)

    expect(unrelated.history._tag).toBe("ValidWorkflowJournalHistory")

    const replacementRecord = JournalRecord.make({
      event: replacement.event,
      key: replacement.key,
      position: JournalPosition.make(promoted.records.length + 1),
      runId: unrelated.runId
    })
    const finalized = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(
      maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess,
      [...promoted.records, replacementRecord]
    )

    expect(finalized.failureTag).toBeNull()
    expect(finalized.records.some(({ event }) => event._tag === "IntegrationFinalitySettled")).toBe(true)
  })
)

it.effect("rejects Executing and terminal reports as replacement quiescence witnesses", () =>
  Effect.gen(function* () {
    const safelyReplaced = yield* runAuthored(maintainedAuthoredCassetteCatalog.changedAttemptRestartsCleanly)
    const replacement = yield* replacementRecordFor(safelyReplaced.records)
    const executing = safelyReplaced.records.find(
      (record): record is ExecutorWorkReportedRecord =>
        record.event._tag === "PlannedAttemptExecutorWorkReported" &&
        record.event.report._tag === "ExecutorWorkExecuting"
    )
    const safelySuspended = safelyReplaced.records.find(
      (record): record is ExecutorWorkReportedRecord =>
        record.event._tag === "PlannedAttemptExecutorWorkReported" &&
        record.event.report._tag === "ExecutorWorkSafelySuspended"
    )
    if (
      executing === undefined ||
      safelySuspended === undefined ||
      safelySuspended.event.report._tag !== "ExecutorWorkSafelySuspended"
    ) {
      return yield* Effect.die("replacement fixture did not record its executor lifecycle reports")
    }

    const executingWitness = safelyReplaced.records.map((record) =>
      record === replacement
        ? {
            ...record,
            event: {
              ...replacement.event,
              witness: {
                ...replacement.event.witness,
                quiescenceProof: Schema.decodeUnknownSync(AttemptQuiescenceProof)({
                  _tag: "AcceptedReport",
                  reportOrdinal: executing.event.ordinal
                })
              }
            }
          }
        : record
    )
    const executingReduction = reduceWorkflowJournalHistory(safelyReplaced.runId, executingWitness)
    expect(executingReduction).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("current unbroken accepted Safe suspension") })
      ])
    })

    const terminal = yield* runAuthored(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const terminalReport = terminal.records.find(
      (record): record is ExecutorWorkReportedRecord =>
        record.event._tag === "PlannedAttemptExecutorWorkReported" &&
        record.event.report._tag === "ExecutorWorkTerminal" &&
        record.event.report.result._tag === "Accepted"
    )
    if (
      terminalReport === undefined ||
      terminalReport.event.report._tag !== "ExecutorWorkTerminal" ||
      terminalReport.event.report.result._tag !== "Accepted"
    ) {
      return yield* Effect.die("terminal fixture did not record its accepted terminal report")
    }
    const terminalWitness = safelyReplaced.records.map((record) => {
      if (
        record.event._tag !== "PlannedAttemptExecutorWorkReported" ||
        record.event.report._tag !== "ExecutorWorkSafelySuspended"
      ) {
        return record
      }
      const event = Schema.decodeUnknownSync(PlannedAttemptExecutorWorkReportedEvent)({
        ...record.event,
        report: { ...terminalReport.event.report, correlation: record.event.report.correlation }
      })
      return { ...record, event }
    })
    const terminalReduction = reduceWorkflowJournalHistory(safelyReplaced.runId, terminalWitness)
    expect(terminalReduction).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("current unbroken accepted Safe suspension") })
      ])
    })
  })
)

it("rejects active-record absence as a completion-marker absence result", () => {
  const exact =
    maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess
  const collapsed = {
    ...exact,
    boundaryResults: exact.boundaryResults.map((result) =>
      result._tag === "ReadCompletionMarkerAbsent" ? { _tag: "ReadUnclaimed" } : result
    )
  }

  expect(() => Schema.decodeUnknownSync(IntegrationFinalityProtocolCassette)(collapsed)).toThrow()
})
