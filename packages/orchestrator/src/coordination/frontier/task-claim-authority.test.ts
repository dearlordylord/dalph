import { RunId, TaskId } from "@dalph/contracts"
import { Effect, Option, Ref } from "effect"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import {
  ActiveTaskClaim,
  TaskClaimOwnershipConflict,
  TaskClaimRelease
} from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskClaimAcquiredEvent } from "../../workflow/registry/event.js"
import { makeTaskClaimObservationOperation } from "../../workflow/registry/operation.js"
import {
  makeFocusedTaskClaimFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { runTaskClaimReleaseProtocol } from "../../workflow/protocols/task-claim-release/protocol.js"
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

const sameOwnerReplacementIsForeign = (replacementChange: {
  readonly operationId: OperationId
  readonly token: ClaimToken
}) =>
  Effect.gen(function* () {
    const runId = RunId.make("claim-authority-same-owner-replacement")
    const taskId = TaskId.make("A")
    const target = FixtureTarget.make("claim-authority-same-owner-target")
    const original = ActiveTaskClaim.make({
      operationId: OperationId.make("claim-authority-original-operation"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("claim-authority-original-token")
    })
    const replacement = ActiveTaskClaim.make({
      ...original,
      operationId: replacementChange.operationId,
      token: replacementChange.token
    })
    const read = makeTaskClaimObservationOperation(
      OperationId.make("claim-authority-same-owner-read"),
      target,
      taskId,
      [original.operationId]
    )
    const records = [
      JournalRecord.make({
        event: TaskClaimAcquiredEvent.make({ claim: original, version: workflowJournalEventVersion }),
        key: JournalRecordKey.make("claim-authority-same-owner-acquired"),
        position: JournalPosition.make(1),
        runId
      }),
      JournalRecord.make({
        event: taskTrackerFactsObservedEvent(read.operationId, makeFocusedTaskClaimFactsObserved(read, replacement)),
        key: JournalRecordKey.make("claim-authority-same-owner-observed"),
        position: JournalPosition.make(2),
        runId
      })
    ]
    expect(currentTaskClaimAuthority(records, taskId, original, Option.none())).toEqual({ _tag: "Foreign" })

    const releaseCalls = yield* Ref.make(0)
    const failure = yield* runTaskClaimReleaseProtocol(
      {
        readTaskClaim: () => Effect.succeed(replacement),
        releaseTaskClaim: () => Ref.update(releaseCalls, (count) => count + 1)
      },
      TaskClaimRelease.make({ claim: original, operationId: OperationId.make("claim-authority-release") })
    ).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskClaimOwnershipConflict)
    expect(failure).toMatchObject({ observed: replacement })
    expect(yield* Ref.get(releaseCalls)).toBe(0)
  })

it.effect("classifies a same-owner token replacement as foreign and preserves its observation", () =>
  sameOwnerReplacementIsForeign({
    operationId: OperationId.make("claim-authority-original-operation"),
    token: ClaimToken.make("claim-authority-replacement-token")
  })
)

it.effect("classifies a same-owner operation replacement as foreign and preserves its observation", () =>
  sameOwnerReplacementIsForeign({
    operationId: OperationId.make("claim-authority-replacement-operation"),
    token: ClaimToken.make("claim-authority-original-token")
  })
)
