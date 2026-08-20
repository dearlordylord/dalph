import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import { Option } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import {
  TaskClaimAcquisitionIntendedEvent,
  WorkflowRunBeganEvent,
  WorkflowRunTerminatedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  workflowRunBeganRecordKey,
  workflowRunTerminatedRecordKey
} from "../../workflow-journal/record-key.js"
import { advanceWorkflowJournalHistory, reduceWorkflowJournalHistory } from "./history.js"
import { reconstructedTaskGraphFor } from "./graph-knowledge.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { completedRunFinalityFixture } from "../../../test/run-finality.js"

const safeSegment = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)

const generatedValidHistory = (segments: ReadonlyArray<string>, terminated = false) => {
  const runId = RunId.make(`incremental-${segments.join("-")}`)
  const target = FixtureTarget.make(`run-target-${segments.join("-")}`)
  const workflowRecords = [
    {
      event: WorkflowRunBeganEvent.make({
        initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) }),
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        target,
        version: workflowJournalEventVersion
      }),
      key: workflowRunBeganRecordKey
    },
    ...segments.flatMap((segment) => {
      const taskId = TaskId.make(`task-${segment}`)
      const observation = makeTrackerGraphObservationOperation(
        OperationId.make(`observation-${segment}`),
        FixtureTarget.make(`target-${segment}`)
      )
      const claim = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make(`claim-${segment}`),
          owner: ClaimOwner.make(`owner-${segment}`),
          taskId,
          token: ClaimToken.make(`token-${segment}`)
        },
        predecessorOperationIds: [observation.operationId]
      })
      return [
        { event: taskTrackerReadIntent(observation), key: intentRecordKey(observation.operationId) },
        {
          event: taskTrackerGraphFactsObserved(observation, {
            revision: TrackerRevision.make(`revision-${segment}`),
            taskIds: [taskId]
          }),
          key: outcomeRecordKey(observation.operationId)
        },
        {
          event: TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion }),
          key: intentRecordKey(claim.acquisition.operationId)
        }
      ]
    })
  ]
  const terminal = completedRunFinalityFixture({
    observedAt: JournalPosition.make(workflowRecords.length + 2),
    runId,
    target
  })
  const records = terminated
    ? [
        ...workflowRecords,
        { event: terminal.intent, key: intentRecordKey(terminal.operation.operationId) },
        { event: terminal.observation, key: outcomeRecordKey(terminal.operation.operationId) },
        {
          event: WorkflowRunTerminatedEvent.make({
            disposition: "Completed",
            evidence: terminal.evidence,
            occurrenceClassification: "NonActionOccurrence",
            version: workflowJournalEventVersion
          }),
          key: workflowRunTerminatedRecordKey
        }
      ]
    : workflowRecords
  return {
    records: records.map((record, index) => ({ ...record, position: JournalPosition.make(index + 1), runId })),
    runId
  }
}

it("never creates responsibility from generated graph membership", () => {
  fc.assert(
    fc.property(fc.uniqueArray(safeSegment, { minLength: 1, maxLength: 20 }), (segments) => {
      const firstSegment = Option.getOrThrow(Option.fromUndefinedOr(segments[0]))

      const runId = RunId.make(`reconstructed-property-${firstSegment}`)
      const taskIds = segments.map((segment) => TaskId.make(`task-${segment}`))
      const responsibleTaskId = Option.getOrThrow(Option.fromUndefinedOr(taskIds[0]))

      const observation = makeTrackerGraphObservationOperation(
        OperationId.make(`observation-${firstSegment}`),
        FixtureTarget.make(`target-${firstSegment}`)
      )
      const claim = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make(`claim-${firstSegment}`),
          owner: ClaimOwner.make(`owner-${firstSegment}`),
          taskId: responsibleTaskId,
          token: ClaimToken.make(`token-${firstSegment}`)
        },
        predecessorOperationIds: [observation.operationId]
      })
      const prefix = [
        { event: taskTrackerReadIntent(observation), key: intentRecordKey(observation.operationId) },
        {
          event: taskTrackerGraphFactsObserved(observation, {
            revision: TrackerRevision.make(`revision-${firstSegment}`),
            taskIds
          }),
          key: outcomeRecordKey(observation.operationId)
        }
      ] as const
      const beforeIntent = reduceWorkflowJournalHistory(
        runId,
        prefix.map((record, index) => ({ ...record, position: JournalPosition.make(index + 1), runId }))
      )
      expect(beforeIntent._tag).toBe("ValidWorkflowJournalHistory")
      if (beforeIntent._tag !== "ValidWorkflowJournalHistory") return
      expect(beforeIntent.runState.responsibility.entries).toEqual([])

      const afterIntentRecords = [
        ...prefix,
        {
          event: TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion }),
          key: intentRecordKey(claim.acquisition.operationId)
        }
      ].map((record, index) => ({ ...record, position: JournalPosition.make(index + 1), runId }))
      const afterIntent = reduceWorkflowJournalHistory(runId, afterIntentRecords)
      expect(afterIntent._tag).toBe("ValidWorkflowJournalHistory")
      if (afterIntent._tag !== "ValidWorkflowJournalHistory") return
      expect(afterIntent.runState.responsibility.entries).toEqual([
        {
          _tag: "TaskClaimResponsibility",
          acquisition: claim.acquisition,
          beganAt: JournalPosition.make(3),
          taskId: responsibleTaskId
        }
      ])
    })
  )
})

it("advances every generated valid prefix to the same state and frontier as complete replay", () => {
  fc.assert(
    fc.property(fc.uniqueArray(safeSegment, { minLength: 1, maxLength: 8 }), fc.boolean(), (segments, terminated) => {
      const { records, runId } = generatedValidHistory(segments, terminated)
      const first = Option.getOrThrow(Option.fromUndefinedOr(records[0]))
      let incremental = reduceWorkflowJournalHistory(runId, [first])
      expect(incremental._tag).toBe("ValidWorkflowJournalHistory")
      if (incremental._tag !== "ValidWorkflowJournalHistory") return
      let accepted = [first]
      expect(incremental).toEqual(reduceWorkflowJournalHistory(runId, accepted))
      for (const record of records.slice(1)) {
        accepted = [...accepted, record]
        incremental = advanceWorkflowJournalHistory(incremental, record)
        expect(incremental._tag).toBe("ValidWorkflowJournalHistory")
        if (incremental._tag !== "ValidWorkflowJournalHistory") return
        expect(incremental).toEqual(reduceWorkflowJournalHistory(runId, accepted))
      }
    }),
    { numRuns: 100 }
  )
})

it("reuses a graph projection and safely replays an accepted prefix without process-local indexes", () => {
  const { records, runId } = generatedValidHistory(["fallback"])
  const prior = reduceWorkflowJournalHistory(runId, records)
  expect(prior._tag).toBe("ValidWorkflowJournalHistory")
  if (prior._tag !== "ValidWorkflowJournalHistory") return
  const target = FixtureTarget.make("target-fallback")
  const firstGraph = reconstructedTaskGraphFor(prior.runState.graphKnowledge, target)
  expect(reconstructedTaskGraphFor(prior.runState.graphKnowledge, target)).toBe(firstGraph)
  const nextOperation = makeTrackerGraphObservationOperation(
    OperationId.make("observation-fallback-next"),
    FixtureTarget.make("target-fallback-next")
  )
  const successor = {
    event: taskTrackerReadIntent(nextOperation),
    key: intentRecordKey(nextOperation.operationId),
    position: JournalPosition.make(records.length + 1),
    runId
  }
  const acceptedWithoutIndexes = { ...prior }
  expect(advanceWorkflowJournalHistory(acceptedWithoutIndexes, successor)).toEqual(
    reduceWorkflowJournalHistory(runId, [...records, successor])
  )
})

it("rejects generated malformed successors with the same issues as complete replay", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(safeSegment, { minLength: 1, maxLength: 8 }),
      fc.constantFrom("position", "runId", "key", "duplicateKey", "afterTermination" as const),
      (segments, mutation) => {
        const nextSegment = `next_${segments.length}_${Option.getOrThrow(Option.fromUndefinedOr(segments[0]))}`
        const { records, runId } = generatedValidHistory(segments, mutation === "afterTermination")
        const prior = reduceWorkflowJournalHistory(runId, records)
        expect(prior._tag).toBe("ValidWorkflowJournalHistory")
        if (prior._tag !== "ValidWorkflowJournalHistory") return
        const nextOperation = makeTrackerGraphObservationOperation(
          OperationId.make(`observation-${nextSegment}`),
          FixtureTarget.make(`target-${nextSegment}`)
        )
        const validNext = {
          event: taskTrackerReadIntent(nextOperation),
          key: intentRecordKey(nextOperation.operationId),
          position: JournalPosition.make(records.length + 1),
          runId
        }
        const first = Option.getOrThrow(Option.fromUndefinedOr(records[0]))
        const malformed =
          mutation === "position"
            ? { ...validNext, position: JournalPosition.make(records.length) }
            : mutation === "runId"
              ? { ...validNext, runId: RunId.make(`other-${nextSegment}`) }
              : mutation === "key"
                ? { ...validNext, key: JournalRecordKey.make(`wrong-${nextSegment}`) }
                : mutation === "duplicateKey"
                  ? { ...validNext, key: first.key }
                  : validNext
        const incremental = advanceWorkflowJournalHistory(prior, malformed)
        const replay = reduceWorkflowJournalHistory(runId, [...records, malformed])
        expect(incremental).toEqual(replay)
        expect(incremental._tag).toBe("InvalidWorkflowJournalHistory")
      }
    ),
    { numRuns: 100 }
  )
})
