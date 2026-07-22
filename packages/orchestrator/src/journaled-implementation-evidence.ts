import { Effect, Schema } from "effect"
import type { RunId } from "./domain.js"
import {
  ImplementationEvidenceSealedEvent,
  ImplementationEvidenceSealingIntendedEvent
} from "./implementation-evidence-journal.js"
import {
  authorizeImplementationReview,
  EvidenceStore,
  type EvidenceStoreService,
  ImplementationEvidenceHistoryContradiction,
  ImplementationEvidenceModeContradiction,
  ImplementationEvidenceSource,
  type ImplementationEvidenceSourceService,
  sealImplementationEvidence
} from "./implementation-evidence.js"
import { intentRecordKey, type JournalStoreService, outcomeRecordKey } from "./journal-store.js"
import { samePlannedTaskAttempt } from "./task-attempt-plan-recording.js"
import { WorkflowOperation } from "./workflow-operation.js"

type SealOperation = typeof WorkflowOperation.cases.SealImplementationEvidence.Type

const sameSealOperation = (left: SealOperation, right: SealOperation): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(WorkflowOperation.cases.SealImplementationEvidence)(left))
    === JSON.stringify(Schema.encodeUnknownSync(WorkflowOperation.cases.SealImplementationEvidence)(right))

const failHistory = (
  operation: SealOperation,
  reason: ConstructorParameters<
    typeof ImplementationEvidenceHistoryContradiction
  >[0]["reason"]
) => new ImplementationEvidenceHistoryContradiction({ operationId: operation.operationId, reason })

interface JournaledImplementationEvidenceOptions {
  readonly evidenceSource: ImplementationEvidenceSourceService
  readonly evidenceStore: EvidenceStoreService
  readonly journal: JournalStoreService
  readonly runId: RunId
}

/** Seals only after exact durable successful-execution evidence, then journals the manifest. */
export const makeJournaledImplementationEvidence = (
  options: JournaledImplementationEvidenceOptions
) =>
  Effect.fn("WorkflowInterpreter.Journaled.sealImplementationEvidence")(function*(
    operation: SealOperation
  ) {
    if (operation.execution._tag !== "SuccessfulExecution") {
      return yield* new ImplementationEvidenceModeContradiction({
        operationId: operation.operationId
      })
    }
    const executionOutcome = operation.execution.outcome
    const records = yield* options.journal.read(options.runId)
    if (operation.plannedAttempt.runId !== options.runId) {
      return yield* failHistory(operation, "RunMismatch")
    }
    const executionIntents = records.flatMap(({ event }) =>
      event._tag === "TaskExecutionIntentRecorded"
        && event.operation.request.operationId === executionOutcome.operationId
        ? [event.operation]
        : []
    )
    const [executionIntent, ...additionalExecutionIntents] = executionIntents
    if (executionIntent === undefined) return yield* failHistory(operation, "MissingExecutionIntent")
    if (additionalExecutionIntents.length > 0) {
      return yield* failHistory(operation, "MultipleExecutionIntents")
    }
    if (!samePlannedTaskAttempt(executionIntent.request.plannedAttempt, operation.plannedAttempt)) {
      return yield* failHistory(operation, "AttemptMismatch")
    }
    const predecessorOutcomes = records.flatMap(({ event }) =>
      event._tag === "TaskExecutionOutcomeObserved"
        && event.outcome.outcome._tag === "Succeeded"
        && event.outcome.outcome.operationId === executionOutcome.operationId
        ? [event.outcome.outcome]
        : []
    )
    const predecessor = predecessorOutcomes[0]
    if (
      predecessor === undefined
      || predecessorOutcomes.length !== 1
      || JSON.stringify(predecessor) !== JSON.stringify(executionOutcome)
    ) {
      return yield* new ImplementationEvidenceHistoryContradiction({
        operationId: operation.operationId,
        reason: predecessor === undefined
          ? "MissingPredecessor"
          : predecessorOutcomes.length !== 1
          ? "MultiplePredecessors"
          : "PredecessorMismatch"
      })
    }
    const sealingIntents = records.flatMap(({ event }) =>
      event._tag === "ImplementationEvidenceSealingIntended"
        && event.operation.operationId === operation.operationId
        ? [event.operation]
        : []
    )
    if (sealingIntents.length > 1) return yield* failHistory(operation, "MultipleSealingIntents")
    const sealingIntent = sealingIntents[0]
    if (sealingIntent !== undefined && !sameSealOperation(sealingIntent, operation)) {
      return yield* failHistory(operation, "IntentMismatch")
    }
    const existingOutcomes = records.flatMap(({ event }) =>
      event._tag === "ImplementationEvidenceSealed"
        && event.operationId === operation.operationId
        ? [event.sealed]
        : []
    )
    if (existingOutcomes.length > 1) return yield* failHistory(operation, "MultipleSealedOutcomes")
    const existing = existingOutcomes[0]
    if (existing !== undefined) {
      if (sealingIntent === undefined) return yield* failHistory(operation, "OutcomeWithoutIntent")
      const manifest = existing.manifest
      const manifestBinding = JSON.stringify([
        manifest.plannedBaseSha,
        manifest.predecessorOperationId,
        manifest.runId,
        manifest.taskId
      ])
      const operationBinding = JSON.stringify([
        operation.plannedAttempt.baseSha,
        executionOutcome.operationId,
        operation.plannedAttempt.runId,
        operation.plannedAttempt.taskId
      ])
      if (manifestBinding !== operationBinding) return yield* failHistory(operation, "ExistingEvidenceMismatch")
      const output = yield* options.evidenceStore.read(manifest.implementationOutput).pipe(
        Effect.mapError(() => failHistory(operation, "ExistingEvidenceMismatch"))
      )
      if (new TextDecoder().decode(output) !== executionOutcome.output) {
        return yield* failHistory(operation, "ExistingEvidenceMismatch")
      }
      yield* authorizeImplementationReview(existing).pipe(
        Effect.provideService(EvidenceStore, options.evidenceStore),
        Effect.mapError(() => failHistory(operation, "ExistingEvidenceMismatch"))
      )
      return existing
    }
    if (sealingIntent === undefined) {
      yield* options.journal.append(
        options.runId,
        intentRecordKey(operation.operationId),
        ImplementationEvidenceSealingIntendedEvent.make({ operation, version: 2 })
      )
    }
    const sealed = yield* sealImplementationEvidence(
      operation.operationId,
      operation.plannedAttempt,
      executionOutcome.operationId,
      executionOutcome
    ).pipe(
      Effect.provideService(EvidenceStore, options.evidenceStore),
      Effect.provideService(ImplementationEvidenceSource, options.evidenceSource)
    )
    yield* options.journal.append(
      options.runId,
      outcomeRecordKey(operation.operationId),
      ImplementationEvidenceSealedEvent.make({
        operationId: operation.operationId,
        sealed,
        version: 2
      })
    )
    return sealed
  })
