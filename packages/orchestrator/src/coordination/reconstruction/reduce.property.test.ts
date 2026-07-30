import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import { Option } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskClaimAcquisitionIntendedEvent, taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { reduceWorkflowJournalHistory } from "./history.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"

const safeSegment = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)

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
