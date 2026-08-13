import { Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport
} from "./executor.js"
import { AttemptId } from "./planned-attempt.js"
import { RunId } from "./workflow-identity.js"

const nonEmptyId = fc.string({ minLength: 1, maxLength: 20 })
const correlationArbitrary = fc
  .record({ attemptId: nonEmptyId, runId: nonEmptyId })
  .map((encoded) =>
    Schema.decodeUnknownSync(PlannedAttemptExecutorCorrelation)({
      attemptId: AttemptId.make(encoded.attemptId),
      runId: RunId.make(encoded.runId)
    })
  )
const reportFor = (correlation: PlannedAttemptExecutorCorrelation) =>
  fc.constantFrom(
    { _tag: "Running" as const, correlation },
    { _tag: "SafelySuspended" as const, correlation },
    { _tag: "Terminal" as const, correlation, result: { _tag: "Completed" as const } },
    { _tag: "Terminal" as const, correlation, result: { _tag: "Failed" as const } }
  )
const correlatedReportArbitrary = correlationArbitrary.chain((correlation) =>
  reportFor(correlation).map((report) => ({ correlation, report }))
)

it("roundtrips all five normalized projection outcomes for arbitrary correlations", () => {
  fc.assert(
    fc.property(correlationArbitrary, correlatedReportArbitrary, (correlation, { report }) => {
      const foreignAttemptCorrelation = {
        attemptId: AttemptId.make(`${correlation.attemptId}-foreign-attempt`),
        runId: correlation.runId
      }
      const foreignRunCorrelation = {
        attemptId: correlation.attemptId,
        runId: RunId.make(`${correlation.runId}-foreign-run`)
      }
      const projections = [
        { _tag: "Exact" as const, report },
        { _tag: "NoReport" as const, correlation },
        { _tag: "TemporarilyUnavailable" as const, correlation },
        { _tag: "Unreadable" as const, correlation },
        {
          _tag: "CorrelationContradiction" as const,
          expected: correlation,
          observed: { ...report, correlation: foreignAttemptCorrelation }
        },
        {
          _tag: "CorrelationContradiction" as const,
          expected: correlation,
          observed: { ...report, correlation: foreignRunCorrelation }
        }
      ]

      for (const projection of projections) {
        const decoded = Schema.decodeUnknownSync(PlannedAttemptExecutorProjection)(
          Schema.encodeUnknownSync(PlannedAttemptExecutorProjection)(projection)
        )
        expect(decoded).toEqual(projection)
      }
    })
  )
})

it("rejects arbitrary contradictions whose observed report is not foreign", () => {
  fc.assert(
    fc.property(correlatedReportArbitrary, ({ correlation, report }) => {
      expect(() =>
        Schema.decodeUnknownSync(PlannedAttemptExecutorProjection)({
          _tag: "CorrelationContradiction",
          expected: correlation,
          observed: report
        })
      ).toThrow()
    })
  )
})

it("keeps exact identity in the report, so a mismatched outer identity cannot be constructed", () => {
  const report = PlannedAttemptExecutorReport.cases.Running.make({
    correlation: { attemptId: AttemptId.make("attempt"), runId: RunId.make("run") }
  })
  const exact = PlannedAttemptExecutorProjection.cases.Exact.make({ report })
  expect(exact).toEqual({ _tag: "Exact", report })
  expect(Object.keys(exact)).toEqual(["_tag", "report"])
})
