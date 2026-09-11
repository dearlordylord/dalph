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
import { TaskClaimAcquiredEvent, TaskClaimAcquisitionIntendedEvent } from "../../workflow/registry/event.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeFocusedTaskClaimFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { runTaskClaimReleaseProtocol } from "../../workflow/protocols/task-claim-release/protocol.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { journalEvidenceFrom } from "../../workflow-journal/record-evidence.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
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
  const acquisition = makeTaskClaimAcquisitionOperation({ acquisition: claim, predecessorOperationIds: [] })
  const records = [
    JournalRecord.make({
      event: TaskClaimAcquisitionIntendedEvent.make({ operation: acquisition, version: workflowJournalEventVersion }),
      key: intentRecordKey(claim.operationId),
      position: JournalPosition.make(1),
      runId
    }),
    JournalRecord.make({
      event: TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion }),
      key: outcomeRecordKey(claim.operationId),
      position: acquiredAt,
      runId
    })
  ]

  const evidence = journalEvidenceFrom(records)
  expect(currentTaskClaimAuthority(evidence, taskId, claim, Option.some(JournalPosition.make(1)))).toEqual({
    _tag: "Exact"
  })
  expect(currentTaskClaimAuthority(evidence, taskId, claim, Option.some(acquiredAt))).toEqual({ _tag: "Unobserved" })
  expect(currentTaskClaimAuthority(evidence, taskId, claim, Option.none())).toEqual({ _tag: "Unobserved" })
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
        key: outcomeRecordKey(original.operationId),
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
    expect(currentTaskClaimAuthority(journalEvidenceFrom(records), taskId, original, Option.none())).toEqual({
      _tag: "Foreign"
    })

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

it("classifies the exact current claim with constant indexed work as unrelated history grows", () => {
  const measure = (paddingCount: number) => {
    const runId = RunId.make(`claim-authority-scaling-${paddingCount}`)
    const taskId = TaskId.make("claim-authority-scaling-task")
    const target = FixtureTarget.make("claim-authority-scaling-target")
    const claim = ActiveTaskClaim.make({
      operationId: OperationId.make("claim-authority-scaling-acquisition"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("claim-authority-scaling-token")
    })
    const read = makeTaskClaimObservationOperation(OperationId.make("claim-authority-scaling-read"), target, taskId, [
      claim.operationId
    ])
    const unrelated = Array.from({ length: paddingCount }, (_, index) => {
      const operationId = OperationId.make(`claim-authority-scaling-unrelated-${paddingCount}-${index}`)
      return JournalRecord.make({
        event: TaskClaimAcquiredEvent.make({
          claim: ActiveTaskClaim.make({
            operationId,
            owner: ClaimOwner.make("unrelated"),
            taskId: TaskId.make(`claim-authority-scaling-unrelated-task-${index}`),
            token: ClaimToken.make(`claim-authority-scaling-unrelated-token-${index}`)
          }),
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(operationId),
        position: JournalPosition.make(index + 1),
        runId
      })
    })
    const acquisitionPosition = JournalPosition.make(paddingCount + 1)
    const observationPosition = JournalPosition.make(paddingCount + 2)
    const evidence = journalEvidenceFrom([
      ...unrelated,
      JournalRecord.make({
        event: TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion }),
        key: outcomeRecordKey(claim.operationId),
        position: acquisitionPosition,
        runId
      }),
      JournalRecord.make({
        event: taskTrackerFactsObservedEvent(read.operationId, makeFocusedTaskClaimFactsObserved(read, claim)),
        key: outcomeRecordKey(read.operationId),
        position: observationPosition,
        runId
      })
    ])
    const operations: Array<string> = []
    const stop = observeJournalRecordSequenceOperations((operation) => operations.push(operation._tag))
    try {
      expect(currentTaskClaimAuthority(evidence, taskId, claim, Option.none(), target)).toEqual({ _tag: "Exact" })
    } finally {
      stop()
    }
    return operations
  }

  const operationsAt64 = measure(64)
  expect(measure(256)).toEqual(operationsAt64)
  expect(operationsAt64).toContain("IndexedRecordVisit")
  expect(operationsAt64).not.toContain("HistoricalMaterialization")
})
