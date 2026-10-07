import { corpusReplayFor } from "../../../../scripts/mbt-corpus-replay.mjs"
import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFMap, stateCheck } from "@firfi/quint-connect/effect"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  ExecutorGuidanceRequestId,
  ExecutorGuidanceSessionLocator,
  ExecutorGuidanceTurnLocator,
  ExecutorGuidanceTransmission,
  PlannedTaskAttempt,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  executorGuidanceTextByteLimit
} from "@dalph/contracts"
import { integrationFinalityFixture } from "../../../orchestrator/src/workflow/protocols/integration-finality/fixtures.js"
import { TaskAttemptPlannedEvent } from "../../../orchestrator/src/workflow/registry/event.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import { JournalRecord } from "../../../orchestrator/src/workflow-journal/store.js"
import { JournalPosition, JournalRecordKey } from "../../../orchestrator/src/workflow-journal/identity.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import {
  executorGuidanceAdmittedRecordKey,
  executorGuidanceDispatchIntendedRecordKey,
  executorGuidanceObservedRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import { journalRecordByKey } from "../../../orchestrator/src/workflow-journal/record-evidence.js"
import {
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorReportOrdinal
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"
import {
  ExecutorGuidanceMetadata,
  ExecutorGuidancePayloadBytes,
  ExecutorGuidancePayloadDigest,
  ExecutorGuidanceAdmittedEvent,
  ExecutorGuidanceDispatchIntendedEvent,
  ExecutorGuidanceObservedEvent
} from "../../../orchestrator/src/workflow/protocols/executor-guidance/events.js"
import {
  executorGuidanceDispatchProblem,
  executorGuidanceEventProblem,
  executorGuidanceRedelivery,
  type ExecutorGuidanceJournalEvent
} from "../../../orchestrator/src/workflow/protocols/executor-guidance/protocol.js"

const { quintIt, quintRun } = corpusReplayFor("packages/dalph/test/conformance/executor-guidance.mbt.test.ts")

const fixture = integrationFinalityFixture
const requestId = (nonce: number) => ExecutorGuidanceRequestId.make(`guidance-model:${nonce}`)
const attemptFor = (owner: number) =>
  PlannedTaskAttempt.make({
    ...fixture.plannedAttempt,
    attemptId: PlannedTaskAttempt.fields.attemptId.make(`guidance-model:${owner}`),
    taskId: PlannedTaskAttempt.fields.taskId.make(`guidance-model:${owner}`),
    branch: PlannedTaskAttempt.fields.branch.make(`refs/heads/guidance-model-${owner}`),
    worktree: PlannedTaskAttempt.fields.worktree.make(`/guidance-model/${owner}`)
  })
const metadataFor = (nonce: number, owner: number, digest: number) =>
  ExecutorGuidanceMetadata.make({
    requestId: requestId(nonce),
    plannedAttempt: attemptFor(owner),
    payloadDigest: ExecutorGuidancePayloadDigest.make(String(digest).repeat(64)),
    payloadBytes: ExecutorGuidancePayloadBytes.make(digest === 3 ? executorGuidanceTextByteLimit + 1 : 1)
  })
const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)
const receiptProjection = Schema.Struct({
  phase: Schema.Unknown,
  attempt: ITFBigInt,
  digest: ITFBigInt,
  selectedTurn: ITFBigInt,
  disposition: Schema.Unknown
})
const projection = Schema.Struct({
  state: Schema.Struct({ receipts: ITFMap(ITFBigInt, receiptProjection), lastIdentityContradiction: Schema.Boolean })
})

// Already accepted plan/executor rows feed the pure chronological admission seam.
// No AcceptedJournalPrefix is fabricated. Controlled owner/turn observations are
// test inputs, not native custody proof. Calls, text privacy and whole Run control
// are qualified separately by bootstrap, transport and real-Codex tests.
const makeGuidanceDriver = (ignoreContradiction = false) =>
  defineDriver(
    {
      init: {},
      admit: { nonce: ITFBigInt, attempt: ITFBigInt, digest: ITFBigInt },
      selectTurn: { nonce: ITFBigInt },
      dispatch: { nonce: ITFBigInt },
      acknowledge: { nonce: ITFBigInt, exact: Schema.Boolean, readable: Schema.Boolean },
      finishTurn: { attempt: ITFBigInt },
      loseCustody: { attempt: ITFBigInt },
      loseCapability: { attempt: ITFBigInt },
      closeAdmission: {},
      crash: {},
      recover: {},
      reconcile: { nonce: ITFBigInt }
    },
    () => {
      let records: ReadonlyArray<JournalRecord> = []
      let owned = new Set<number>()
      let capable = new Set<number>()
      let turns = new Map<number, number>()
      let contradiction = false
      const append = (event: JournalRecord["event"], key: JournalRecordKey) => {
        records = [...records, { event, key, runId: fixture.runId, position: JournalPosition.make(records.length + 1) }]
      }
      const appendGuidance = (event: ExecutorGuidanceJournalEvent, key: JournalRecordKey) => {
        const problem = executorGuidanceEventProblem(records, fixture.runId, event)
        if (problem !== undefined) throw new Error(problem)
        append(event, key)
      }
      const metadata = (nonce: number) => {
        const record = journalRecordByKey(records, executorGuidanceAdmittedRecordKey(requestId(nonce)))
        if (record?.event._tag !== "ExecutorGuidanceAdmitted") throw new Error("missing model admission")
        return record.event.metadata
      }
      const observe = (nonce: number, disposition: ExecutorGuidanceTransmission) =>
        appendGuidance(
          ExecutorGuidanceObservedEvent.make({
            requestId: requestId(nonce),
            disposition,
            version: workflowJournalEventVersion
          }),
          executorGuidanceObservedRecordKey(requestId(nonce))
        )
      const report = (owner: number, terminal: boolean) => {
        const correlation = plannedAttemptExecutorCorrelation(attemptFor(owner))
        append(
          PlannedAttemptExecutorWorkReportedEvent.make({
            report: terminal
              ? PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                  correlation,
                  result: { _tag: "Completed" }
                })
              : PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }),
            ordinal: PlannedAttemptExecutorReportOrdinal.make(terminal ? 2 : 1),
            version: workflowJournalEventVersion
          }),
          JournalRecordKey.make(`guidance-report:${owner}:${terminal}`)
        )
      }
      return {
        init: () =>
          Effect.sync(() => {
            records = []
            owned = new Set([1, 2])
            capable = new Set([1, 2])
            turns = new Map([
              [1, 1],
              [2, 1]
            ])
            contradiction = false
            for (const owner of [1, 2]) {
              append(
                TaskAttemptPlannedEvent.make({
                  operation: {
                    ...fixture.planOperation,
                    operationId: OperationId.make(`guidance-plan:${owner}`),
                    plannedAttempt: attemptFor(owner)
                  },
                  version: workflowJournalEventVersion
                }),
                JournalRecordKey.make(`guidance-plan:${owner}`)
              )
              report(owner, false)
            }
          }),
        admit: ({ attempt, digest, nonce }) =>
          Effect.sync(() => {
            const incoming = metadataFor(Number(nonce), Number(attempt), Number(digest))
            const decision = executorGuidanceRedelivery(records, incoming)
            contradiction = decision._tag === "Contradiction" && !ignoreContradiction
            if (decision._tag === "New")
              appendGuidance(
                ExecutorGuidanceAdmittedEvent.make({ metadata: incoming, version: workflowJournalEventVersion }),
                executorGuidanceAdmittedRecordKey(incoming.requestId)
              )
          }),
        selectTurn: ({ nonce }) =>
          Effect.sync(() => {
            const n = Number(nonce),
              input = metadata(n),
              owner = Number(input.plannedAttempt.attemptId.split(":").at(-1))
            if (
              input.payloadBytes > executorGuidanceTextByteLimit ||
              !owned.has(owner) ||
              !capable.has(owner) ||
              executorGuidanceDispatchProblem(records, input.plannedAttempt) !== undefined
            ) {
              observe(n, ExecutorGuidanceTransmission.cases.Refused.make({ reason: "AttemptInactive" }))
              return
            }
            appendGuidance(
              ExecutorGuidanceDispatchIntendedEvent.make({
                requestId: input.requestId,
                target: {
                  plannedAttempt: input.plannedAttempt,
                  session: ExecutorGuidanceSessionLocator.make(`owner:${owner}`),
                  turn: ExecutorGuidanceTurnLocator.make(String(turns.get(owner)))
                },
                version: workflowJournalEventVersion
              }),
              executorGuidanceDispatchIntendedRecordKey(input.requestId)
            )
          }),
        dispatch: ({ nonce }) =>
          Effect.sync(() => {
            const n = Number(nonce),
              input = metadata(n),
              owner = Number(input.plannedAttempt.attemptId.split(":").at(-1))
            if (
              !owned.has(owner) ||
              !capable.has(owner) ||
              executorGuidanceDispatchProblem(records, input.plannedAttempt) !== undefined
            )
              observe(n, ExecutorGuidanceTransmission.cases.Refused.make({ reason: "AttemptInactive" }))
          }),
        acknowledge: ({ exact, nonce, readable }) =>
          Effect.sync(() =>
            observe(
              Number(nonce),
              exact && readable
                ? ExecutorGuidanceTransmission.cases.Accepted.make({})
                : ExecutorGuidanceTransmission.cases.Unknown.make({})
            )
          ),
        finishTurn: ({ attempt }) =>
          Effect.sync(() => {
            report(Number(attempt), true)
            turns.set(Number(attempt), 2)
          }),
        loseCustody: ({ attempt }) =>
          Effect.sync(() => {
            owned.delete(Number(attempt))
          }),
        loseCapability: ({ attempt }) =>
          Effect.sync(() => {
            capable.delete(Number(attempt))
          }),
        closeAdmission: () => Effect.void,
        crash: () => Effect.void,
        recover: () =>
          Effect.sync(() => {
            records = records.map((row) => Schema.decodeUnknownSync(JournalRecord)(JSON.parse(JSON.stringify(row))))
          }),
        reconcile: ({ nonce }) =>
          Effect.sync(() => {
            const n = Number(nonce),
              decision = executorGuidanceRedelivery(records, metadata(n))
            if (decision._tag !== "Observe") throw new Error("reconciliation must retain an unfinished request")
            observe(n, decision.disposition)
          }),
        getState: () =>
          Effect.sync(() => ({
            receipts: [1, 2].map((nonce) => {
              const id = requestId(nonce)
              const admitted = journalRecordByKey(records, executorGuidanceAdmittedRecordKey(id))?.event
              const intended = journalRecordByKey(records, executorGuidanceDispatchIntendedRecordKey(id))?.event
              const observed = journalRecordByKey(records, executorGuidanceObservedRecordKey(id))?.event
              const input = admitted?._tag === "ExecutorGuidanceAdmitted" ? admitted.metadata : undefined
              const disposition = observed?._tag === "ExecutorGuidanceObserved" ? observed.disposition : undefined
              return {
                nonce,
                phase:
                  observed === undefined
                    ? intended === undefined
                      ? input === undefined
                        ? "Empty"
                        : "Admitted"
                      : "Intended"
                    : "Observed",
                attempt: input === undefined ? 1 : Number(input.plannedAttempt.attemptId.split(":").at(-1)),
                digest: input === undefined ? 1 : Number(input.payloadDigest[0]),
                selectedTurn: intended?._tag === "ExecutorGuidanceDispatchIntended" ? Number(intended.target.turn) : 0,
                disposition:
                  disposition === undefined
                    ? "NoDisposition"
                    : disposition._tag === "Accepted"
                      ? "InputAccepted"
                      : disposition._tag === "Refused" && disposition.reason === "PayloadLost"
                        ? "PayloadLost"
                        : disposition._tag
              }
            }),
            contradiction
          }))
      }
    }
  )
const guidanceStateCheck = stateCheck(
  (raw) =>
    Schema.decodeUnknownEffect(projection)(raw).pipe(
      Effect.map(({ state }) => ({
        receipts: [...state.receipts]
          .map(([nonce, receipt]) => ({
            nonce: Number(nonce),
            phase: variantTag(receipt.phase),
            attempt: Number(receipt.attempt),
            digest: Number(receipt.digest),
            selectedTurn: Number(receipt.selectedTurn),
            disposition: variantTag(receipt.disposition)
          }))
          .sort((a, b) => a.nonce - b.nonce),
        contradiction: state.lastIdentityContradiction
      }))
    ),
  (spec, actual) => JSON.stringify(spec) === JSON.stringify(actual)
)

quintIt(
  it.effect,
  "replays guidance chronology and retained identity through production decisions",
  {
    backend: "typescript",
    spec: "specs/executorGuidance.qnt",
    driverFactory: makeGuidanceDriver(),
    nTraces: 20,
    maxSamples: 20,
    maxSteps: 30,
    seed: "433",
    stateCheck: guidanceStateCheck
  },
  30_000
)
it.effect(
  "detects a contradictory guidance request incorrectly treated as a duplicate",
  () =>
    Effect.gen(function* () {
      const options = {
        backend: "typescript" as const,
        spec: "specs/executorGuidance.qnt",
        step: "identityMbtStep",
        nTraces: 1,
        maxSamples: 1,
        maxSteps: 6,
        seed: "433",
        stateCheck: guidanceStateCheck
      }
      yield* quintRun({ ...options, driverFactory: makeGuidanceDriver() })
      const result = yield* quintRun({ ...options, driverFactory: makeGuidanceDriver(true) }).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
    }),
  30_000
)
