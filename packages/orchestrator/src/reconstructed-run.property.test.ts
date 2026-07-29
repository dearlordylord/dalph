import { Option } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  JournalPosition,
  OperationId,
  RunId,
  TaskId,
  TrackerRevision
} from "./domain.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  TaskClaimAcquisitionIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "./journal-store.js"
import { reduceWorkflowJournalHistory } from "./workflow-journal-history.js"
import { makeTaskClaimAcquisitionOperation, makeTrackerGraphObservationOperation } from "./workflow-operation.js"

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
        { event: trackerGraphObservationIntent(observation), key: intentRecordKey(observation.operationId) },
        {
          event: trackerGraphOutcomeObserved(observation.operationId, {
            _tag: "TrackerGraphObserved" as const,
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
          event: TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: 5 }),
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
