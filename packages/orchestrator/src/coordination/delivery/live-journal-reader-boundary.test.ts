/* eslint-disable import/no-nodejs-modules -- This regression guards the live-reader source boundary. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { RunId } from "@dalph/contracts"
import { expect, it } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { journalEvidenceFrom } from "../../workflow-journal/record-evidence.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import { OperationId } from "../../workflow/identity.js"
import { acceptedOperationIdsOf, pendingReadOperationIdsOf } from "./delivery-evidence.js"

const liveConsumerSources = [
  "./planned-attempt-delivery-action-adapter.ts",
  "./integration-delivery-action-adapter.ts",
  "./integrator-delivery-action.ts"
]

it("queries accepted live history without calling the array-returning in-Run read", () => {
  for (const source of liveConsumerSources) {
    const contents = readFileSync(fileURLToPath(new URL(source, import.meta.url)), "utf8")
    expect(contents).toContain("AcceptedJournalReader")
    expect(contents).not.toMatch(/\.read\(/)
    expect(contents).not.toContain("materializeJournalRecords")
  }
})

it("derives delivery operation evidence from indexed kinds without materializing the accepted sequence", () => {
  const runId = RunId.make("delivery-indexed-evidence-run")
  const operation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("delivery-indexed-evidence-operation"),
    FixtureTarget.make("delivery-indexed-evidence"),
    []
  )
  const projection = projectTrackerSnapshot({ revision: "delivery-indexed-evidence-revision", tasks: [] })
  if (projection._tag === "Invalid") throw new Error("expected a valid empty tracker graph")
  const records: ReadonlyArray<JournalRecord> = [
    {
      event: taskTrackerReadIntent(operation),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, projection.snapshot)
      ),
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    }
  ]
  const evidence = journalEvidenceFrom(records)
  let materializations = 0
  const stop = observeJournalRecordSequenceOperations((observed) => {
    if (observed._tag === "HistoricalMaterialization") materializations += 1
  })
  try {
    expect(acceptedOperationIdsOf(evidence)).toEqual(new Set([operation.operationId]))
    expect(pendingReadOperationIdsOf(evidence)).toEqual(new Set())
    expect(materializations).toBe(0)
  } finally {
    stop()
  }
})
