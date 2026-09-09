import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Effect } from "effect"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { InRunJournal, JournalStorageUnavailable, type JournalRecord } from "../../../workflow-journal/store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { memoryJournalTestLayerFromPartitionRecords } from "../../../workflow-journal/adapters/memory-store.js"
import { makeWorkflowRunBeganRecord } from "../../../workflow-journal/run-lifecycle.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorResumeRedeliveryIntendedEvent,
  PlannedAttemptExecutorResumeRedeliveryOrdinal
} from "./events.js"
import { appendExecutorCommandDeliveryIntent, isAcceptedExecutorCommandDelivery } from "./command-delivery.js"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("receipt-attempt"),
  baseSha: GitCommitSha.make("4".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/receipt-attempt"),
  executor: TaskExecutorLocator.make("executor:receipt"),
  runId: RunId.make("receipt-run"),
  taskId: TaskId.make("receipt-task"),
  taskRevision: TaskRevision.make("receipt-revision"),
  worktree: WorktreeLocator.make("/worktrees/receipt-attempt")
})
const initial = PlannedAttemptExecutorCommandIntendedEvent.make({
  plannedAttempt,
  command: "Resume",
  ordinal: PlannedAttemptExecutorCommandOrdinal.make(3),
  initiatedBy: { _tag: "DalphCoordinator" },
  occurrenceClassification: "InitiatedAction",
  version: workflowJournalEventVersion
})
const redelivery = PlannedAttemptExecutorResumeRedeliveryIntendedEvent.make({
  plannedAttempt,
  commandOrdinal: initial.ordinal,
  projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
  redeliveryOrdinal: PlannedAttemptExecutorResumeRedeliveryOrdinal.make(1),
  authorization: {
    safeProjectionObservedAt: JournalPosition.make(1),
    witness: {
      activeTaskContinuationRead: {
        graphObservationOperationId: OperationId.make("receipt-graph"),
        taskWorkSpecificationObservationOperationId: OperationId.make("receipt-specification"),
        taskClaimObservationOperationId: OperationId.make("receipt-claim")
      },
      worktreeObservationOperationId: OperationId.make("receipt-worktree"),
      targetLineageObservationOperationId: OperationId.make("receipt-lineage")
    }
  },
  initiatedBy: { _tag: "DalphCoordinator" },
  occurrenceClassification: "InitiatedAction",
  version: workflowJournalEventVersion
})
const journalLayer = memoryJournalTestLayerFromPartitionRecords({
  hot: [
    makeWorkflowRunBeganRecord(
      plannedAttempt.runId,
      FixtureTarget.make("receipt-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
  ]
})

for (const event of [initial, redelivery]) {
  it.effect(`issues ${event._tag} receipt only after the exact memory Journal append`, () =>
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const receipt = yield* appendExecutorCommandDeliveryIntent(event)
      const records = yield* journal.read(plannedAttempt.runId)
      expect(records.at(-1)).toMatchObject({ event, position: receipt.acceptedAt, runId: plannedAttempt.runId })
      expect(isAcceptedExecutorCommandDelivery(receipt)).toBe(true)
      expect(isAcceptedExecutorCommandDelivery({ ...receipt })).toBe(false)
      expect(isAcceptedExecutorCommandDelivery(records.at(-1))).toBe(false)
      expect(receipt.plannedAttempt).toEqual(plannedAttempt)
      expect(receipt.commandOrdinal).toBe(initial.ordinal)
    }).pipe(Effect.provide(journalLayer))
  )
}

const alteredResults: ReadonlyArray<readonly [string, (record: JournalRecord) => JournalRecord]> = [
  ["wrong Run", (record) => ({ ...record, runId: RunId.make("foreign-run") })],
  ["wrong key", (record) => ({ ...record, key: JournalRecordKey.make("foreign-key") })],
  [
    "non-command event",
    (record) => ({
      ...record,
      event: makeWorkflowRunBeganRecord(
        plannedAttempt.runId,
        FixtureTarget.make("foreign-returned-record"),
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      ).event
    })
  ],
  ["wrong event", (record) => ({ ...record, event: initial })],
  [
    "wrong attempt",
    (record) => ({
      ...record,
      event: { ...redelivery, plannedAttempt: { ...plannedAttempt, attemptId: AttemptId.make("foreign-attempt") } }
    })
  ],
  [
    "wrong command ordinal",
    (record) => ({ ...record, event: { ...redelivery, commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(4) } })
  ],
  [
    "wrong projection ordinal",
    (record) => ({
      ...record,
      event: { ...redelivery, projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(2) }
    })
  ],
  [
    "wrong redelivery ordinal",
    (record) => ({
      ...record,
      event: { ...redelivery, redeliveryOrdinal: PlannedAttemptExecutorResumeRedeliveryOrdinal.make(2) }
    })
  ],
  [
    "wrong authorization",
    (record) => ({
      ...record,
      event: {
        ...redelivery,
        authorization: { ...redelivery.authorization, safeProjectionObservedAt: JournalPosition.make(2) }
      }
    })
  ]
]
for (const [name, alter] of alteredResults) {
  it.effect(`rejects ${name} returned by the append boundary without issuing a receipt`, () =>
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const result = yield* appendExecutorCommandDeliveryIntent(redelivery).pipe(
        Effect.provideService(
          InRunJournal,
          InRunJournal.of({ read: journal.read, append: (...args) => journal.append(...args).pipe(Effect.map(alter)) })
        ),
        Effect.exit
      )
      expect(result._tag).toBe("Failure")
      expect((yield* journal.read(plannedAttempt.runId)).at(-1)?.event).toEqual(redelivery)
    }).pipe(Effect.provide(journalLayer))
  )
}

it.effect("does not issue a receipt when the Journal append fails without writing", () =>
  Effect.gen(function* () {
    const journal = yield* InRunJournal
    const result = yield* appendExecutorCommandDeliveryIntent(initial).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          read: journal.read,
          append: () =>
            Effect.fail(new JournalStorageUnavailable({ operation: "JournalStore.append", detail: "unavailable" }))
        })
      ),
      Effect.exit
    )
    expect(result._tag).toBe("Failure")
    expect(yield* journal.read(plannedAttempt.runId)).toHaveLength(1)
  }).pipe(Effect.provide(journalLayer))
)
