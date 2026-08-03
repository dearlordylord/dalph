import { RunId } from "@dalph/contracts"
import { Effect } from "effect"
import { FixtureTarget } from "../src/authorities/task-tracker/fixture/target.js"
import type { TaskDagSnapshot } from "../src/authorities/task-tracker/graph.js"
import { TaskWorkCapacity } from "../src/coordination/admission/capacity.js"
import { makeAcceptedFactPublicationGateway } from "../src/coordination/delivery/accepted-fact-gateway.js"
import type { AcceptedTrackerGraphObservation } from "../src/coordination/delivery/accepted-fact-gateway.js"
import { InitialControlPolicy, RunPolicyRevision, initialRunPolicyRevision } from "../src/control/policy.js"
import { reduceWorkflowJournalHistory } from "../src/coordination/reconstruction/history.js"
import { makeTrackerGraphObservationOperation } from "../src/workflow/registry/operation.js"
import { TaskWorkCapacityChangedEvent, taskTrackerReadIntent } from "../src/workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../src/workflow/task-tracker-facts/observation.js"
import { workflowJournalEventVersion } from "../src/workflow/kernel/event.js"
import { memoryJournalStoreLayer } from "../src/workflow-journal/adapters/memory-store.js"
import type { JournalPosition } from "../src/workflow-journal/identity.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  taskWorkCapacityPolicyRecordKey
} from "../src/workflow-journal/record-key.js"
import { JournalStore } from "../src/workflow-journal/store.js"
import type { OperationId } from "../src/workflow/identity.js"

const minimumAcceptedGraphPosition = 3
const policyRevisionIncrement = 1

/** Builds a valid graph observation through the accepted journal gateway. */
export const makeTestAcceptedTrackerGraphObservation = (input: {
  readonly snapshot: TaskDagSnapshot
  readonly operationId: OperationId
  readonly acceptedAt: JournalPosition
}): AcceptedTrackerGraphObservation => {
  const target = FixtureTarget.make("test-graph-target")
  const runId = RunId.make(`accepted-graph-fixture:${input.operationId}`)
  const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  const requestedPosition = Math.max(input.acceptedAt, minimumAcceptedGraphPosition)
  return Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const storage = yield* JournalStore
        yield* storage.beginRun(runId, target, policy)
        const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
        if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
        const gateway = yield* makeAcceptedFactPublicationGateway(runId, target, initial, storage)
        let revision = initialRunPolicyRevision
        for (const _unused of Array.from({ length: requestedPosition - minimumAcceptedGraphPosition })) {
          const nextRevision = RunPolicyRevision.make(revision + policyRevisionIncrement)
          yield* gateway.journal.append(
            runId,
            taskWorkCapacityPolicyRecordKey(nextRevision),
            TaskWorkCapacityChangedEvent.make({
              capacity: policy.taskExecutionCapacity,
              initiatedBy: { _tag: "Operator" },
              occurrenceClassification: "InitiatedAction",
              previousRevision: revision,
              revision: nextRevision,
              version: workflowJournalEventVersion
            })
          )
          revision = nextRevision
        }
        const operation = makeTrackerGraphObservationOperation(input.operationId, target)
        yield* gateway.journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        yield* gateway.journal.append(
          runId,
          outcomeRecordKey(operation.operationId),
          taskTrackerFactsObservedEvent(
            operation.operationId,
            makeCompleteTaskTrackerFactsObserved(operation, input.snapshot)
          )
        )
        const current = yield* gateway.acceptedFacts.get
        if (current.graph._tag !== "GraphEstablished") return yield* Effect.die("fixture graph was not established")
        return current.graph.observation
      }).pipe(Effect.provide(memoryJournalStoreLayer))
    )
  )
}
