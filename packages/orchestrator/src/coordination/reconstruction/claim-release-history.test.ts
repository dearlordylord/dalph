import { it } from "@effect/vitest"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { ActiveTaskClaim, TaskClaimRelease } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { TaskClaimReleasedEvent } from "../../workflow/registry/event.js"
import { invalidTaskClaimRelease, validateTaskClaimRelease } from "./claim-release-history.js"

const release = TaskClaimRelease.make({
  claim: ActiveTaskClaim.make({
    operationId: OperationId.make("claim-release-history-acquisition"),
    owner: ClaimOwner.make("dalph"),
    taskId: TaskId.make("claim-release-history-task"),
    token: ClaimToken.make("claim-release-history-token")
  }),
  operationId: OperationId.make("claim-release-history-release")
})
const releasedRecord = {
  event: TaskClaimReleasedEvent.make({ release, version: workflowJournalEventVersion }),
  key: JournalRecordKey.make("claim-release-history-key"),
  position: JournalPosition.make(1),
  runId: RunId.make("claim-release-history-run")
} satisfies JournalRecord

it("reports a released claim that has no earlier exact intent", () => {
  expect(invalidTaskClaimRelease(releasedRecord, [releasedRecord])).toBe(
    `released task claim contradicts operation ${release.operationId}`
  )
  const details: Array<string> = []
  validateTaskClaimRelease(releasedRecord, [releasedRecord], (detail) => details.push(detail))
  expect(details).toEqual([`released task claim contradicts operation ${release.operationId}`])
})
