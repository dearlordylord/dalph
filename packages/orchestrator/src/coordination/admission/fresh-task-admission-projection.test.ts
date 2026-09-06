import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { validSnapshot } from "../../../test/task-dag.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { FreshTaskAdmissionReleaseAuthorityInvalid, makeFreshTaskAdmissionBasis } from "./fresh-task-admission.js"
import { projectFreshTaskAdmission, projectFreshTaskCommitments } from "./fresh-task-admission-projection.js"
import { TaskWorkCapacity } from "./capacity.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"

const runId = RunId.make("fresh-admission-projection-run")
const taskId = TaskId.make("A")
const target = FixtureTarget.make("fresh-admission-projection-target")
const claimOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: OperationId.make("claim:A:primary"),
    owner: ClaimOwner.make("dalph:fresh-admission-projection"),
    taskId,
    token: ClaimToken.make("claim:A:primary-token")
  },
  predecessorOperationIds: []
})
const postClaimGraphOperation = makeTrackerGraphObservationOperation(
  { _tag: "WorkflowEstablishment" },
  OperationId.make("post-claim-graph:A"),
  target,
  [claimOperation.acquisition.operationId],
  [taskId]
)
const postClaimGraph = validSnapshot({
  revision: "post-claim-graph:A",
  tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
})
const specificationOperation = makeTaskWorkSpecificationObservationOperation(
  OperationId.make("specification:A"),
  target,
  taskId,
  [postClaimGraphOperation.operationId]
)
const taskWorkSpecification = makeTaskWorkSpecification({ body: "Implement A", taskId, title: "Task A" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt:A:1"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-A-1"),
  executor: TaskExecutorLocator.make("executor:controlled"),
  runId,
  taskId,
  taskRevision: TaskRevision.make(taskWorkSpecification.fingerprint),
  worktree: WorktreeLocator.make("/worktrees/attempt-A-1")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("plan:A:1"),
  plannedAttempt,
  predecessorOperationIds: [specificationOperation.operationId]
})
const worktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("worktree:A:1"),
  plannedAttempt,
  predecessorOperationIds: [planOperation.operationId]
})
const worktreeProof = PlannedWorktreeReady.make({
  baseSha: plannedAttempt.baseSha,
  branch: plannedAttempt.branch,
  headSha: plannedAttempt.baseSha,
  worktree: plannedAttempt.worktree
})

type EventRow = Pick<JournalRecord, "event" | "key">

const recordsFrom = (rows: ReadonlyArray<EventRow>): ReadonlyArray<JournalRecord> => [
  makeWorkflowRunBeganRecord(
    runId,
    target,
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  ),
  ...rows.map((row, index) => ({ ...row, position: JournalPosition.make(index + 2), runId }))
]

const prefixRows: ReadonlyArray<ReadonlyArray<EventRow>> = [
  [
    {
      event: TaskClaimAcquisitionIntendedEvent.make({
        operation: claimOperation,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(claimOperation.acquisition.operationId)
    }
  ],
  [
    {
      event: TaskClaimAcquiredEvent.make({
        claim: ActiveTaskClaim.make(claimOperation.acquisition),
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(claimOperation.acquisition.operationId)
    }
  ],
  [
    {
      event: taskTrackerReadIntent(postClaimGraphOperation),
      key: intentRecordKey(postClaimGraphOperation.operationId)
    },
    {
      event: taskTrackerFactsObservedEvent(
        postClaimGraphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(postClaimGraphOperation, postClaimGraph)
      ),
      key: outcomeRecordKey(postClaimGraphOperation.operationId)
    }
  ],
  [
    { event: taskTrackerReadIntent(specificationOperation), key: intentRecordKey(specificationOperation.operationId) },
    {
      event: taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, taskWorkSpecification)
      ),
      key: outcomeRecordKey(specificationOperation.operationId)
    }
  ],
  [
    {
      event: TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }),
      key: attemptPlanRecordKey(plannedAttempt.attemptId)
    }
  ],
  [
    {
      event: TaskWorktreeReconciliationIntendedEvent.make({
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(worktreeOperation.operationId)
    }
  ],
  [
    {
      event: TaskWorktreeReadyEvent.make({
        operationId: worktreeOperation.operationId,
        proof: worktreeProof,
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(worktreeOperation.operationId)
    }
  ],
  [
    {
      event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId)
    }
  ]
]

const claimCommitment = (() => {
  const projection = projectFreshTaskAdmission(runId, recordsFrom(prefixRows[0] ?? []))
  if (projection._tag === "FreshTaskAdmissionProjectionInvalid") return expect.fail(projection.issues.join("; "))
  const commitment = projection.commitments[0]?.commitment
  if (commitment === undefined) return expect.fail("claim intent did not project a commitment")
  return commitment
})()

describe("projectFreshTaskCommitments", () => {
  const restartPrefixes = [
    "claim intent without outcome",
    "exact claim acquired",
    "accepted complete post-claim graph",
    "accepted focused task-work specification",
    "immutable attempt plan recorded",
    "worktree intent without outcome",
    "exact planned worktree ready",
    "executor-work responsibility accepted"
  ] as const

  it.each(restartPrefixes.map((name, index) => [name, index] as const))(
    "reconstructs the accepted restart prefix: %s",
    (_, prefixIndex) => {
      const records = recordsFrom(prefixRows.slice(0, prefixIndex + 1).flat())
      const projection = projectFreshTaskAdmission(runId, records)
      expect(projection._tag).toBe("FreshTaskAdmissionProjection")
      if (projection._tag !== "FreshTaskAdmissionProjection") return

      expect(projection.commitments).toEqual(
        prefixIndex < 7 ? [{ _tag: "FreshTaskCommitted", commitment: claimCommitment }] : []
      )
      expect(projection.heldAttempts).toEqual(prefixIndex < 7 ? [] : [plannedAttempt])
      expect(projection.releaseEvidence).toMatchObject(
        prefixIndex < 7
          ? []
          : [
              {
                _tag: "ExactAttemptHandoffAccepted",
                claimOperationId: claimOperation.acquisition.operationId,
                plannedAttempt,
                runId,
                taskId
              }
            ]
      )
      const basis = Effect.runSync(
        makeFreshTaskAdmissionBasis({
          acceptedAt: projection.acceptedAt,
          capacity: TaskWorkCapacity.make(1),
          entries: [],
          projection,
          runId
        })
      )
      expect(basis.occupied.get(taskId)).toEqual(
        prefixIndex < 7
          ? { _tag: "FreshTaskCommitted", commitment: claimCommitment }
          : { _tag: "ExactAttemptHeld", plannedAttempt }
      )
      expect(projectFreshTaskCommitments(runId, records)).toEqual(projection.commitments)
    }
  )

  it.effect("ends only the exact pre-ownership operation rejected by the tracker", () =>
    Effect.sync(() => {
      const foreignOperationId = OperationId.make("claim:A:foreign-cycle")
      const foreignClaim = ActiveTaskClaim.make({
        operationId: OperationId.make("other-owner:claim:A"),
        owner: ClaimOwner.make("other-owner"),
        taskId,
        token: ClaimToken.make("other-owner-token")
      })
      const intent = prefixRows[0] ?? []
      const crossOperationRejection: EventRow = {
        event: TaskClaimAcquisitionRejectedEvent.make({
          observed: foreignClaim,
          operationId: foreignOperationId,
          reason: "ForeignClaim",
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(foreignOperationId)
      }
      const exactRejection: EventRow = {
        event: TaskClaimAcquisitionRejectedEvent.make({
          observed: foreignClaim,
          operationId: claimOperation.acquisition.operationId,
          reason: "ForeignClaim",
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(claimOperation.acquisition.operationId)
      }

      expect(projectFreshTaskAdmission(runId, recordsFrom([...intent, crossOperationRejection]))._tag).toBe(
        "FreshTaskAdmissionProjectionInvalid"
      )
      expect(projectFreshTaskAdmission(runId, recordsFrom([...intent, exactRejection]))).toMatchObject({
        _tag: "FreshTaskAdmissionProjection"
      })
    })
  )

  it("does not release an owned claim even if malformed later history contains a rejection", () => {
    const foreignClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("other-owner:late-claim:A"),
      owner: ClaimOwner.make("other-owner"),
      taskId,
      token: ClaimToken.make("other-owner-late-token")
    })
    const rejection: EventRow = {
      event: TaskClaimAcquisitionRejectedEvent.make({
        observed: foreignClaim,
        operationId: claimOperation.acquisition.operationId,
        reason: "ForeignClaim",
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(claimOperation.acquisition.operationId)
    }

    expect(projectFreshTaskAdmission(runId, recordsFrom([...prefixRows.slice(0, 2).flat(), rejection]))._tag).toBe(
      "FreshTaskAdmissionProjectionInvalid"
    )
  })

  it("rejects duplicate and conflicting outcomes for the same release key", () => {
    const foreignClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("other-owner:duplicate-claim:A"),
      owner: ClaimOwner.make("other-owner"),
      taskId,
      token: ClaimToken.make("other-owner-duplicate-token")
    })
    const rejection: EventRow = {
      event: TaskClaimAcquisitionRejectedEvent.make({
        observed: foreignClaim,
        operationId: claimOperation.acquisition.operationId,
        reason: "ForeignClaim",
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(claimOperation.acquisition.operationId)
    }
    const duplicate = projectFreshTaskAdmission(runId, recordsFrom([...(prefixRows[0] ?? []), rejection, rejection]))
    const conflicting = projectFreshTaskAdmission(runId, recordsFrom([...prefixRows.flat(), rejection]))

    expect(duplicate._tag).toBe("FreshTaskAdmissionProjectionInvalid")
    expect(conflicting._tag).toBe("FreshTaskAdmissionProjectionInvalid")
  })

  it("rejects a genuine prefix supplied under a different Run identity", () => {
    expect(
      projectFreshTaskAdmission(RunId.make("fresh-admission-projection-other-run"), recordsFrom(prefixRows[0] ?? []))
        ._tag
    ).toBe("FreshTaskAdmissionProjectionInvalid")
  })

  it.effect("binds an opaque projection to its exact Run and accepted position", () =>
    Effect.gen(function* () {
      const projection = projectFreshTaskAdmission(runId, recordsFrom(prefixRows[0] ?? []))
      if (projection._tag !== "FreshTaskAdmissionProjection") return yield* Effect.die(projection)
      const otherRun = yield* makeFreshTaskAdmissionBasis({
        acceptedAt: projection.acceptedAt,
        capacity: TaskWorkCapacity.make(1),
        entries: [],
        projection,
        runId: RunId.make("fresh-admission-basis-other-run")
      }).pipe(Effect.flip)
      const otherPosition = yield* makeFreshTaskAdmissionBasis({
        acceptedAt: JournalPosition.make(projection.acceptedAt + 1),
        capacity: TaskWorkCapacity.make(1),
        entries: [],
        projection,
        runId
      }).pipe(Effect.flip)

      expect(otherRun).toBeInstanceOf(FreshTaskAdmissionReleaseAuthorityInvalid)
      expect(otherRun).toMatchObject({ reason: "RunMismatch", runId: "fresh-admission-basis-other-run" })
      expect(otherPosition).toBeInstanceOf(FreshTaskAdmissionReleaseAuthorityInvalid)
      expect(otherPosition).toMatchObject({ reason: "AcceptedPositionMismatch", runId })
    })
  )

  it("retains the commitment when responsibility begins without exact accepted worktree-ready evidence", () => {
    const withoutWorktreeReady = recordsFrom([...prefixRows.slice(0, 5).flat(), ...(prefixRows[7] ?? [])])

    expect(projectFreshTaskAdmission(runId, withoutWorktreeReady)._tag).toBe("FreshTaskAdmissionProjectionInvalid")
  })

  it("does not let another task's responsibility handoff release this task's commitment", () => {
    const otherTaskId = TaskId.make("B")
    const otherPlannedAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("attempt:B:1"),
      branch: TaskBranchRef.make("refs/heads/dalph/attempt-B-1"),
      taskId: otherTaskId,
      taskRevision: TaskRevision.make("revision:B:1"),
      worktree: WorktreeLocator.make("/worktrees/attempt-B-1")
    })
    const otherPlanOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("plan:B:1"),
      plannedAttempt: otherPlannedAttempt,
      predecessorOperationIds: [specificationOperation.operationId]
    })
    const otherWorktreeOperation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("worktree:B:1"),
      plannedAttempt: otherPlannedAttempt,
      predecessorOperationIds: [otherPlanOperation.operationId]
    })
    const otherWorktreeProof = PlannedWorktreeReady.make({
      baseSha: otherPlannedAttempt.baseSha,
      branch: otherPlannedAttempt.branch,
      headSha: otherPlannedAttempt.baseSha,
      worktree: otherPlannedAttempt.worktree
    })
    const records = recordsFrom([
      ...prefixRows.slice(0, 4).flat(),
      {
        event: TaskAttemptPlannedEvent.make({ operation: otherPlanOperation, version: workflowJournalEventVersion }),
        key: attemptPlanRecordKey(otherPlannedAttempt.attemptId)
      },
      {
        event: TaskWorktreeReconciliationIntendedEvent.make({
          operation: otherWorktreeOperation,
          version: workflowJournalEventVersion
        }),
        key: intentRecordKey(otherWorktreeOperation.operationId)
      },
      {
        event: TaskWorktreeReadyEvent.make({
          operationId: otherWorktreeOperation.operationId,
          proof: otherWorktreeProof,
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(otherWorktreeOperation.operationId)
      },
      {
        event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt: otherPlannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(otherPlannedAttempt.attemptId)
      }
    ])

    expect(projectFreshTaskAdmission(runId, records)._tag).toBe("FreshTaskAdmissionProjectionInvalid")
  })

  it("uses a distinct later operation after a rejected operation instead of resurrecting the old cycle", () => {
    const nextOperation = makeTaskClaimAcquisitionOperation({
      acquisition: {
        ...claimOperation.acquisition,
        operationId: OperationId.make("claim:A:next"),
        token: ClaimToken.make("claim:A:next-token")
      },
      predecessorOperationIds: [claimOperation.acquisition.operationId]
    })
    const foreignClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("other-owner:claim:A:cleared"),
      owner: ClaimOwner.make("other-owner"),
      taskId,
      token: ClaimToken.make("other-owner-cleared-token")
    })
    const records = recordsFrom([
      ...(prefixRows[0] ?? []),
      {
        event: TaskClaimAcquisitionRejectedEvent.make({
          observed: foreignClaim,
          operationId: claimOperation.acquisition.operationId,
          reason: "ForeignClaim",
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(claimOperation.acquisition.operationId)
      },
      {
        event: TaskClaimAcquisitionIntendedEvent.make({
          operation: nextOperation,
          version: workflowJournalEventVersion
        }),
        key: intentRecordKey(nextOperation.acquisition.operationId)
      }
    ])

    const nextProjection = projectFreshTaskAdmission(runId, records)
    if (nextProjection._tag === "FreshTaskAdmissionProjectionInvalid") {
      return expect.fail(nextProjection.issues.join("; "))
    }
    const nextCommitment = nextProjection.commitments.find(
      ({ commitment }) => commitment.operation.acquisition.operationId === nextOperation.acquisition.operationId
    )?.commitment
    if (nextCommitment === undefined) return expect.fail("next claim intent did not project a commitment")
    expect(nextCommitment.runId).toBe(runId)
    expect(projectFreshTaskAdmission(runId, records)).toMatchObject({ _tag: "FreshTaskAdmissionProjection" })
  })

  it("does not create handoff release authority from a replayed mismatched record envelope", () => {
    const records = [...recordsFrom(prefixRows.flat())]
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
    const responsibilityIndex = records.findIndex(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
    )
    if (responsibilityIndex < 0) return expect.fail("missing responsibility record")

    // The reducer cache represents the accepted immutable prefix. Replacing
    // the row afterwards models a hostile replay envelope and exercises the
    // projector's fail-safe branch: no exact handoff may be released.
    const replayed = records[responsibilityIndex]
    if (replayed === undefined) return expect.fail("missing responsibility row")
    records[responsibilityIndex] = { ...replayed, runId: RunId.make("fresh-admission-replayed-run") }

    const projection = projectFreshTaskAdmission(runId, records)
    expect(projection).toMatchObject({ _tag: "FreshTaskAdmissionProjection" })
    if (projection._tag !== "FreshTaskAdmissionProjection") return
    expect(projection.releaseEvidence).toEqual([])
    expect(projection.commitments).toHaveLength(1)
  })

  it("rejects an unmatched handoff when a replay hides its exact claim intent", () => {
    const records = [...recordsFrom(prefixRows.flat())]
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
    const claimIntentIndex = records.findIndex(({ event }) => event._tag === "TaskClaimAcquisitionIntended")
    if (claimIntentIndex < 0) return expect.fail("missing claim intent record")
    const claimIntent = records[claimIntentIndex]
    if (claimIntent?.event._tag !== "TaskClaimAcquisitionIntended") {
      return expect.fail("claim intent record has the wrong event")
    }

    let authorityReads = 0
    const operation = claimIntent.event.operation
    const authority = new Proxy(operation.authority, {
      get(target, property, receiver) {
        if (property === "_tag") {
          authorityReads += 1
          return authorityReads === 1 ? Reflect.get(target, property, receiver) : "ReplayedForeignAuthority"
        }
        return Reflect.get(target, property, receiver)
      }
    })
    const proxiedOperation = new Proxy(operation, {
      get(target, property, receiver) {
        return property === "authority" ? authority : Reflect.get(target, property, receiver)
      }
    })
    const proxiedEvent = new Proxy(claimIntent.event, {
      get(target, property, receiver) {
        return property === "operation" ? proxiedOperation : Reflect.get(target, property, receiver)
      }
    })
    records[claimIntentIndex] = { ...claimIntent, event: proxiedEvent }

    const projection = projectFreshTaskAdmission(runId, records)
    expect(projection).toMatchObject({
      _tag: "FreshTaskAdmissionProjectionInvalid",
      issues: [expect.stringContaining("unmatched release key")]
    })
  })

  it("does not mint a commitment when a replayed claim authority changes after filtering", () => {
    const records = [...recordsFrom(prefixRows[0] ?? [])]
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
    const claimIntent = records[1]
    if (claimIntent?.event._tag !== "TaskClaimAcquisitionIntended") {
      return expect.fail("missing claim intent record")
    }

    let authorityReads = 0
    const operation = claimIntent.event.operation
    const authority = new Proxy(operation.authority, {
      get(target, property, receiver) {
        if (property === "_tag") {
          authorityReads += 1
          return authorityReads === 1 ? Reflect.get(target, property, receiver) : "ReplayedForeignAuthority"
        }
        return Reflect.get(target, property, receiver)
      }
    })
    const proxiedOperation = new Proxy(operation, {
      get(target, property, receiver) {
        return property === "authority" ? authority : Reflect.get(target, property, receiver)
      }
    })
    const proxiedEvent = new Proxy(claimIntent.event, {
      get(target, property, receiver) {
        return property === "operation" ? proxiedOperation : Reflect.get(target, property, receiver)
      }
    })
    records[1] = { ...claimIntent, event: proxiedEvent }

    const projection = projectFreshTaskAdmission(runId, records)
    expect(projection).toMatchObject({ _tag: "FreshTaskAdmissionProjection", commitments: [] })
  })
})
