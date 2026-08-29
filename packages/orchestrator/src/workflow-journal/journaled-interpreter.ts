import { Effect, Layer, Option } from "effect"
import { type RunId } from "@dalph/contracts"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { InRunJournal } from "./store.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../workflow/registry/event.js"
import { attemptPlanRecordKey, intentRecordKey, outcomeRecordKey } from "./record-key.js"
import { requireAcknowledgedPlan } from "../workflow/protocols/task-attempt-planning/journal-evidence.js"
import {
  TaskAttemptPlanRecordAcknowledged,
  TaskAttemptPlanRunContradiction
} from "../workflow/protocols/task-attempt-planning/record.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import {
  reconstructedTaskWorkSpecificationFor,
  TaskTrackerKnowledgeUnavailable
} from "../coordination/reconstruction/graph-knowledge.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTargetLineageObserved,
  InterruptibleWorkflowBoundaryIntent,
  runInterruptibleBoundary,
  WorkflowInterpreter,
  type InterruptibleWorkflowBoundaryExecution
} from "../workflow/interpretation/interpreter.js"
import type { WorkflowOperation } from "../workflow/registry/operation.js"
import { RunActivationOpportunity } from "../coordination/run/run-activation-opportunity.js"
import { runJournaledTaskClaimRelease } from "../workflow/protocols/task-claim-release/journaled.js"
import { taskClaimObservationAttemptBound } from "../workflow/protocols/task-claim-observation/bound.js"
import { journaledTrackerGraphRead } from "../workflow/protocols/task-tracker-read/protocol.js"
import {
  runActiveTargetLineageAuthorityRefreshGitRead,
  runActiveWorktreeAuthorityRefreshGitRead
} from "../workflow/protocols/active-work-authority-refresh/journaled.js"

const requireTaskWorkSpecification = <A>(
  knowledge: Option.Option<A>,
  operationId: (typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type)["operationId"]
): Effect.Effect<A, TaskTrackerKnowledgeUnavailable> =>
  Option.match(knowledge, {
    onNone: () => Effect.fail(new TaskTrackerKnowledgeUnavailable({ knowledge: "TaskWorkSpecification", operationId })),
    onSome: Effect.succeed
  })

/** Adds durable intent and outcomes to the generic pre-executor operations. */
export const journaledWorkflowInterpreterLayer = <E, R>(
  runId: RunId,
  interpreterLayer: Layer.Layer<WorkflowInterpreter, E, R>,
  opportunity: RunActivationOpportunity = RunActivationOpportunity.OrdinaryRunEntry()
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const journal = yield* InRunJournal

      const readTrackerGraph = journaledTrackerGraphRead(runId, interpreter, journal)

      const acquireTaskClaim = Effect.fn("WorkflowInterpreter.Journaled.acquireTaskClaim")(function* (
        operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type,
        onIntentRecorded: Effect.Effect<void> = Effect.void,
        interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
      ) {
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            yield* journal.append(
              runId,
              intentRecordKey(operation.acquisition.operationId),
              TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion })
            )
            yield* onIntentRecorded
          })
        )
        return yield* runInterruptibleBoundary(
          interruptibleBoundary,
          InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
            family: "TaskTracker",
            operationId: operation.acquisition.operationId
          }),
          interpreter.acquireTaskClaim(operation).pipe(
            Effect.map((result) => ({ _tag: "Acquired" as const, result })),
            Effect.catchTag("TrackerMutation.TaskClaimConflict", (failure) =>
              Effect.succeed({ _tag: "Rejected" as const, failure })
            )
          ),
          (outcome) =>
            outcome._tag === "Acquired"
              ? journal
                  .append(
                    runId,
                    outcomeRecordKey(operation.acquisition.operationId),
                    TaskClaimAcquiredEvent.make({ claim: outcome.result.claim, version: workflowJournalEventVersion })
                  )
                  .pipe(Effect.as(outcome.result))
              : journal
                  .append(
                    runId,
                    outcomeRecordKey(operation.acquisition.operationId),
                    TaskClaimAcquisitionRejectedEvent.make({
                      observed: outcome.failure.observed,
                      operationId: operation.acquisition.operationId,
                      reason: "ForeignClaim",
                      version: workflowJournalEventVersion
                    })
                  )
                  .pipe(Effect.andThen(Effect.fail(outcome.failure)))
        )
      })

      const readTaskClaim = Effect.fn("WorkflowInterpreter.Journaled.readTaskClaim")(function* (
        operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type,
        onIntentRecorded: Effect.Effect<void> = Effect.void,
        interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
      ) {
        yield* Effect.uninterruptible(
          journal
            .append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
            .pipe(Effect.andThen(onIntentRecorded))
        )
        const existing = (yield* journal.read(runId)).find(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operation.operationId
        )?.event
        if (existing?._tag === "TaskTrackerFactsObserved") {
          return existing.observation._tag === "FocusedTaskClaimFacts"
            ? { _tag: "AuthoritativeTaskClaimObserved" as const, observation: existing.observation.observation }
            : /* v8 ignore next -- @preserve Exhausted replay is covered by the composed unreadable cassette. */
              {
                _tag: "TaskClaimObservationUnreadable" as const,
                attempts: taskClaimObservationAttemptBound,
                taskId: operation.taskId
              }
        }
        return yield* runInterruptibleBoundary(
          interruptibleBoundary,
          InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
            family: "TaskTracker",
            operationId: operation.operationId
          }),
          interpreter.readTaskClaim(operation),
          (result) => {
            const observation =
              result._tag === "AuthoritativeTaskClaimObserved"
                ? makeFocusedTaskClaimFactsObserved(operation, result.observation)
                : makeFocusedTaskClaimFactsUnreadable(operation)
            return journal
              .append(
                runId,
                outcomeRecordKey(operation.operationId),
                taskTrackerFactsObservedEvent(operation.operationId, observation)
              )
              .pipe(Effect.as(result))
          }
        )
      })

      const readTaskWorktree = Effect.fn("WorkflowInterpreter.Journaled.readTaskWorktree")(function* (
        operation: typeof WorkflowOperation.cases.ReadTaskWorktree.Type,
        onIntentRecorded: Effect.Effect<void> = Effect.void,
        interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
      ) {
        if (opportunity._tag === "ActiveWorkAuthorityRefresh") {
          return yield* runActiveWorktreeAuthorityRefreshGitRead({
            boundary: interruptibleBoundary,
            interpreter,
            journal,
            onIntentRecorded,
            operation,
            runId,
            source: opportunity.source
          })
        }
        yield* Effect.uninterruptible(
          journal
            .append(
              runId,
              intentRecordKey(operation.operationId),
              GitReadIntentRecordedEvent.make({
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                operation,
                version: workflowJournalEventVersion
              })
            )
            .pipe(Effect.andThen(onIntentRecorded))
        )
        const existing = (yield* journal.read(runId)).find(
          ({ event }) => event._tag === "PlannedAttemptWorktreeObserved" && event.operationId === operation.operationId
        )?.event
        if (existing?._tag === "PlannedAttemptWorktreeObserved") {
          return AuthoritativePlannedAttemptWorktreeObserved.make({ observation: existing.observation })
        }
        return yield* runInterruptibleBoundary(
          interruptibleBoundary,
          InterruptibleWorkflowBoundaryIntent.AuthorityRequest({ family: "Git", operationId: operation.operationId }),
          interpreter.readTaskWorktree(operation),
          (result) =>
            journal
              .append(
                runId,
                outcomeRecordKey(operation.operationId),
                PlannedAttemptWorktreeObservedEvent.make({
                  observation: result.observation,
                  occurrenceClassification: "NonActionOccurrence",
                  operationId: operation.operationId,
                  version: workflowJournalEventVersion
                })
              )
              .pipe(Effect.as(result))
        )
      })

      const readTargetLineage = Effect.fn("WorkflowInterpreter.Journaled.readTargetLineage")(function* (
        operation: typeof WorkflowOperation.cases.ReadTargetLineage.Type,
        onIntentRecorded: Effect.Effect<void> = Effect.void,
        interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
      ) {
        if (opportunity._tag === "ActiveWorkAuthorityRefresh") {
          return yield* runActiveTargetLineageAuthorityRefreshGitRead({
            boundary: interruptibleBoundary,
            interpreter,
            journal,
            onIntentRecorded,
            operation,
            runId,
            source: opportunity.source
          })
        }
        yield* Effect.uninterruptible(
          journal
            .append(
              runId,
              intentRecordKey(operation.operationId),
              GitReadIntentRecordedEvent.make({
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                operation,
                version: workflowJournalEventVersion
              })
            )
            .pipe(Effect.andThen(onIntentRecorded))
        )
        const existing = (yield* journal.read(runId)).find(
          ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === operation.operationId
        )?.event
        if (existing?._tag === "TargetLineageObserved") {
          return AuthoritativeTargetLineageObserved.make({ observation: existing.observation })
        }
        return yield* runInterruptibleBoundary(
          interruptibleBoundary,
          InterruptibleWorkflowBoundaryIntent.AuthorityRequest({ family: "Git", operationId: operation.operationId }),
          interpreter.readTargetLineage(operation),
          (result) =>
            journal
              .append(
                runId,
                outcomeRecordKey(operation.operationId),
                TargetLineageObservedEvent.make({
                  observation: result.observation,
                  occurrenceClassification: "NonActionOccurrence",
                  operationId: operation.operationId,
                  plannedAttempt: operation.plannedAttempt,
                  version: workflowJournalEventVersion
                })
              )
              .pipe(Effect.as(result))
        )
      })

      const readTaskWorkSpecification = Effect.fn("WorkflowInterpreter.Journaled.readTaskWorkSpecification")(function* (
        operation: typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type,
        onIntentRecorded: Effect.Effect<void> = Effect.void,
        interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
      ) {
        yield* Effect.uninterruptible(
          journal
            .append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
            .pipe(Effect.andThen(onIntentRecorded))
        )
        const existingRecords = yield* journal.read(runId)
        const existingObservationIndex = existingRecords.findIndex(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operation.operationId
        )
        if (existingObservationIndex >= 0) {
          return yield* requireTaskWorkSpecification(
            reconstructedTaskWorkSpecificationFor(
              {
                taskTrackerFacts: existingRecords
                  .slice(0, existingObservationIndex + 1)
                  .flatMap(({ event }) => (event._tag === "TaskTrackerFactsObserved" ? [event.observation] : []))
              },
              operation.taskId
            ),
            operation.operationId
          )
        }
        return yield* runInterruptibleBoundary(
          interruptibleBoundary,
          InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
            family: "TaskTracker",
            operationId: operation.operationId
          }),
          interpreter.readTaskWorkSpecification(operation),
          (specification) =>
            Effect.gen(function* () {
              yield* journal.append(
                runId,
                outcomeRecordKey(operation.operationId),
                taskTrackerFactsObservedEvent(
                  operation.operationId,
                  makeFocusedTaskWorkSpecificationFactsObserved(operation, specification)
                )
              )
              const records = yield* journal.read(runId)
              return yield* requireTaskWorkSpecification(
                reconstructedTaskWorkSpecificationFor(
                  {
                    taskTrackerFacts: records.flatMap(({ event }) =>
                      event._tag === "TaskTrackerFactsObserved" ? [event.observation] : []
                    )
                  },
                  operation.taskId
                ),
                operation.operationId
              )
            })
        )
      })

      const releaseTaskClaim = Effect.fn("WorkflowInterpreter.Journaled.releaseTaskClaim")(function* (
        operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type,
        onIntentRecorded: Effect.Effect<void> = Effect.void,
        interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
      ) {
        return yield* runJournaledTaskClaimRelease(runId, operation, interpreter.releaseTaskClaim(operation), {
          boundaryIntent: InterruptibleWorkflowBoundaryIntent.TaskClaimCleanup({ family: "TaskTracker", operation }),
          execution: interruptibleBoundary,
          onIntentRecorded
        }).pipe(Effect.provideService(InRunJournal, journal))
      })

      const recordTaskAttemptPlan = Effect.fn("WorkflowInterpreter.Journaled.recordTaskAttemptPlan")(function* (
        operation: typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type
      ) {
        if (operation.plannedAttempt.runId !== runId) {
          return yield* new TaskAttemptPlanRunContradiction({
            journalRunId: runId,
            operationId: operation.operationId,
            plannedAttemptRunId: operation.plannedAttempt.runId
          })
        }
        yield* journal.append(
          runId,
          attemptPlanRecordKey(operation.plannedAttempt.attemptId),
          TaskAttemptPlannedEvent.make({ operation, version: workflowJournalEventVersion })
        )
        return TaskAttemptPlanRecordAcknowledged.make({ plannedAttempt: operation.plannedAttempt })
      })

      const reconcileTaskWorktree = Effect.fn("WorkflowInterpreter.Journaled.reconcileTaskWorktree")(function* (
        operation: typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type,
        onIntentRecorded: Effect.Effect<void> = Effect.void,
        interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
      ) {
        if (operation.plannedAttempt.runId !== runId) {
          return yield* new TaskAttemptPlanRunContradiction({
            journalRunId: runId,
            operationId: operation.operationId,
            plannedAttemptRunId: operation.plannedAttempt.runId
          })
        }
        const records = yield* journal.read(runId)
        yield* requireAcknowledgedPlan(
          records,
          operation.plannedAttempt,
          operation.operationId,
          operation.predecessorOperationIds
        )
        yield* Effect.uninterruptible(
          journal
            .append(
              runId,
              intentRecordKey(operation.operationId),
              TaskWorktreeReconciliationIntendedEvent.make({ operation, version: workflowJournalEventVersion })
            )
            .pipe(Effect.andThen(onIntentRecorded))
        )
        return yield* runInterruptibleBoundary(
          interruptibleBoundary,
          InterruptibleWorkflowBoundaryIntent.AuthorityRequest({ family: "Git", operationId: operation.operationId }),
          interpreter.reconcileTaskWorktree(operation),
          (result) =>
            journal
              .append(
                runId,
                outcomeRecordKey(operation.operationId),
                TaskWorktreeReadyEvent.make({
                  operationId: operation.operationId,
                  proof: result.proof,
                  version: workflowJournalEventVersion
                })
              )
              .pipe(Effect.as(result))
        )
      })

      return WorkflowInterpreter.of({
        acquireTaskClaim,
        readTaskClaim,
        readTaskWorktree,
        readTargetLineage,
        readTrackerGraph,
        readTaskWorkSpecification,
        releaseTaskClaim,
        reconcileTaskWorktree,
        recordTaskAttemptPlan
      })
    })
  ).pipe(Layer.provide(interpreterLayer))
