import { expect, it } from "vitest"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { OperationId } from "../../identity.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import { integrationFinalityFixture as fixture } from "../integration-finality/fixtures.js"
import { exactTargetLineageRecord } from "./canonical-lineage.js"

const operationId = OperationId.make("canonical-lineage-coverage")
const operation = makeTargetLineageObservationOperation({
  integrationTarget: fixture.integrationTarget,
  operationId,
  plannedAttempt: fixture.plannedAttempt,
  predecessorOperationIds: []
})
const intent = GitReadIntentRecordedEvent.make({
  initiatedBy: { _tag: "DalphCoordinator" },
  occurrenceClassification: "InitiatedAction",
  operation,
  version: workflowJournalEventVersion
})
const observation = TargetLineageObservedEvent.make({
  observation: TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: fixture.plannedAttempt.baseSha,
    targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead
  }),
  occurrenceClassification: "NonActionOccurrence",
  operationId,
  plannedAttempt: fixture.plannedAttempt,
  version: workflowJournalEventVersion
})

const record = (position: number, event: JournalRecord["event"], key: JournalRecord["key"]): JournalRecord => ({
  event,
  key,
  position: JournalPosition.make(position),
  runId: fixture.runId
})

const exactRequest = {
  expectedTargetHead: fixture.qualifiedCandidate.run.session.expectedTargetHead,
  integrationTarget: fixture.integrationTarget,
  plannedAttempt: fixture.plannedAttempt,
  targetLineageObservedAt: JournalPosition.make(2)
}

const validRecords = [
  record(1, intent, intentRecordKey(operationId)),
  record(2, observation, outcomeRecordKey(operationId))
]

it("accepts one exact target-lineage intent and observation and rejects duplicate or foreign rows", () => {
  const firstRecord = validRecords[0]
  const secondRecord = validRecords[1]
  if (firstRecord === undefined || secondRecord === undefined) expect.fail("canonical lineage fixture is incomplete")
  expect(exactTargetLineageRecord(validRecords, exactRequest)).toEqual({
    intent: firstRecord,
    observation: secondRecord
  })
  expect(exactTargetLineageRecord([firstRecord], exactRequest)).toBeUndefined()
  expect(
    exactTargetLineageRecord([...validRecords, record(3, observation, outcomeRecordKey(operationId))], exactRequest)
  ).toBeUndefined()
  expect(
    exactTargetLineageRecord(
      [record(4, intent, JournalRecordKey.make("canonical-lineage-foreign-key")), ...validRecords],
      exactRequest
    )
  ).toBeUndefined()
  expect(exactTargetLineageRecord([secondRecord], exactRequest)).toBeUndefined()
})
