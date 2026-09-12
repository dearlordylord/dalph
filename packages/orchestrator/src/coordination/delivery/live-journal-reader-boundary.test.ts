/* eslint-disable import/no-nodejs-modules -- This regression guards the live-reader source boundary. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { RunId } from "@dalph/contracts"
import { expect, it } from "vitest"
import { HashSet } from "effect"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { journalEvidenceBefore, journalEvidenceFrom } from "../../workflow-journal/record-evidence.js"
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
    expect(contents).toContain(".readAccepted(")
    if (source === "./integrator-delivery-action.ts") {
      expect(contents).toContain("const journal = yield* Journal")
      expect(contents).toContain("journal.appendIfAcceptedPrefixCurrent(")
      expect(contents).toContain("ExpectedAcceptedPrefixPosition.make(records.lastPosition)")
    } else {
      expect(contents).toContain("AcceptedJournalReader")
    }
    expect(contents).not.toMatch(/\.read\(/)
    expect(contents).not.toContain("materializeJournalRecords")
  }
})

it("keeps a completed read settled when a malformed suffix repeats its intent", () => {
  const runId = RunId.make("delivery-repeated-intent-run")
  const operation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("delivery-repeated-intent-operation"),
    FixtureTarget.make("delivery-repeated-intent"),
    []
  )
  const projection = projectTrackerSnapshot({ revision: "delivery-repeated-intent-revision", tasks: [] })
  if (projection._tag === "Invalid") {
    expect.fail("expected a valid empty tracker graph")
    return
  }
  const intent: JournalRecord = {
    event: taskTrackerReadIntent(operation),
    key: intentRecordKey(operation.operationId),
    position: JournalPosition.make(1),
    runId
  }
  const outcome: JournalRecord = {
    event: taskTrackerFactsObservedEvent(
      operation.operationId,
      makeCompleteTaskTrackerFactsObserved(operation, projection.snapshot)
    ),
    key: outcomeRecordKey(operation.operationId),
    position: JournalPosition.make(2),
    runId
  }
  const repeatedIntent: JournalRecord = { ...intent, position: JournalPosition.make(3) }
  const records = [intent, outcome, repeatedIntent]
  const evidence = journalEvidenceFrom(records)

  expect(
    HashSet.has(pendingReadOperationIdsOf(journalEvidenceBefore(evidence, outcome.position)), operation.operationId)
  ).toBe(true)
  expect(HashSet.size(pendingReadOperationIdsOf(records))).toBe(0)
  expect(HashSet.size(pendingReadOperationIdsOf(evidence))).toBe(0)
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
  if (projection._tag === "Invalid") return expect.fail("expected a valid empty tracker graph")
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
    expect(HashSet.has(acceptedOperationIdsOf(evidence), operation.operationId)).toBe(true)
    expect(HashSet.size(acceptedOperationIdsOf(evidence))).toBe(1)
    expect(HashSet.size(pendingReadOperationIdsOf(evidence))).toBe(0)
    expect(materializations).toBe(0)
  } finally {
    stop()
  }
})
