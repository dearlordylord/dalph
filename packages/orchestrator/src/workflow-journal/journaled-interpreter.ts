import { Effect, Layer, Option } from "effect"
import { type RunId } from "@dalph/contracts"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { InRunJournal } from "./store.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  TaskClaimReleaseIntendedEvent,
  TaskClaimReleasedEvent,
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
import { makeTaskTrackerFactsObservedFromRead } from "../workflow/protocols/task-tracker-read/protocol.js"
import {
  reconstructedTaskGraphFromEvents,
  reconstructedTaskWorkSpecificationFor,
  TaskTrackerKnowledgeUnavailable
} from "../coordination/reconstruction/graph-knowledge.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTargetLineageObserved,
  WorkflowInterpreter
} from "../workflow/interpretation/interpreter.js"
import type { WorkflowOperation } from "../workflow/registry/operation.js"
import { AuthoritativeTaskClaimReleased } from "../workflow/protocols/task-claim-release/protocol.js"
import { taskClaimObservationAttemptBound } from "../workflow/protocols/task-claim-observation/bound.js"

const requireTaskTrackerKnowledge = <A>(
  knowledge: Option.Option<A>,
  operationId: (typeof WorkflowOperation.cases.ReadTrackerGraph.Type)["operationId"],
  kind: "TaskGraph" | "TaskWorkSpecification"
): Effect.Effect<A, TaskTrackerKnowledgeUnavailable> =>
  Option.match(knowledge, {
    onNone: () => Effect.fail(new TaskTrackerKnowledgeUnavailable({ knowledge: kind, operationId })),
    onSome: Effect.succeed
  })

/** Adds durable intent and outcomes to the generic pre-executor operations. */
export const journaledWorkflowInterpreterLayer = <E, R>(
  runId: RunId,
  interpreterLayer: Layer.Layer<WorkflowInterpreter, E, R>
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const journal = yield* InRunJournal

      const readTrackerGraph = Effect.fn("WorkflowInterpreter.Journaled.readTrackerGraph")(function* (
        operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type
      ) {
        const key = intentRecordKey(operation.operationId)
        yield* journal.append(runId, key, taskTrackerReadIntent(operation))
        const records = yield* journal.read(runId)
        const existingObservationIndex = records.findIndex(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operation.operationId
        )
        if (existingObservationIndex >= 0) {
          return yield* requireTaskTrackerKnowledge(
            reconstructedTaskGraphFromEvents(
              records.slice(0, existingObservationIndex + 1).map(({ event }) => event),
              operation.target
            ),
            operation.operationId,
            "TaskGraph"
          )
        }
        const snapshot = yield* interpreter.readTrackerGraph(operation)
        yield* journal.append(
          runId,
          outcomeRecordKey(operation.operationId),
          makeTaskTrackerFactsObservedFromRead(records, operation, snapshot)
        )
        const recorded = yield* journal.read(runId)
        return yield* requireTaskTrackerKnowledge(
          reconstructedTaskGraphFromEvents(
            recorded.map(({ event }) => event),
            operation.target
          ),
          operation.operationId,
          "TaskGraph"
        )
      })

      const acquireTaskClaim = Effect.fn("WorkflowInterpreter.Journaled.acquireTaskClaim")(function* (
        operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type,
        onIntentRecorded: Effect.Effect<void> = Effect.void
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
        const result = yield* interpreter
          .acquireTaskClaim(operation)
          .pipe(
            Effect.catchTag("TrackerMutation.TaskClaimConflict", (failure) =>
              journal
                .append(
                  runId,
                  outcomeRecordKey(operation.acquisition.operationId),
                  TaskClaimAcquisitionRejectedEvent.make({
                    observed: failure.observed,
                    operationId: operation.acquisition.operationId,
                    reason: "ForeignClaim",
                    version: workflowJournalEventVersion
                  })
                )
                .pipe(Effect.andThen(Effect.fail(failure)))
            )
          )
        if (result._tag === "AuthoritativeTaskClaimAcquired") {
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.acquisition.operationId),
            TaskClaimAcquiredEvent.make({ claim: result.claim, version: workflowJournalEventVersion })
          )
        }
        return result
      })

      const readTaskClaim = Effect.fn("WorkflowInterpreter.Journaled.readTaskClaim")(function* (
        operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
      ) {
        yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
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
        const result = yield* interpreter.readTaskClaim(operation)
        const observation =
          result._tag === "AuthoritativeTaskClaimObserved"
            ? makeFocusedTaskClaimFactsObserved(operation, result.observation)
            : result._tag === "TaskClaimObservationUnreadable"
              ? makeFocusedTaskClaimFactsUnreadable(operation)
              : /* v8 ignore next -- @preserve Journaled live interpreters never return dry-run simulation values. */
                undefined
        if (observation !== undefined) {
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.operationId),
            taskTrackerFactsObservedEvent(operation.operationId, observation)
          )
        }
        return result
      })

      const readTaskWorktree = Effect.fn("WorkflowInterpreter.Journaled.readTaskWorktree")(function* (
        operation: typeof WorkflowOperation.cases.ReadTaskWorktree.Type
      ) {
        yield* journal.append(
          runId,
          intentRecordKey(operation.operationId),
          GitReadIntentRecordedEvent.make({
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            operation,
            version: workflowJournalEventVersion
          })
        )
        const existing = (yield* journal.read(runId)).find(
          ({ event }) => event._tag === "PlannedAttemptWorktreeObserved" && event.operationId === operation.operationId
        )?.event
        if (existing?._tag === "PlannedAttemptWorktreeObserved") {
          return AuthoritativePlannedAttemptWorktreeObserved.make({ observation: existing.observation })
        }
        const result = yield* interpreter.readTaskWorktree(operation)
        /* v8 ignore else -- @preserve The typed interpreter result has only the authoritative success variant. */
        if (result._tag === "AuthoritativePlannedAttemptWorktreeObserved") {
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.operationId),
            PlannedAttemptWorktreeObservedEvent.make({
              observation: result.observation,
              occurrenceClassification: "NonActionOccurrence",
              operationId: operation.operationId,
              version: workflowJournalEventVersion
            })
          )
        }
        return result
      })

      const readTargetLineage = Effect.fn("WorkflowInterpreter.Journaled.readTargetLineage")(function* (
        operation: typeof WorkflowOperation.cases.ReadTargetLineage.Type
      ) {
        yield* journal.append(
          runId,
          intentRecordKey(operation.operationId),
          GitReadIntentRecordedEvent.make({
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            operation,
            version: workflowJournalEventVersion
          })
        )
        const existing = (yield* journal.read(runId)).find(
          ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === operation.operationId
        )?.event
        if (existing?._tag === "TargetLineageObserved") {
          return AuthoritativeTargetLineageObserved.make({ observation: existing.observation })
        }
        const result = yield* interpreter.readTargetLineage(operation)
        /* v8 ignore else -- @preserve The typed interpreter result has only the authoritative success variant. */
        if (result._tag === "AuthoritativeTargetLineageObserved") {
          yield* journal.append(
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
        }
        return result
      })

      const readTaskWorkSpecification = Effect.fn("WorkflowInterpreter.Journaled.readTaskWorkSpecification")(function* (
        operation: typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
      ) {
        yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        const existingRecords = yield* journal.read(runId)
        const existingObservationIndex = existingRecords.findIndex(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operation.operationId
        )
        if (existingObservationIndex >= 0) {
          return yield* requireTaskTrackerKnowledge(
            reconstructedTaskWorkSpecificationFor(
              {
                taskTrackerFacts: existingRecords
                  .slice(0, existingObservationIndex + 1)
                  .flatMap(({ event }) => (event._tag === "TaskTrackerFactsObserved" ? [event.observation] : []))
              },
              operation.taskId
            ),
            operation.operationId,
            "TaskWorkSpecification"
          )
        }
        const specification = yield* interpreter.readTaskWorkSpecification(operation)
        yield* journal.append(
          runId,
          outcomeRecordKey(operation.operationId),
          taskTrackerFactsObservedEvent(
            operation.operationId,
            makeFocusedTaskWorkSpecificationFactsObserved(operation, specification)
          )
        )
        const records = yield* journal.read(runId)
        return yield* requireTaskTrackerKnowledge(
          reconstructedTaskWorkSpecificationFor(
            {
              taskTrackerFacts: records.flatMap(({ event }) =>
                event._tag === "TaskTrackerFactsObserved" ? [event.observation] : []
              )
            },
            operation.taskId
          ),
          operation.operationId,
          "TaskWorkSpecification"
        )
      })

      const releaseTaskClaim = Effect.fn("WorkflowInterpreter.Journaled.releaseTaskClaim")(function* (
        operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type
      ) {
        yield* journal.append(
          runId,
          intentRecordKey(operation.release.operationId),
          TaskClaimReleaseIntendedEvent.make({ operation, version: workflowJournalEventVersion })
        )
        const existing = (yield* journal.read(runId)).some(
          ({ event }) =>
            event._tag === "TaskClaimReleased" && event.release.operationId === operation.release.operationId
        )
        if (existing) return AuthoritativeTaskClaimReleased.make({ release: operation.release })
        const result = yield* interpreter.releaseTaskClaim(operation)
        /* v8 ignore next -- @preserve Journaled live interpreters never return dry-run release simulation values. */
        if (result._tag === "AuthoritativeTaskClaimReleased") {
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.release.operationId),
            TaskClaimReleasedEvent.make({ release: operation.release, version: workflowJournalEventVersion })
          )
        }
        return result
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
        operation: typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type
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
        yield* journal.append(
          runId,
          intentRecordKey(operation.operationId),
          TaskWorktreeReconciliationIntendedEvent.make({ operation, version: workflowJournalEventVersion })
        )
        const result = yield* interpreter.reconcileTaskWorktree(operation)
        if (result._tag === "AuthoritativeTaskWorktreeReady") {
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.operationId),
            TaskWorktreeReadyEvent.make({
              operationId: operation.operationId,
              proof: result.proof,
              version: workflowJournalEventVersion
            })
          )
        }
        return result
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
