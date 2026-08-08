import { RunId, TaskId } from "@dalph/contracts"
import { Option } from "effect"
import { expect, it } from "vitest"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskClaimAcquiredEvent } from "../../workflow/registry/event.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { JournalRecord } from "../../workflow-journal/store.js"
import { currentTaskClaimAuthority } from "./task-claim-authority.js"

it("trusts an atomic claim acquired in this activation but rereads one inherited across restart", () => {
  const runId = RunId.make("claim-authority-activation")
  const taskId = TaskId.make("A")
  const claim = ActiveTaskClaim.make({
    operationId: OperationId.make("claim-authority-acquisition"),
    owner: ClaimOwner.make("dalph"),
    taskId,
    token: ClaimToken.make("claim-authority-token")
  })
  const acquiredAt = JournalPosition.make(2)
  const records = [
    JournalRecord.make({
      event: TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion }),
      key: JournalRecordKey.make("claim-authority-acquired"),
      position: acquiredAt,
      runId
    })
  ]

  expect(currentTaskClaimAuthority(records, taskId, claim, Option.some(JournalPosition.make(1)))).toEqual({
    _tag: "Exact"
  })
  expect(currentTaskClaimAuthority(records, taskId, claim, Option.some(acquiredAt))).toEqual({ _tag: "Unobserved" })
  expect(currentTaskClaimAuthority(records, taskId, claim, Option.none())).toEqual({ _tag: "Unobserved" })
})
