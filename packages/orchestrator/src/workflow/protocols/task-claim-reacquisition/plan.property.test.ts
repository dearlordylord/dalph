import { RunId, TaskId } from "@dalph/contracts"
import { expect, it } from "vitest"
import fc from "fast-check"
import { ActiveTaskClaim, UnclaimedTask } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { outcomeRecordKey, taskClaimReacquisitionDirectedRecordKey } from "../../../workflow-journal/record-key.js"
import {
  appendJournalEvidence,
  emptyJournalEvidence,
  inspectJournalEvidenceStorage,
  journalEvidenceBefore,
  journalEvidenceFrom
} from "../../../workflow-journal/record-evidence.js"
import { observeJournalRecordSequenceOperations } from "../../../workflow-journal/record-sequence.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { makeTaskClaimObservationOperation } from "../../registry/operation.js"
import { TaskClaimAcquiredEvent } from "../../registry/event.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import { TaskClaimReacquisitionDirectedEvent, TaskClaimReacquisitionRequestId } from "./events.js"
import { latestTaskClaimReacquisitionDirection } from "./plan.js"

const runId = RunId.make("claim-loss-episode-run")
const taskId = TaskId.make("claim-loss-episode-task")
const target = FixtureTarget.make("claim-loss-episode-target")
const claim = (suffix: string) =>
  ActiveTaskClaim.make({
    operationId: OperationId.make(`claim-${suffix}`),
    owner: ClaimOwner.make(`owner-${suffix}`),
    taskId,
    token: ClaimToken.make(`token-${suffix}`)
  })
const expected = claim("expected")
type Step = "Missing" | "Expected" | "ForeignA" | "ForeignB" | "Unreadable" | "Direction" | "Acquired"
const recordFor = (step: Step, offset: number): JournalRecord => {
  const position = JournalPosition.make(offset + 1)
  if (step === "Direction") {
    const requestId = TaskClaimReacquisitionRequestId.make(`direction-${position}`)
    return {
      event: TaskClaimReacquisitionDirectedEvent.make({
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject: { runId, taskId },
        version: workflowJournalEventVersion
      }),
      key: taskClaimReacquisitionDirectedRecordKey(requestId),
      position,
      runId
    }
  }
  if (step === "Acquired")
    return {
      event: TaskClaimAcquiredEvent.make({ claim: expected, version: workflowJournalEventVersion }),
      key: outcomeRecordKey(expected.operationId),
      position,
      runId
    }
  const operation = makeTaskClaimObservationOperation(OperationId.make(`read-${position}`), target, taskId)
  const observation =
    step === "Unreadable"
      ? makeFocusedTaskClaimFactsUnreadable(operation)
      : makeFocusedTaskClaimFactsObserved(
          operation,
          step === "Missing" ? UnclaimedTask.make({ taskId }) : step === "Expected" ? expected : claim(step)
        )
  return {
    event: taskTrackerFactsObservedEvent(operation.operationId, observation),
    key: outcomeRecordKey(operation.operationId),
    position,
    runId
  }
}

it.each([
  ["Missing", "Direction", "Missing"],
  ["Missing", "Direction", "Unreadable", "Missing"],
  ["ForeignA", "Direction", "ForeignB", "ForeignA"],
  ["Missing", "Direction", "Expected", "Missing"],
  ["Missing", "Direction", "Acquired"],
  ["Missing", "Acquired", "Missing", "Direction"],
  ["Missing", "Direction", "Unreadable", "Missing", "Direction"]
] satisfies ReadonlyArray<ReadonlyArray<Step>>)("preserves claim-loss episode authority for %j", (...steps) => {
  const records = steps.map(recordFor)
  const evidence = journalEvidenceFrom(records)
  for (let through = 1; through <= records.length; through += 1) {
    const position = JournalPosition.make(through)
    expect(
      latestTaskClaimReacquisitionDirection(
        journalEvidenceBefore(evidence, through + 1),
        runId,
        taskId,
        expected,
        position
      )
    ).toEqual(latestTaskClaimReacquisitionDirection(records.slice(0, through), runId, taskId, expected, position))
  }
})

it("preserves missing, foreign, exact and unreadable observation sequences under indexed lookup", () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom<Step>("Missing", "Expected", "ForeignA", "ForeignB", "Unreadable", "Direction"), {
        minLength: 1,
        maxLength: 60
      }),
      (steps) => {
        const records = ["Acquired" as const, ...steps].map(recordFor)
        const position = JournalPosition.make(records.length)
        expect(
          latestTaskClaimReacquisitionDirection(journalEvidenceFrom(records), runId, taskId, expected, position)
        ).toEqual(latestTaskClaimReacquisitionDirection(records, runId, taskId, expected, position))
      }
    ),
    { numRuns: 100 }
  )
})

it.each([64, 256])(
  "looks up a continuing claim-loss episode after %i observations without scanning the task history",
  (size) => {
    const steps: ReadonlyArray<Step> = [
      "Acquired",
      "Missing",
      "Direction",
      ...Array.from({ length: size }, () => "Missing" as const)
    ]
    const records = steps.map(recordFor)
    const evidence = journalEvidenceFrom(records)
    let visits = 0
    let exports = 0
    const stop = observeJournalRecordSequenceOperations((operation) => {
      if (operation._tag === "IndexedRecordVisit") visits += 1
      else exports += 1
    })
    try {
      expect(
        latestTaskClaimReacquisitionDirection(evidence, runId, taskId, expected, JournalPosition.make(records.length))
          ?._tag
      ).toBe("TaskClaimReacquisitionDirected")
    } finally {
      stop()
    }
    expect(exports).toBe(0)
    expect(visits).toBeLessThanOrEqual(64)
  }
)

it("shares claim observation episode storage while earlier publications remain retained", () => {
  const retainedSlots = (size: number): number => {
    let evidence = emptyJournalEvidence()
    const roots: Array<object> = []
    for (let offset = 0; offset < size; offset += 1) {
      evidence = appendJournalEvidence(evidence, recordFor(offset % 2 === 0 ? "Missing" : "ForeignA", offset))
      roots.push(...inspectJournalEvidenceStorage(evidence))
    }
    const visited = new Set<object>()
    const slotsOf = (value: unknown): number => {
      if (typeof value !== "object" || value === null || visited.has(value)) return 0
      visited.add(value)
      const keys = Reflect.ownKeys(value)
      return keys.length + keys.reduce((count, key) => count + slotsOf(Reflect.get(value, key)), 0)
    }
    return roots.reduce((count, root) => count + slotsOf(root), 0)
  }
  expect(retainedSlots(256)).toBeLessThan(retainedSlots(64) * 6)
})
