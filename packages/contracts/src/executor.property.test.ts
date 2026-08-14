import { Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorRequest,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport
} from "./executor.js"
import { AttemptId, PlannedTaskAttempt } from "./planned-attempt.js"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "./git-locator.js"
import { makeTaskWorkSpecification } from "./task-work-specification.js"
import { RunId } from "./workflow-identity.js"
import { TaskExecutorLocator } from "./executor-locator.js"
import { TaskId } from "./task-identity.js"

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

const exactRequestArbitrary = fc
  .record({
    body: fc.string({ maxLength: 40 }),
    suffix: fc.stringMatching(/^[a-z0-9]{1,16}$/),
    title: fc.string({ minLength: 1, maxLength: 40 })
  })
  .map(({ body, suffix, title }) => {
    const taskId = TaskId.make(`task-${suffix}`)
    const specification = makeTaskWorkSpecification({ body, taskId, title })
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make(`attempt-${suffix}`),
      baseSha: GitCommitSha.make("0".repeat(40)),
      branch: TaskBranchRef.make(`refs/heads/task-${suffix}`),
      executor: TaskExecutorLocator.make("executor:property"),
      runId: RunId.make(`run-${suffix}`),
      taskId,
      taskRevision: specification.fingerprint,
      worktree: WorktreeLocator.make(`/worktrees/task-${suffix}`)
    })
    return PlannedAttemptExecutorRequest.make({ plannedAttempt, specification })
  })

it("roundtrips every generated exact planned-attempt work request", () => {
  fc.assert(
    fc.property(exactRequestArbitrary, (request) => {
      const encoded = Schema.encodeUnknownSync(PlannedAttemptExecutorRequest)(request)
      expect(Schema.decodeUnknownSync(PlannedAttemptExecutorRequest)(encoded)).toEqual(request)
    })
  )
})

it("roundtrips all six normalized projection outcomes for arbitrary correlations", () => {
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
          _tag: "InitializationCorrelationContradiction" as const,
          correlation,
          detail: "server platform identity contradicts the host"
        },
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
