import { expect, it } from "vitest"
import fc from "fast-check"
import { RunId, TaskId } from "@dalph/contracts"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { OperationId } from "../workflow/identity.js"
import { AttemptChoiceRequestId } from "../workflow/protocols/attempt-choice/events.js"
import { makeTaskClaimReleaseOperation } from "../workflow/registry/operation.js"
import { TaskClaimReleaseIntendedEvent, TaskClaimReleasedEvent } from "../workflow/registry/event.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import { observeJournalRecordSequenceOperations } from "./record-sequence.js"
import {
  appendStopRequestDisposition,
  emptyStopRequestDisposition,
  stopRequestDispositionAt
} from "./stop-request-disposition.js"

const runId = RunId.make("stop-disposition-index")
const requestId = AttemptChoiceRequestId.make({ runId, nonce: "stop-index" })
const claim = ActiveTaskClaim.make({
  operationId: OperationId.make("claim-source"),
  owner: ClaimOwner.make("dalph"),
  taskId: TaskId.make("claim-task"),
  token: ClaimToken.make("claim-token")
})
const observationOperationId = OperationId.make("focused-claim")
const recordsFor = (
  kinds: ReadonlyArray<number>,
  operationName = "arbitrary-valid-release-id",
  request = requestId,
  releasedClaim = claim
): ReadonlyArray<JournalRecord> =>
  kinds.map((kind, offset) => {
    const release = { claim: releasedClaim, operationId: OperationId.make(operationName) }
    const event =
      kind === 2
        ? TaskClaimReleasedEvent.make({ release, version: workflowJournalEventVersion })
        : TaskClaimReleaseIntendedEvent.make({
            operation: makeTaskClaimReleaseOperation({
              release,
              predecessorOperationIds: [releasedClaim.operationId, observationOperationId],
              authority:
                kind === 0
                  ? { _tag: "StoppedAttemptClaimReleaseAuthority", observationOperationId, requestId: request }
                  : { _tag: "WorkflowClaimReleaseAuthority" }
            }),
            version: workflowJournalEventVersion
          })
    return { event, key: describeJournalEvent(event).expectedKey, runId, position: JournalPosition.make(offset + 1) }
  })

it("correlates alternate release operation IDs and never retroactively accepts an outcome before its intent", () => {
  const records = recordsFor([2, 0, 2], "not-a-generated-stop-name")
  const index = records.reduce(appendStopRequestDisposition, emptyStopRequestDisposition())
  expect(stopRequestDispositionAt(index, requestId, 1).releaseOutcome).toBeUndefined()
  expect(stopRequestDispositionAt(index, requestId, 2).releaseIntent).toBe(records[1])
  expect(stopRequestDispositionAt(index, requestId, 2).releaseOutcome).toBeUndefined()
  expect(stopRequestDispositionAt(index, requestId, 3).releaseOutcome).toBe(records[2])
})

it("matches chronological last-intent correlation even for malformed duplicate operation/key sequences", () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 40 }), fc.nat(40), (kinds, cutoff) => {
      const records = recordsFor(kinds)
      const index = records.reduce(appendStopRequestDisposition, emptyStopRequestDisposition())
      const visible = records.filter(({ position }) => position <= cutoff)
      const intent = visible.findLast(
        ({ event }) =>
          event._tag === "TaskClaimReleaseIntended" &&
          event.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority"
      )
      const outcome = visible.findLast(({ event, position }) => {
        if (event._tag !== "TaskClaimReleased") return false
        const prior = visible.findLast(
          (candidate) => candidate.position < position && candidate.event._tag === "TaskClaimReleaseIntended"
        )
        return (
          prior?.event._tag === "TaskClaimReleaseIntended" &&
          prior.event.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority"
        )
      })
      const actual = stopRequestDispositionAt(index, requestId, cutoff)
      expect(actual.releaseIntent).toBe(intent)
      expect(actual.releaseOutcome).toBe(outcome)
    })
  )
})

it("bounds warm request lookup after 64 and 256 unrelated claims", () => {
  for (const size of [64, 256]) {
    const own = recordsFor([0, 2])
    let index = own.reduce(appendStopRequestDisposition, emptyStopRequestDisposition())
    for (let offset = 0; offset < size; offset += 1) {
      const unrelated = recordsFor(
        [0, 2],
        `release-${offset}`,
        AttemptChoiceRequestId.make({ runId, nonce: `other-${offset}` }),
        ActiveTaskClaim.make({
          ...claim,
          operationId: OperationId.make(`other-claim-${offset}`),
          token: ClaimToken.make(`other-token-${offset}`)
        })
      )
      for (const record of unrelated)
        index = appendStopRequestDisposition(index, {
          ...record,
          position: JournalPosition.make(2 + offset * 2 + record.position)
        })
    }
    let visits = 0
    const stop = observeJournalRecordSequenceOperations((operation) => {
      expect(operation._tag).toBe("IndexedRecordVisit")
      visits += 1
    })
    try {
      expect(stopRequestDispositionAt(index, requestId, size * 2 + 2).releaseOutcome).toBe(own[1])
    } finally {
      stop()
    }
    expect(visits).toBeLessThanOrEqual(4)
  }
})
