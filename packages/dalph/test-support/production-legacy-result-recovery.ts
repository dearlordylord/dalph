/* eslint-disable import/no-nodejs-modules -- Qualification seeds an independent pre-upgrade private namespace. */
import { createHash } from "node:crypto"
import { Effect, Option, Schema } from "effect"
import {
  plannedAttemptExecutorCorrelationKey,
  PlannedAttemptExecutorReport,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import {
  JournalStore,
  sqliteJournalStoreLayer,
  type JournalRecord,
  reduceWorkflowJournalHistory
} from "@dalph/orchestrator"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"
import {
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey
} from "../../orchestrator/src/workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../orchestrator/src/workflow/kernel/event.js"
import {
  CodexAttemptRecord,
  CodexAttemptStore,
  nodeCodexAttemptStoreLayer
} from "../src/application/codex-attempt-store.js"
import { ProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"

const directoryFor = (root: string, attempt: PlannedTaskAttempt) =>
  `${root}/attempts/${createHash("sha256").update(plannedAttemptExecutorCorrelationKey(attempt)).digest("hex")}`

/** Seed independent pre-upgrade starting facts; never mutate the modern source
 * journal/private store or issue an AcceptedJournalPrefix certificate.
 */
export const seedProductionHistoricalFailure = Effect.fn("LegacyResultRecoveryFixture.seed")(function* (
  configuration: ProductionRepositoryHostConfiguration,
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
) {
  const rejectionIndex = records.findIndex(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorStateObserved" &&
      event.observation._tag === "ExactExecutorReport" &&
      event.observation.report._tag === "ExecutorWorkResultRejected"
  )
  if (rejectionIndex < 0) return yield* Effect.die("fixture requires a retained rejection observation")
  const prefix = records.slice(0, rejectionIndex)
  const beginning = prefix[0]?.event
  if (beginning?._tag !== "WorkflowRunBegan") return yield* Effect.die("fixture requires the exact Run beginning")
  const legacyConfiguration = ProductionRepositoryHostConfiguration.make({
    ...configuration,
    journalDatabase: ProductionRepositoryHostConfiguration.fields.journalDatabase.make(
      `${configuration.journalDatabase}.legacy`
    ),
    codexExecutorPrivateStateDirectory:
      ProductionRepositoryHostConfiguration.fields.codexExecutorPrivateStateDirectory.make(
        `${configuration.codexExecutorPrivateStateDirectory}/legacy`
      )
  })
  const originalDirectory = directoryFor(configuration.codexExecutorPrivateStateDirectory, plannedAttempt)
  const legacyDirectory = directoryFor(legacyConfiguration.codexExecutorPrivateStateDirectory, plannedAttempt)
  const modern = yield* Effect.scoped(
    Effect.gen(function* () {
      const store = yield* CodexAttemptStore
      return yield* store.readAttempt(plannedAttempt.runId, plannedAttempt.attemptId)
    }).pipe(Effect.provide(nodeCodexAttemptStoreLayer({ stateDirectory: originalDirectory })))
  )
  if (Option.isNone(modern) || modern.value._tag !== "ResultRejected")
    return yield* Effect.die("fixture requires its modern source in an independent namespace")
  const retained = modern.value
  const legacySeal = yield* Schema.decodeUnknownEffect(CodexAttemptRecord)({
    _tag: "Terminal",
    attemptId: retained.attemptId,
    correlationAttemptId: retained.correlationAttemptId,
    correlationRunId: retained.correlationRunId,
    currentToken: retained.currentToken,
    observedTurnId: retained.observedTurnId,
    priorObservedTurnId: retained.priorObservedTurnId,
    threadId: retained.threadId,
    worktree: retained.worktree,
    ...("turnStartedAtMilliseconds" in retained
      ? { turnStartedAtMilliseconds: retained.turnStartedAtMilliseconds }
      : {}),
    ...("turnStartIncarnation" in retained ? { turnStartIncarnation: retained.turnStartIncarnation } : {}),
    ...("toolEffectPolicy" in retained ? { toolEffectPolicy: retained.toolEffectPolicy } : {}),
    terminal: { _tag: "Failed" },
    evidenceManifest: null
  })
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* (yield* CodexAttemptStore).writeAttempt(legacySeal)
    }).pipe(Effect.provide(nodeCodexAttemptStoreLayer({ stateDirectory: legacyDirectory })))
  )
  const ordinal = PlannedAttemptExecutorReportOrdinal.make(
    1 +
      Math.max(
        0,
        ...prefix.flatMap(({ event }) => (event._tag === "PlannedAttemptExecutorWorkReported" ? [event.ordinal] : []))
      )
  )
  const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(
    1 +
      Math.max(
        0,
        ...prefix.flatMap(({ event }) => (event._tag === "PlannedAttemptExecutorStateObserved" ? [event.ordinal] : []))
      )
  )
  const report = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId },
    result: { _tag: "Failed" }
  })
  yield* Effect.scoped(
    Effect.gen(function* () {
      const store = yield* JournalStore
      yield* store.beginRun(
        plannedAttempt.runId,
        beginning.target,
        beginning.initialControlPolicy,
        beginning.remotePublicationTarget
      )
      for (const record of prefix.slice(1)) {
        if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated")
          return yield* Effect.die("retained prefix must contain only its initial Run beginning")
        yield* store.append(record.runId, record.key, record.event)
      }
      yield* store.append(
        plannedAttempt.runId,
        plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
        PlannedAttemptExecutorStateObservedEvent.make({
          plannedAttempt,
          ordinal: observationOrdinal,
          observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }),
          occurrenceClassification: "NonActionOccurrence",
          version: workflowJournalEventVersion
        })
      )
      yield* store.append(
        plannedAttempt.runId,
        plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
        PlannedAttemptExecutorWorkReportedEvent.make({ report, ordinal, version: workflowJournalEventVersion })
      )
      const seeded = yield* store.read(plannedAttempt.runId)
      const reduction = reduceWorkflowJournalHistory(plannedAttempt.runId, seeded)
      if (reduction._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die(JSON.stringify(reduction))
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename: legacyConfiguration.journalDatabase })))
  )
  return {
    configuration: legacyConfiguration,
    legacyDirectory,
    originalDirectory,
    legacySeal,
    modernRecord: modern.value,
    reportOrdinal: ordinal,
    readHistory: Effect.scoped(
      Effect.gen(function* () {
        return yield* (yield* JournalStore).read(plannedAttempt.runId)
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename: legacyConfiguration.journalDatabase })))
    ),
    readSeal: (stateDirectory: string) =>
      Effect.scoped(
        Effect.gen(function* () {
          return yield* (yield* CodexAttemptStore).readAttempt(plannedAttempt.runId, plannedAttempt.attemptId)
        }).pipe(Effect.provide(nodeCodexAttemptStoreLayer({ stateDirectory })))
      )
  }
})
