import { corpusReplayFor } from "../../../../scripts/mbt-corpus-replay.mjs"
import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  PlannedTaskAttempt,
  PlannedAttemptExecutorReport,
  PlannedAttemptResultResponseCount,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { integrationFinalityFixture } from "../../../orchestrator/src/workflow/protocols/integration-finality/fixtures.js"
import { IntegrationStartedEvent } from "../../../orchestrator/src/workflow/protocols/integration-admission/events.js"
import { TaskAttemptPlannedEvent } from "../../../orchestrator/src/workflow/registry/event.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import { JournalPosition, JournalRecordKey } from "../../../orchestrator/src/workflow-journal/identity.js"
import { JournalRecord } from "../../../orchestrator/src/workflow-journal/store.js"
import { resultRecoveryDirectedRecordKey } from "../../../orchestrator/src/workflow-journal/record-key.js"
import { latestAcceptedPlannedAttemptExecutorEvidence } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/evidence.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"
import {
  ApplyResultRecoveryRequest,
  ResultRecoveryDirectedEvent
} from "../../../orchestrator/src/workflow/protocols/result-recovery/events.js"
import { ResultRecoveryAttemptReplacedEvent } from "../../../orchestrator/src/workflow/protocols/result-recovery/replacement-events.js"
import {
  evaluateResultRecoveryDirectionApplication,
  resultRecoveryDirectionProblem
} from "../../../orchestrator/src/workflow/protocols/result-recovery/protocol.js"

const { quintIt, quintRun } = corpusReplayFor("packages/dalph/test/conformance/result-recovery-direction.mbt.test.ts")

const fixture = integrationFinalityFixture
const attempt = fixture.plannedAttempt
const tag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)
const requestProjection = Schema.Struct({
  nonce: ITFBigInt,
  plan: Schema.Unknown,
  sameRun: Schema.Boolean,
  direction: Schema.Unknown,
  subject: Schema.Unknown,
  ordinal: ITFBigInt
})
const projection = Schema.Struct({
  state: Schema.Struct({
    report: Schema.Unknown,
    ordinal: ITFBigInt,
    stopped: Schema.Boolean,
    integrated: Schema.Boolean,
    replaced: Schema.Boolean,
    applications: ITFBigInt,
    outcome: Schema.Unknown,
    active: Schema.Boolean,
    terminalSeal: Schema.Unknown
  })
})

// These controlled rows represent already accepted facts at the pure admission
// seam. This driver never constructs an AcceptedJournalPrefix certificate and
// does not claim cold-history, fresh-authority, provider or native custody proof.
const makeDirectionDriver = (authorizeStale = false, onMutation: () => void = () => undefined) =>
  defineDriver(
    {
      init: {},
      observeInitial: { kind: Schema.Unknown, stopped: Schema.Boolean },
      observeLater: { kind: Schema.Unknown, stopped: Schema.Boolean },
      apply: { selected: requestProjection },
      recheck: { retained: requestProjection },
      beginIntegration: {},
      replaceAttempt: {},
      crash: {},
      recover: {}
    },
    () => {
      let records: ReadonlyArray<JournalRecord> = []
      let active = true
      let outcome = "NoOutcome"
      let selected: ApplyResultRecoveryRequest | undefined
      const append = (event: JournalRecord["event"], key?: JournalRecordKey) => {
        const position = JournalPosition.make(records.length + 1)
        records = [
          ...records,
          { event, position, runId: attempt.runId, key: key ?? JournalRecordKey.make(`recovery-model:${position}`) }
        ]
      }
      const observe = (kind: unknown, stopped: boolean, ordinal: number) => {
        const report =
          tag(kind) === "Rejected"
            ? PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
                correlation: plannedAttemptExecutorCorrelation(attempt),
                reason: "ResultEnvelopeInvalid",
                recoveryCause: "CorrectionExhausted",
                responseCount: PlannedAttemptResultResponseCount.make(3),
                custody: { _tag: stopped ? "Stopped" : "Unresolved" }
              })
            : PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                correlation: plannedAttemptExecutorCorrelation(attempt),
                result:
                  tag(kind) === "HistoricalFailed"
                    ? { _tag: "Failed" }
                    : tag(kind) === "KnownFailed"
                      ? { _tag: "Failed", failureCode: "ProviderFailed" }
                      : tag(kind) === "Accepted"
                        ? { _tag: "Accepted", acceptedResult: fixture.acceptedResult }
                        : { _tag: "Completed" }
              })
        append(
          PlannedAttemptExecutorWorkReportedEvent.make({
            report,
            ordinal: PlannedAttemptExecutorReportOrdinal.make(ordinal),
            version: workflowJournalEventVersion
          })
        )
        outcome = "NoOutcome"
      }
      const decodeRequest = (input: typeof requestProjection.Type) =>
        Schema.decodeUnknownEffect(ApplyResultRecoveryRequest)({
          direction:
            tag(input.direction) === "ContinueRetained" ? "ContinueRetainedAttempt" : "RestartTaskImplementation",
          requestId: { nonce: `request:${input.nonce}`, runId: input.sameRun ? attempt.runId : "foreign-run" },
          subject: {
            _tag: tag(input.subject) === "RejectionSubject" ? "RejectedResult" : "HistoricalUnknownFailure",
            reportOrdinal: Number(input.ordinal),
            plannedAttempt: tag(input.plan) === "OwnerPlan" ? attempt : { ...attempt, worktree: "/foreign/worktree" }
          }
        })
      const reportKind = (report: PlannedAttemptExecutorReport | undefined): string => {
        if (report === undefined) return "NoReport"
        if (report._tag === "ExecutorWorkResultRejected") return "Rejected"
        if (report._tag !== "ExecutorWorkTerminal") throw new Error("unexpected model report")
        return report.result._tag === "Failed"
          ? report.result.failureCode === undefined
            ? "HistoricalFailed"
            : "KnownFailed"
          : report.result._tag
      }
      return {
        init: () =>
          Effect.sync(() => {
            records = []
            active = true
            outcome = "NoOutcome"
            selected = undefined
            append(
              TaskAttemptPlannedEvent.make({ operation: fixture.planOperation, version: workflowJournalEventVersion })
            )
          }),
        observeInitial: ({ kind, stopped }) => Effect.sync(() => observe(kind, stopped, 1)),
        observeLater: ({ kind, stopped }) => Effect.sync(() => observe(kind, stopped, 2)),
        apply: ({ selected: input }) =>
          Effect.gen(function* () {
            const decoded = yield* decodeRequest(input).pipe(Effect.result)
            if (decoded._tag === "Failure") {
              outcome = "Unavailable"
              return
            }
            const decision = evaluateResultRecoveryDirectionApplication(decoded.success, attempt.runId, records)
            outcome = decision._tag === "RecordNewDirection" ? "Recorded" : decision._tag
            if (decision._tag === "RecordNewDirection")
              append(
                ResultRecoveryDirectedEvent.make({
                  ...decoded.success,
                  initiatedBy: { _tag: "Operator" },
                  occurrenceClassification: "InitiatedAction",
                  version: workflowJournalEventVersion
                }),
                resultRecoveryDirectedRecordKey(decoded.success.requestId)
              )
          }),
        recheck: ({ retained: input }) =>
          Effect.gen(function* () {
            selected = yield* decodeRequest(input)
            const problem = resultRecoveryDirectionProblem(selected, attempt.runId, records, selected.requestId)
            outcome = problem === undefined ? "Authorized" : "Unavailable"
            if (authorizeStale && problem !== undefined) {
              onMutation()
              outcome = "Authorized"
            }
          }),
        beginIntegration: () =>
          Effect.sync(() => {
            append(
              IntegrationStartedEvent.make({
                acceptedResult: fixture.acceptedResult,
                integrationTarget: fixture.integrationTarget,
                plannedAttempt: attempt,
                responsibilityBeganAt: JournalPosition.make(1),
                version: workflowJournalEventVersion
              })
            )
            outcome = "NoOutcome"
          }),
        replaceAttempt: () =>
          Effect.sync(() => {
            if (selected === undefined) throw new Error("replacement requires its directed selection")
            const reads = ["graph", "specification", "claim", "worktree", "lineage"]
            append(
              Schema.decodeUnknownSync(ResultRecoveryAttemptReplacedEvent)({
                requestId: selected.requestId,
                subject: selected.subject,
                integrationTarget: fixture.integrationTarget,
                witness: {
                  activeTaskContinuationRead: {
                    graphObservationOperationId: reads[0],
                    taskWorkSpecificationObservationOperationId: reads[1],
                    taskClaimObservationOperationId: reads[2]
                  },
                  worktreeObservationOperationId: reads[3],
                  targetLineageObservationOperationId: reads[4]
                },
                successorPlan: {
                  ...fixture.planOperation,
                  predecessorOperationIds: reads,
                  plannedAttempt: PlannedTaskAttempt.make({
                    ...attempt,
                    attemptId: PlannedTaskAttempt.fields.attemptId.make("successor"),
                    branch: PlannedTaskAttempt.fields.branch.make("refs/heads/successor"),
                    worktree: PlannedTaskAttempt.fields.worktree.make("/successor")
                  })
                },
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                version: workflowJournalEventVersion
              })
            )
            outcome = "NoOutcome"
          }),
        crash: () =>
          Effect.sync(() => {
            active = false
            outcome = "NoOutcome"
          }),
        recover: () =>
          Effect.sync(() => {
            records = records.map((record) =>
              Schema.decodeUnknownSync(JournalRecord)(JSON.parse(JSON.stringify(record)))
            )
            active = true
            outcome = "NoOutcome"
          }),
        getState: () =>
          Effect.sync(() => {
            const evidence = latestAcceptedPlannedAttemptExecutorEvidence(records, attempt)
            const terminalRecord = records.find(
              ({ event }) =>
                event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
            )
            return {
              report: reportKind(evidence?.report),
              ordinal: evidence?.source.ordinal ?? 0,
              stopped:
                evidence?.report._tag === "ExecutorWorkResultRejected"
                  ? evidence.report.custody._tag === "Stopped"
                  : false,
              integrated: records.some(({ event }) => event._tag === "IntegrationStarted"),
              replaced: records.some(({ event }) => event._tag === "ResultRecoveryAttemptReplaced"),
              applications: records.filter(({ event }) => event._tag === "ResultRecoveryDirected").length,
              outcome,
              active,
              terminalSeal: reportKind(
                terminalRecord?.event._tag === "PlannedAttemptExecutorWorkReported"
                  ? terminalRecord.event.report
                  : undefined
              )
            }
          })
      }
    }
  )
const directionStateCheck = stateCheck(
  (raw) =>
    Schema.decodeUnknownEffect(projection)(raw).pipe(
      Effect.map(({ state }) => ({
        ...state,
        report: tag(state.report),
        terminalSeal: tag(state.terminalSeal),
        outcome: tag(state.outcome),
        ordinal: Number(state.ordinal),
        applications: Number(state.applications)
      }))
    ),
  (spec, actual) =>
    spec.report === actual.report &&
    spec.ordinal === actual.ordinal &&
    spec.stopped === actual.stopped &&
    spec.integrated === actual.integrated &&
    spec.replaced === actual.replaced &&
    spec.applications === actual.applications &&
    spec.outcome === actual.outcome &&
    spec.active === actual.active &&
    spec.terminalSeal === actual.terminalSeal
)

quintIt(
  it.effect,
  "replays explicit recovery admission and redelivery through the production decision",
  {
    backend: "typescript",
    spec: "specs/resultRecoveryDirection.qnt",
    driverFactory: makeDirectionDriver(),
    nTraces: 10,
    maxSamples: 10,
    maxSteps: 15,
    seed: "428",
    stateCheck: directionStateCheck
  },
  30_000
)
it.effect(
  "detects an earlier direction incorrectly authorized after a newer accepted terminal report",
  () =>
    Effect.gen(function* () {
      const options = {
        backend: "typescript" as const,
        spec: "specs/resultRecoveryDirection.qnt",
        step: "staleDirectionMbtStep",
        nTraces: 1,
        maxSamples: 1,
        maxSteps: 6,
        seed: "428",
        stateCheck: directionStateCheck
      }
      yield* quintRun({ ...options, driverFactory: makeDirectionDriver() })
      let mutated = false
      const result = yield* quintRun({
        ...options,
        driverFactory: makeDirectionDriver(true, () => {
          mutated = true
        })
      }).pipe(Effect.result)
      expect(mutated).toBe(true)
      expect(result._tag).toBe("Failure")
    }),
  30_000
)
