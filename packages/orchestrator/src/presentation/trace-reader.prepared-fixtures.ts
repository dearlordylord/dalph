import { RunId } from "@dalph/contracts"
import { Effect } from "effect"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy, RunPolicyRevision, initialRunPolicyRevision } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { TaskWorkCapacityChangedEvent } from "../workflow/registry/event.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { JournalPosition } from "../workflow-journal/identity.js"
import { makeWorkflowRunBeganRecord } from "../workflow-journal/run-lifecycle.js"
import type { JournalRecord } from "../workflow-journal/store.js"
import { makeTraceReader } from "./trace-reader.js"

export const runId = RunId.make("prepared-trace-run")
const firstControlPosition = 2
const deliberatelyGappedTailDistance = 2
export const capacitiesThrough = (capacities: ReadonlyArray<number>): ReadonlyArray<JournalRecord> => [
  makeWorkflowRunBeganRecord(
    runId,
    FixtureTarget.make("prepared-trace-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  ),
  ...capacities.map((capacity, index) => {
    const event = TaskWorkCapacityChangedEvent.make({
      capacity: TaskWorkCapacity.make(capacity),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      previousRevision: RunPolicyRevision.make(initialRunPolicyRevision + index),
      revision: RunPolicyRevision.make(initialRunPolicyRevision + index + 1),
      version: workflowJournalEventVersion
    })
    return {
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(index + firstControlPosition),
      runId
    }
  })
]
export const readerFor = (records: ReadonlyArray<JournalRecord>) =>
  makeTraceReader({ read: () => Effect.succeed(records) })

// The unvisited gapped suffix makes complete-index validation fail before projection.
// Every selected earlier prefix therefore uses the original cold prefix projector.
export const coldReaderFor = (records: ReadonlyArray<JournalRecord>) =>
  readerFor([
    ...records,
    {
      ...makeWorkflowRunBeganRecord(
        runId,
        FixtureTarget.make("cold-oracle-unvisited-tail"),
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      ),
      position: JournalPosition.make(records.length + deliberatelyGappedTailDistance)
    }
  ])
