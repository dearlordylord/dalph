import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Effect, Exit, Layer, Option, Result } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../../../test/task-dag.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import {
  makeFreshTaskAdmissionBasis,
  TaskAdmissionOccupancy,
  projectFreshTaskAdmission,
  type FreshTaskAdmissionProjection
} from "../admission/fresh-task-admission.js"
import {
  makeFreshTaskAdmissionProjectionForTest,
  makeFreshTaskCommitmentForTest
} from "../../../test/support/fresh-task-admission.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import {
  authorizeFreshContinuationProposal,
  DeliveryProposalId,
  freshContinuationDecisionsOf,
  trackerGraphReadProposalOf,
  type FreshContinuationDecision
} from "./delivery-proposal.js"
import type { TaskWorkPositionRequirement } from "./delivery-action-proposal.js"
import { makeDeliveryRuntimeAdmissionController as makeAdmissionControllerWithLifecycle } from "./delivery-runtime-admission.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskLifecycle } from "../../authorities/task-tracker/task.js"
import { taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim, TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { OperationId } from "../../workflow/identity.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { AttemptChoiceRequestId } from "../../workflow/protocols/attempt-choice/events.js"
import {
  deliveryProposalsOf,
  deliveryProposalOfAcceptedFreshTask,
  type AcceptedFreshTaskDeliveryProposal
} from "./delivery-proposal-derivation.js"
import { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { makeFreshTaskCandidateFrontierForTest } from "../../../test/support/fresh-task-candidate.js"
import type { FreshTaskCandidateFrontier } from "./fresh-task-candidate.js"
import {
  PlannedAttemptProtocolController,
  plannedAttemptProtocolControllerLayer
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { beginPlannedAttemptExecutorResponsibility } from "../../workflow/protocols/planned-attempt-executor-work/responsibility.js"

const makeDeliveryRuntimeAdmissionController = Effect.fn("DeliveryRuntimeAdmissionTest.make")(function* (
  initial: Parameters<typeof makeAdmissionControllerWithLifecycle>[0],
  integrationTargets: Parameters<typeof makeAdmissionControllerWithLifecycle>[1]
) {
  const controller = yield* makeAdmissionControllerWithLifecycle(
    initial,
    integrationTargets,
    (yield* makeApplicationExitLifecycle()).admission
  )
  let acceptedFrontier: FreshTaskCandidateFrontier | null = null
  return {
    ...controller,
    tryReserveFresh: (
      frontier: FreshTaskCandidateFrontier,
      materialize: Parameters<typeof controller.tryReserveFresh>[1]
    ) => {
      const synchronize =
        acceptedFrontier === frontier
          ? Effect.void
          : controller.snapshot.pipe(
              Effect.flatMap(({ acceptedBasis }) => controller.synchronize(acceptedBasis, frontier)),
              Effect.tap(() => Effect.sync(() => (acceptedFrontier = frontier)))
            )
      return synchronize.pipe(Effect.andThen(controller.tryReserveFresh(frontier, materialize)))
    }
  }
})

const withProtocolController = <A, E>(
  effect: Effect.Effect<A, E, PlannedAttemptProtocolController>
): Effect.Effect<A, E> => effect.pipe(Effect.provide(Layer.fresh(plannedAttemptProtocolControllerLayer)))

const runId = RunId.make("admission-test-run")
const taskId = TaskId.make("A")
const correlation = { attemptId: AttemptId.make("attempt:A:0"), runId }
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: correlation.attemptId,
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-A-0"),
  executor: TaskExecutorLocator.make("executor:admission-test"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("admission-test-F1"),
  worktree: WorktreeLocator.make("/worktrees/attempt-A-0")
})

const admissionBasis = (
  capacity: number,
  heldAttempts: ReadonlyArray<typeof PlannedTaskAttempt.Type> = [],
  projection?: FreshTaskAdmissionProjection,
  acceptedAt: JournalPosition | null = null,
  basisRunId: RunId = runId
) =>
  Effect.runSync(
    makeFreshTaskAdmissionBasis({
      acceptedAt: projection?.acceptedAt ?? acceptedAt,
      capacity: TaskWorkCapacity.make(capacity),
      entries: heldAttempts.map((attempt) => TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: attempt })),
      ...(projection === undefined ? {} : { projection }),
      runId: basisRunId
    })
  )

it.effect("does not expose mutable controller authority through its descriptive snapshot", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1, [plannedAttempt]),
        yield* makeIntegrationTargetResourceController()
      )
      const snapshot = yield* admission.snapshot
      const position = snapshot.positions.get(taskId)
      if (position === undefined || position._tag !== "ExactAttemptHeld") {
        return yield* Effect.die("missing held position")
      }

      expect(() => {
        ;(position.plannedAttempt as { taskId: TaskId }).taskId = TaskId.make("B")
      }).toThrow()
      expect(() => {
        ;(snapshot.acceptedBasis as { capacity: TaskWorkCapacity }).capacity = TaskWorkCapacity.make(2)
      }).toThrow()
      ;(snapshot.positions as Map<TaskId, unknown>).clear()

      const current = yield* admission.snapshot
      expect(current.capacity).toBe(1)
      expect(current.positions.get(taskId)).toMatchObject({ _tag: "ExactAttemptHeld", plannedAttempt: { taskId } })
    })
  )
)

const plannedAttemptFor = (exactTaskId: TaskId, exactCorrelation: typeof correlation, suffix: string) =>
  PlannedTaskAttempt.make({
    ...plannedAttempt,
    attemptId: exactCorrelation.attemptId,
    branch: TaskBranchRef.make(`refs/heads/dalph/${suffix}`),
    runId: exactCorrelation.runId,
    taskId: exactTaskId,
    worktree: WorktreeLocator.make(`/worktrees/${suffix}`)
  })

const taskAProjection = makeFreshTaskAdmissionProjectionForTest(
  taskId,
  OperationId.make("admission-test-claim-A"),
  runId
)
const taskACommitment = Option.getOrThrow(Option.fromUndefinedOr(taskAProjection.commitments[0]?.commitment))

/** Canonical accepted lineage used to exercise exact claim-to-attempt handoff authority. */
const exactHandoffFixture = (() => {
  const target = FixtureTarget.make("admission-test-exact-handoff")
  const graph = validSnapshot({
    revision: "admission-test-exact-handoff-graph",
    tasks: [{ id: taskId, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const graphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("admission-test-exact-handoff-graph"),
    target,
    [taskACommitment.operation.acquisition.operationId],
    [taskId]
  )
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("admission-test-exact-handoff-specification"),
    target,
    taskId,
    [graphOperation.operationId]
  )
  const specification = makeTaskWorkSpecification({
    body: "admission exact handoff",
    taskId,
    title: "Admission exact handoff"
  })
  const attempt = PlannedTaskAttempt.make({
    ...plannedAttempt,
    attemptId: AttemptId.make("attempt:A:exact-handoff"),
    branch: TaskBranchRef.make("refs/heads/dalph/attempt-A-exact-handoff"),
    taskRevision: TaskRevision.make(specification.fingerprint),
    worktree: WorktreeLocator.make("/worktrees/attempt-A-exact-handoff")
  })
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("admission-test-exact-handoff-plan"),
    plannedAttempt: attempt,
    predecessorOperationIds: [specificationOperation.operationId]
  })
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("admission-test-exact-handoff-worktree"),
    plannedAttempt: attempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  const worktreeProof = PlannedWorktreeReady.make({
    baseSha: attempt.baseSha,
    branch: attempt.branch,
    headSha: attempt.baseSha,
    worktree: attempt.worktree
  })
  const record = (event: JournalRecord["event"], key: JournalRecord["key"], position: number): JournalRecord => ({
    event,
    key,
    position: JournalPosition.make(position),
    runId
  })
  const records: ReadonlyArray<JournalRecord> = [
    makeWorkflowRunBeganRecord(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    ),
    record(
      TaskClaimAcquisitionIntendedEvent.make({
        operation: taskACommitment.operation,
        version: workflowJournalEventVersion
      }),
      intentRecordKey(taskACommitment.operation.acquisition.operationId),
      2
    ),
    record(
      TaskClaimAcquiredEvent.make({
        claim: ActiveTaskClaim.make(taskACommitment.operation.acquisition),
        version: workflowJournalEventVersion
      }),
      outcomeRecordKey(taskACommitment.operation.acquisition.operationId),
      3
    ),
    record(taskTrackerReadIntent(graphOperation), intentRecordKey(graphOperation.operationId), 4),
    record(
      taskTrackerFactsObservedEvent(
        graphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(graphOperation, graph)
      ),
      outcomeRecordKey(graphOperation.operationId),
      5
    ),
    record(taskTrackerReadIntent(specificationOperation), intentRecordKey(specificationOperation.operationId), 6),
    record(
      taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      ),
      outcomeRecordKey(specificationOperation.operationId),
      7
    ),
    record(
      TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }),
      attemptPlanRecordKey(attempt.attemptId),
      8
    ),
    record(
      TaskWorktreeReconciliationIntendedEvent.make({
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      }),
      intentRecordKey(worktreeOperation.operationId),
      9
    ),
    record(
      TaskWorktreeReadyEvent.make({
        operationId: worktreeOperation.operationId,
        proof: worktreeProof,
        version: workflowJournalEventVersion
      }),
      outcomeRecordKey(worktreeOperation.operationId),
      10
    ),
    record(
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      }),
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(attempt.attemptId),
      11
    )
  ]
  const projection = projectFreshTaskAdmission(runId, records)
  if (projection._tag !== "FreshTaskAdmissionProjection") {
    return Effect.runSync(Effect.die(`exact handoff fixture is invalid: ${projection.issues.join("; ")}`))
  }
  return { attempt, claimOperationId: taskACommitment.operation.acquisition.operationId, projection, records }
})()

const responsibilityAcceptedAt = JournalPosition.make(Number(taskAProjection.acceptedAt) + 2)
const acceptedResponsibility = Effect.runSync(
  beginPlannedAttemptExecutorResponsibility(plannedAttempt).pipe(
    Effect.provideService(
      InRunJournal,
      InRunJournal.of({
        append: (acceptedRunId, key, event) =>
          Effect.succeed({ event, key, position: responsibilityAcceptedAt, runId: acceptedRunId }),
        read: () => Effect.succeed([])
      })
    )
  )
)

const commitmentBasis = (capacity: number) =>
  Effect.runSync(
    makeFreshTaskAdmissionBasis({
      acceptedAt: taskAProjection.acceptedAt,
      capacity: TaskWorkCapacity.make(capacity),
      entries: [],
      projection: taskAProjection,
      runId
    })
  )

const exactRejectionProjection = (claimOperationId: OperationId): FreshTaskAdmissionProjection => {
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition: TaskClaimAcquisition.make({
      operationId: claimOperationId,
      owner: ClaimOwner.make(`dalph:admission-test:${claimOperationId}`),
      taskId,
      token: ClaimToken.make(`admission-test-token:${claimOperationId}`)
    }),
    predecessorOperationIds: []
  })
  const foreignClaim = ActiveTaskClaim.make({
    operationId: OperationId.make(`foreign:${claimOperationId}`),
    owner: ClaimOwner.make("foreign:admission-test"),
    taskId,
    token: ClaimToken.make(`foreign-token:${claimOperationId}`)
  })
  const records: ReadonlyArray<JournalRecord> = [
    {
      ...makeWorkflowRunBeganRecord(
        runId,
        FixtureTarget.make("admission-release-projection"),
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      ),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
      key: intentRecordKey(claimOperationId),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: TaskClaimAcquisitionRejectedEvent.make({
        observed: foreignClaim,
        operationId: claimOperationId,
        reason: "ForeignClaim",
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(claimOperationId),
      position: JournalPosition.make(3),
      runId
    }
  ]
  const projection = projectFreshTaskAdmission(runId, records)
  if (projection._tag !== "FreshTaskAdmissionProjection") {
    return Effect.runSync(Effect.die(`rejection projection is invalid: ${projection.issues.join("; ")}`))
  }
  return projection
}

const freshEntryDecision = (id: string, revision: string) => {
  const freshTaskId = TaskId.make(id)
  const task = {
    id: freshTaskId,
    lifecycle: TaskLifecycle.cases.Open.make({}),
    parentTaskId: null,
    prerequisiteIds: revision.endsWith("r2") ? [TaskId.make(`${id}-prerequisite`)] : []
  }
  return {
    step: FreshWorkflowStep.AcquireTaskClaim({ predecessorOperationId: OperationId.make(`current-graph:${id}`), task }),
    transition: RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: freshTaskId,
      taskRevision: taskRevisionFor(task)
    })
  }
}

const freshGraphEntryDecision = (id: string, revision: string) => {
  const freshTaskId = TaskId.make(id)
  const task = {
    id: freshTaskId,
    lifecycle: TaskLifecycle.cases.Open.make({}),
    parentTaskId: null,
    prerequisiteIds: revision.endsWith("r2") ? [TaskId.make(`${id}-prerequisite`)] : []
  }
  const predecessorOperationId = OperationId.make(`current-graph:${id}:${revision}`)
  return {
    step: FreshWorkflowStep.ReadCurrentTaskGraph({ predecessorOperationId, task }),
    transition: RunnableFrontierTransition.ContinueFreshWorkflowOperation({
      operationId: predecessorOperationId,
      taskId: freshTaskId
    })
  }
}

it.effect("executor start reserves an exact planned-attempt position", () =>
  withProtocolController(
    Effect.gen(function* () {
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const admission = yield* makeDeliveryRuntimeAdmissionController(admissionBasis(1), integrationTargets)
      const proposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("admission-target")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("reserve-A")
      }
      const start = {
        ...proposal,
        admission: {
          ...proposal.admission,
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("start-A")
      }
      expect((yield* admission.tryReserve(start))._tag).toBe("Admitted")
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "BoundRuntimePosition",
        correlation
      })
    })
  )
)

it.effect("does not let uncorrelated replacement work reuse the exact retained attempt position", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(2, [plannedAttempt]),
        yield* makeIntegrationTargetResourceController()
      )
      const replacementTask = {
        id: taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
      const replacementAttempt = PlannedTaskAttempt.make({
        ...plannedAttempt,
        attemptId: AttemptId.make("replacement-A-F2"),
        branch: TaskBranchRef.make("refs/heads/dalph/replacement-A-F2"),
        worktree: WorktreeLocator.make("/worktrees/replacement-A-F2")
      })
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({
        plannedAttempt: replacementAttempt
      })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: taskACommitment.operation.acquisition.operationId,
        plannedAttempt: replacementAttempt,
        specification: makeTaskWorkSpecification({ body: "replacement", taskId, title: "replacement" }),
        task: replacementTask
      })
      const replacement = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [taskACommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (replacement === undefined) return yield* Effect.die("fresh replacement proposal was not derived")

      expect(yield* admission.tryReserve(replacement)).toEqual({
        _tag: "Deferred",
        reason: "TaskWorkPositionUnavailable"
      })
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual({ _tag: "ExactAttemptHeld", plannedAttempt })
    })
  )
)

it.effect("keeps proof-based Stop behind an already admitted continuation until its command can be recorded", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const continuationTransition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
        plannedAttempt
      })
      const stopTransition = RunnableFrontierTransition.AdvanceAttemptStoppage({
        requestId: AttemptChoiceRequestId.make({ nonce: "proof-based-stop", runId }),
        subject: { observedTaskRevision: TaskRevision.make("admission-test-F2"), plannedAttempt },
        taskWorkPosition: "None"
      })
      const proposals = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: [],
        runId,
        transitions: [continuationTransition, stopTransition]
      })
      expect(proposals.issues).toEqual([])
      const [continuation, stop] = proposals.ticketDelivery
      if (continuation === undefined || stop === undefined) return yield* Effect.die("missing production proposals")
      expect(continuation.admission).toMatchObject({
        plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired", correlation },
        taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse" }
      })
      expect(stop.admission).toMatchObject({
        plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired", correlation },
        taskWorkPosition: { _tag: "NoTaskWorkPosition" }
      })
      const held = yield* admission.tryReserve(continuation)
      if (held._tag !== "Admitted") return yield* Effect.die("continuation was not admitted")

      expect(yield* admission.tryReserve(stop)).toMatchObject({
        _tag: "Deferred",
        reason: "PlannedAttemptProtocolUnavailable"
      })

      yield* admission.complete(held.reservation)
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "BoundRuntimePosition",
        correlation
      })
      expect((yield* admission.tryReserve(stop))._tag).toBe("Admitted")
    })
  )
)

it.effect("a proposal without accepted fresh-task capability cannot retain a temporary task-work position", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const proposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("admission-target")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("claim-A")
      }
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("claim reservation was unexpectedly deferred")

      yield* admission.complete(admitted.reservation)

      expect((yield* admission.snapshot).positions.get(taskId)).toBeUndefined()
    })
  )
)

it.effect("materializes proposals for A through C only after their atomic fresh admission", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(3),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: ["A", "B", "C", "D", "E"].map((id) => freshEntryDecision(id, `${id}-r1`)),
        runId
      })
      const materialized: Array<string> = []
      const serializedFrontier = { ...frontier } as typeof frontier
      let serializedMaterialized = false
      expect(
        yield* admission.tryReserveFresh(serializedFrontier, (accepted) => {
          serializedMaterialized = true
          return deliveryProposalOfAcceptedFreshTask(accepted)
        })
      ).toEqual({ _tag: "Deferred", reason: "TaskWorkPositionUnavailable" })
      expect(serializedMaterialized).toBe(false)
      expect((yield* admission.snapshot).positions.size).toBe(0)
      const results = []
      for (const _candidate of frontier.candidates) {
        results.push(
          yield* admission.tryReserveFresh(frontier, (accepted) => {
            materialized.push(accepted.candidate.taskId)
            return deliveryProposalOfAcceptedFreshTask(accepted)
          })
        )
      }

      expect(results.map(({ _tag }) => _tag)).toEqual(["Admitted", "Admitted", "Admitted", "Deferred", "Deferred"])
      expect(materialized).toEqual(["A", "B", "C"])
      for (const result of results) {
        if (result._tag === "Admitted") {
          yield* admission.bindFreshTaskClaimOperation(
            result.reservation,
            OperationId.make(`materialized-claim:${result.reservation.freshTaskCandidate?.taskId}`)
          )
          yield* admission.complete(result.reservation)
        }
      }
      expect((yield* admission.snapshot).positions.size).toBe(3)
    })
  )
)

it.effect("refuses an older genuine frontier after a newer coherent frontier is accepted", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeAdmissionControllerWithLifecycle(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController(),
        (yield* makeApplicationExitLifecycle()).admission
      )
      const older = makeFreshTaskCandidateFrontierForTest({ decisions: [freshGraphEntryDecision("A", "A-r1")], runId })
      const newer = makeFreshTaskCandidateFrontierForTest({ decisions: [freshGraphEntryDecision("A", "A-r2")], runId })
      yield* admission.synchronize(admissionBasis(1), older)
      yield* admission.synchronize(admissionBasis(1), newer)

      expect(yield* admission.tryReserveFresh(older, deliveryProposalOfAcceptedFreshTask)).toEqual({
        _tag: "Deferred",
        reason: "TaskWorkPositionUnavailable"
      })
      const admitted = yield* admission.tryReserveFresh(newer, deliveryProposalOfAcceptedFreshTask)
      expect(admitted._tag).toBe("Admitted")
      if (admitted._tag === "Admitted") {
        yield* admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")
      }
    })
  )
)

it.effect("rejects an older admission basis without regressing accepted occupancy", () =>
  withProtocolController(
    Effect.gen(function* () {
      const newer = admissionBasis(2, [], undefined, JournalPosition.make(2))
      const admission = yield* makeAdmissionControllerWithLifecycle(
        newer,
        yield* makeIntegrationTargetResourceController(),
        (yield* makeApplicationExitLifecycle()).admission
      )
      const older = admissionBasis(1, [], undefined, JournalPosition.make(1))

      expect(Exit.isFailure(yield* Effect.exit(admission.synchronize(older)))).toBe(true)
      expect((yield* admission.snapshot).acceptedBasis).toBe(newer)
      expect((yield* admission.snapshot).capacity).toBe(2)
    })
  )
)

it.effect("rejects a genuine other-Run basis and frontier even at the same accepted position", () =>
  withProtocolController(
    Effect.gen(function* () {
      const accepted = admissionBasis(1)
      const admission = yield* makeAdmissionControllerWithLifecycle(
        accepted,
        yield* makeIntegrationTargetResourceController(),
        (yield* makeApplicationExitLifecycle()).admission
      )
      const otherRunId = RunId.make("admission-test-other-run")
      const otherBasis = admissionBasis(1, [], undefined, null, otherRunId)
      const otherFrontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshEntryDecision("A", "A-r1")],
        runId: otherRunId
      })

      expect(Exit.isFailure(yield* Effect.exit(admission.synchronize(otherBasis)))).toBe(true)
      expect(Exit.isFailure(yield* Effect.exit(admission.synchronize(accepted, otherFrontier)))).toBe(true)
      expect((yield* admission.tryReserveFresh(otherFrontier, deliveryProposalOfAcceptedFreshTask))._tag).toBe(
        "Deferred"
      )
      expect((yield* admission.snapshot).acceptedBasis).toBe(accepted)
      expect((yield* admission.snapshot).positions.size).toBe(0)
    })
  )
)

it.effect("releases and settles only the exact bound claim-operation cycle", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeAdmissionControllerWithLifecycle(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController(),
        (yield* makeApplicationExitLifecycle()).admission
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({ decisions: [freshEntryDecision("A", "A-r1")], runId })
      yield* admission.synchronize(admissionBasis(1), frontier)
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("claim candidate was not admitted")
      const firstClaimOperationId = OperationId.make("claim:A:bound-cycle-1")
      yield* admission.bindFreshTaskClaimOperation(admitted.reservation, firstClaimOperationId)
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            admission.bindFreshTaskClaimOperation(admitted.reservation, OperationId.make("claim:A:forged-second-bind"))
          )
        )
      ).toBe(true)
      yield* admission.rollback(admitted.reservation, "AfterDurableClaimIntentOrAmbiguity")

      const staleRejection = exactRejectionProjection(OperationId.make("claim:A:stale-cycle"))
      yield* admission.synchronize(
        admissionBasis(1, [], staleRejection),
        makeFreshTaskCandidateFrontierForTest({ acceptedAt: staleRejection.acceptedAt, decisions: [], runId })
      )
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)

      const firstRejection = exactRejectionProjection(firstClaimOperationId)
      yield* admission.synchronize(
        admissionBasis(1, [], firstRejection),
        makeFreshTaskCandidateFrontierForTest({ acceptedAt: firstRejection.acceptedAt, decisions: [], runId })
      )
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(false)

      const rejectedBasis = admissionBasis(1, [], firstRejection)
      const rejectedFrontier = makeFreshTaskCandidateFrontierForTest({
        acceptedAt: firstRejection.acceptedAt,
        decisions: [freshEntryDecision("A", "A-r1")],
        runId
      })
      yield* admission.synchronize(rejectedBasis, rejectedFrontier)
      const next = yield* admission.tryReserveFresh(rejectedFrontier, deliveryProposalOfAcceptedFreshTask)
      if (next._tag !== "Admitted") return yield* Effect.die("next claim cycle was not admitted")
      yield* admission.bindFreshTaskClaimOperation(next.reservation, OperationId.make("claim:A:bound-cycle-2"))
      yield* admission.rollback(next.reservation, "AfterDurableClaimIntentOrAmbiguity")
      yield* admission.synchronize(
        rejectedBasis,
        makeFreshTaskCandidateFrontierForTest({ acceptedAt: firstRejection.acceptedAt, decisions: [], runId })
      )
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)
    })
  )
)

it.effect("restores only the exact process reservation when the first bound intent was conclusively absent", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({ decisions: [freshEntryDecision("A", "A-r1")], runId })
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("claim candidate was not admitted")
      yield* admission.bindFreshTaskClaimOperation(admitted.reservation, OperationId.make("claim:A:not-appended"))
      yield* admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")

      expect((yield* admission.snapshot).positions.has(taskId)).toBe(false)
      expect(
        Exit.isFailure(yield* Effect.exit(admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")))
      ).toBe(true)
    })
  )
)

it.effect("retains all holders across contraction and admits only after occupancy falls below the new capacity", () =>
  withProtocolController(
    Effect.gen(function* () {
      const attempts = ["A", "B", "C"].map((id) => {
        const exactCorrelation = { attemptId: AttemptId.make(`attempt:contraction:${id}`), runId }
        return plannedAttemptFor(TaskId.make(`contraction-${id}`), exactCorrelation, `contraction-${id}`)
      })
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(3, attempts),
        yield* makeIntegrationTargetResourceController()
      )
      yield* admission.synchronize(admissionBasis(2, attempts))
      expect((yield* admission.snapshot).positions.size).toBe(3)
      const [firstAttempt, secondAttempt] = attempts
      if (firstAttempt === undefined || secondAttempt === undefined) return yield* Effect.die("missing attempts")
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshEntryDecision("contraction-D", "D-r1")],
        runId
      })
      const candidate = frontier.candidates[0]
      if (candidate === undefined) return yield* Effect.die("missing contraction candidate")

      expect((yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask))._tag).toBe("Deferred")
      yield* admission.releasePlannedAttemptPosition(plannedAttemptExecutorCorrelation(firstAttempt))
      expect((yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask))._tag).toBe("Deferred")
      yield* admission.releasePlannedAttemptPosition(plannedAttemptExecutorCorrelation(secondAttempt))
      expect((yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask))._tag).toBe("Admitted")
    })
  )
)

it.effect("admits exactly the next two candidates after capacity expands from one to three", () =>
  withProtocolController(
    Effect.gen(function* () {
      const held = plannedAttemptFor(
        TaskId.make("expansion-A"),
        { attemptId: AttemptId.make("attempt:expansion:A"), runId },
        "expansion-A"
      )
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1, [held]),
        yield* makeIntegrationTargetResourceController()
      )
      yield* admission.synchronize(admissionBasis(3, [held]))
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: ["B", "C", "D"].map((id) => freshEntryDecision(`expansion-${id}`, `${id}-r1`)),
        runId
      })
      const results = []
      for (const _candidate of frontier.candidates) {
        results.push(yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask))
      }

      expect(results.map(({ _tag }) => _tag)).toEqual(["Admitted", "Admitted", "Deferred"])
      expect((yield* admission.snapshot).positions.size).toBe(3)
    })
  )
)

it.effect("does not reuse a fresh admission after the candidate task revision changes", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const first = makeFreshTaskCandidateFrontierForTest({ decisions: [freshEntryDecision("A", "A-r1")], runId })
      const changed = makeFreshTaskCandidateFrontierForTest({ decisions: [freshEntryDecision("A", "A-r2")], runId })
      const firstCandidate = first.candidates[0]
      const changedCandidate = changed.candidates[0]
      if (firstCandidate === undefined || changedCandidate === undefined) return yield* Effect.die("missing candidate")
      const admitted = yield* admission.tryReserveFresh(first, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("first candidate was not admitted")
      yield* admission.bindFreshTaskClaimOperation(admitted.reservation, OperationId.make("materialized-claim:A:r1"))
      yield* admission.complete(admitted.reservation)

      expect(yield* admission.tryReserveFresh(changed, deliveryProposalOfAcceptedFreshTask)).toEqual({
        _tag: "Deferred",
        reason: "TaskWorkPositionUnavailable"
      })
    })
  )
)

it.effect("reconstructs a commitment at capacity and lets only that task continue", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const other = makeFreshTaskCandidateFrontierForTest({
        acceptedAt: taskAProjection.acceptedAt,
        decisions: [freshEntryDecision("B", "B-r1")],
        runId
      })
      const otherCandidate = other.candidates[0]
      if (otherCandidate === undefined) return yield* Effect.die("missing B candidate")
      expect(yield* admission.tryReserveFresh(other, deliveryProposalOfAcceptedFreshTask)).toEqual({
        _tag: "Deferred",
        reason: "TaskWorkPositionUnavailable"
      })

      const unrelated = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("admission-commitment-unrelated")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("unrelated-use-of-committed-A")
      }
      expect(yield* admission.tryReserve(unrelated)).toEqual({
        _tag: "Deferred",
        reason: "TaskWorkPositionUnavailable"
      })

      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const step = FreshWorkflowStep.ReadPostClaimGraph({
        claimOperation: taskACommitment.operation,
        predecessorOperationId: taskACommitment.operation.acquisition.operationId,
        task
      })
      const transition = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: step.predecessorOperationId,
        taskId
      })
      const continuation = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [taskACommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (continuation === undefined) return yield* Effect.die("committed A continuation was not derived")
      const continued = yield* admission.tryReserve(continuation)
      expect(continued._tag).toBe("Admitted")
      if (continued._tag === "Admitted") yield* admission.complete(continued.reservation)
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.FreshTaskCommitted({ commitment: taskACommitment })
      )
    })
  )
)

it.effect("replaces an idle pre-intent revision but never a live one", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const oldFrontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshGraphEntryDecision("A", "A-r1")],
        runId
      })
      const changedFrontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshGraphEntryDecision("A", "A-r2")],
        runId
      })
      const oldCandidate = oldFrontier.candidates[0]
      const changedCandidate = changedFrontier.candidates[0]
      if (oldCandidate === undefined || changedCandidate === undefined) return yield* Effect.die("missing candidate")
      const active = yield* admission.tryReserveFresh(oldFrontier, deliveryProposalOfAcceptedFreshTask)
      if (active._tag !== "Admitted") return yield* Effect.die("old graph candidate was not admitted")

      expect((yield* admission.tryReserveFresh(oldFrontier, deliveryProposalOfAcceptedFreshTask))._tag).toBe("Deferred")
      expect((yield* admission.tryReserveFresh(changedFrontier, deliveryProposalOfAcceptedFreshTask))._tag).toBe(
        "Deferred"
      )

      yield* admission.complete(active.reservation)
      const replaced = yield* admission.tryReserveFresh(changedFrontier, deliveryProposalOfAcceptedFreshTask)
      expect(replaced._tag).toBe("Admitted")
      if (replaced._tag === "Admitted") yield* admission.complete(replaced.reservation)
    })
  )
)

it.effect("retires an idle pre-intent entry only after a complete frontier omits it", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshGraphEntryDecision("A", "A-r1")],
        runId
      })
      const actionlessButStillEntryCapable = frontier
      const emptyFrontier = makeFreshTaskCandidateFrontierForTest({ decisions: [], runId })
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("graph candidate was not admitted")
      yield* admission.complete(admitted.reservation)

      yield* admission.synchronize(admissionBasis(1))
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)

      yield* admission.synchronize(admissionBasis(1), actionlessButStillEntryCapable)
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)

      yield* admission.synchronize(admissionBasis(1), { ...emptyFrontier } as typeof emptyFrontier)
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)

      yield* admission.synchronize(admissionBasis(1), emptyFrontier)
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(false)
    })
  )
)

it.effect("retains a durable fresh commitment when complete current eligibility excludes its task", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const stillEntryCapable = makeFreshTaskCandidateFrontierForTest({
        acceptedAt: taskAProjection.acceptedAt,
        decisions: [freshEntryDecision("A", "A-r1")],
        runId
      })
      const noLongerEntryCapable = makeFreshTaskCandidateFrontierForTest({
        acceptedAt: taskAProjection.acceptedAt,
        decisions: [],
        runId
      })

      yield* admission.synchronize(commitmentBasis(1))
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)

      yield* admission.synchronize(commitmentBasis(1), stillEntryCapable)
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)

      yield* admission.synchronize(commitmentBasis(1), noLongerEntryCapable)
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)
    })
  )
)

it.effect("retains an awaiting durable commitment when complete current eligibility excludes its task", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({ decisions: [freshEntryDecision("A", "A-r1")], runId })
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("claim candidate was not admitted")
      yield* admission.bindFreshTaskClaimOperation(admitted.reservation, OperationId.make("awaiting-claim:A"))
      yield* admission.rollback(admitted.reservation, "AfterDurableClaimIntentOrAmbiguity")

      yield* admission.synchronize(admissionBasis(1), makeFreshTaskCandidateFrontierForTest({ decisions: [], runId }))

      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)
    })
  )
)

it.effect("does not replace a commitment from a structurally supplied held attempt alone", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      expect(Exit.isFailure(yield* Effect.exit(admission.synchronize(admissionBasis(1, [plannedAttempt]))))).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.FreshTaskCommitted({ commitment: taskACommitment })
      )
    })
  )
)

it.effect("retains a locally accepted exact attempt through stale commitment synchronization", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: taskACommitment.operation.acquisition.operationId,
        plannedAttempt,
        specification: makeTaskWorkSpecification({ body: "handoff", taskId, title: "handoff" }),
        task
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [taskACommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("handoff proposal was not derived")
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("handoff proposal was not admitted")
      yield* admission.bindPlannedAttemptPosition(admitted.reservation, plannedAttempt, acceptedResponsibility)
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            admission.bindPlannedAttemptPosition(admitted.reservation, plannedAttempt, acceptedResponsibility)
          )
        )
      ).toBe(true)
      yield* admission.synchronize(commitmentBasis(1))
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual({
        _tag: "LocallyAcceptedAttemptPosition",
        handoff: { _tag: "FreshCommitmentHandoff", commitment: taskACommitment },
        plannedAttempt,
        responsibilityAcceptedAt
      })

      yield* admission.synchronize(admissionBasis(1, [plannedAttempt], undefined, responsibilityAcceptedAt))
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt })
      )
    })
  )
)

it.effect("releases a local handoff when a newer accepted basis no longer requires its exact attempt", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: taskACommitment.operation.acquisition.operationId,
        plannedAttempt,
        specification: makeTaskWorkSpecification({ body: "handoff", taskId, title: "handoff" }),
        task
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [taskACommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("handoff proposal was not derived")
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("handoff proposal was not admitted")
      yield* admission.bindPlannedAttemptPosition(admitted.reservation, plannedAttempt, acceptedResponsibility)
      yield* admission.complete(admitted.reservation)

      yield* admission.synchronize(admissionBasis(1, [], undefined, taskAProjection.acceptedAt))
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "LocallyAcceptedAttemptPosition",
        plannedAttempt: { attemptId: plannedAttempt.attemptId, runId, taskId }
      })

      const delayedPrefixAt = JournalPosition.make(Number(taskAProjection.acceptedAt) + 1)
      yield* admission.synchronize(admissionBasis(1, [], undefined, delayedPrefixAt))
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)

      yield* admission.synchronize(admissionBasis(1, [], undefined, responsibilityAcceptedAt))
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)

      const releasedAt = JournalPosition.make(Number(responsibilityAcceptedAt) + 1)
      const taskBFrontier = makeFreshTaskCandidateFrontierForTest({
        acceptedAt: releasedAt,
        decisions: [freshEntryDecision("B", "B-r1")],
        runId
      })
      yield* admission.synchronize(admissionBasis(1, [], undefined, releasedAt), taskBFrontier)

      expect((yield* admission.snapshot).positions.has(taskId)).toBe(false)
      const taskB = yield* admission.tryReserveFresh(taskBFrontier, deliveryProposalOfAcceptedFreshTask)
      expect(taskB._tag).toBe("Admitted")
    })
  )
)

it.effect("rejects a hand-authored continuation even when its task has a live commitment", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: taskACommitment.operation.acquisition.operationId,
        plannedAttempt,
        specification: makeTaskWorkSpecification({ body: "untrusted", taskId, title: "untrusted" }),
        task
      })
      const authorized = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [taskACommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (authorized === undefined) return yield* Effect.die("authorized continuation proposal was not derived")

      // Spreading deliberately removes the non-enumerable private capability.
      const handAuthored = { ...authorized }
      const forgedDecision = {
        authority: { _tag: "FreshCommitmentAuthority", commitment: taskACommitment },
        step,
        transition
      } as FreshContinuationDecision
      const forgedProposal = authorizeFreshContinuationProposal(handAuthored, forgedDecision, runId)
      for (const untrusted of [handAuthored, forgedProposal]) {
        expect(yield* admission.tryReserve(untrusted)).toEqual({
          _tag: "Deferred",
          reason: "TaskWorkPositionUnavailable"
        })
      }
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.FreshTaskCommitted({ commitment: taskACommitment })
      )
    })
  )
)

it.effect("rejects the same task and claim OperationId when the commitment belongs to another Run", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const otherRunId = RunId.make("admission-test-other-run")
      const otherAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, runId: otherRunId })
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt: otherAttempt })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: taskACommitment.operation.acquisition.operationId,
        plannedAttempt: otherAttempt,
        specification: makeTaskWorkSpecification({ body: "other Run", taskId, title: "other Run" }),
        task
      })
      const otherRunCommitment = makeFreshTaskCommitmentForTest(
        taskId,
        taskACommitment.operation.acquisition.operationId,
        otherRunId
      )
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [otherRunCommitment])),
        runId: otherRunId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("other-Run continuation proposal was not derived")

      expect(yield* admission.tryReserve(proposal)).toEqual({ _tag: "Deferred", reason: "TaskWorkPositionUnavailable" })
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "FreshTaskCommitted",
        commitment: { runId }
      })
    })
  )
)

it.effect("rejects a handoff from a different claim operation while retaining the commitment", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: OperationId.make("different-claim-operation"),
        plannedAttempt,
        specification: makeTaskWorkSpecification({ body: "wrong lineage", taskId, title: "wrong lineage" }),
        task
      })
      const differentCommitment = makeFreshTaskCommitmentForTest(taskId, step.claimOperationId, runId)
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [differentCommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("handoff proposal was not derived")
      expect(yield* admission.tryReserve(proposal)).toEqual({ _tag: "Deferred", reason: "TaskWorkPositionUnavailable" })
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.FreshTaskCommitted({ commitment: taskACommitment })
      )
    })
  )
)

it.effect("rejects a mismatched exact handoff without replacing the reserved correlation", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const proposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("mismatched-attempt-handoff")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("mismatched-attempt-handoff")
      }
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("handoff proposal was not admitted")
      const otherCorrelation = { attemptId: AttemptId.make("attempt:A:other"), runId }
      const result = yield* Effect.exit(
        admission.bindPlannedAttemptPosition(
          admitted.reservation,
          plannedAttemptFor(taskId, otherCorrelation, "mismatched-attempt")
        )
      )

      expect(Exit.isFailure(result)).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "BoundRuntimePosition",
        correlation
      })
    })
  )
)

it.effect("rejects a same-Run foreign attempt without replacing the exact fresh commitment", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: taskACommitment.operation.acquisition.operationId,
        plannedAttempt,
        specification: makeTaskWorkSpecification({ body: "exact", taskId, title: "exact" }),
        task
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [taskACommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("handoff proposal was not derived")
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("handoff proposal was not admitted")
      const foreignAttempt = PlannedTaskAttempt.make({
        ...plannedAttempt,
        baseSha: GitCommitSha.make("2".repeat(40)),
        branch: TaskBranchRef.make("refs/heads/dalph/foreign-same-correlation"),
        worktree: WorktreeLocator.make("/worktrees/foreign-same-correlation")
      })

      expect(
        Exit.isFailure(yield* Effect.exit(admission.bindPlannedAttemptPosition(admitted.reservation, foreignAttempt)))
      ).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.FreshTaskCommitted({ commitment: taskACommitment })
      )
    })
  )
)

it.effect("rejects a structurally copied responsibility acceptance before replacing the fresh commitment", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: taskACommitment.operation.acquisition.operationId,
        plannedAttempt,
        specification: makeTaskWorkSpecification({ body: "copied", taskId, title: "copied" }),
        task
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [taskACommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("handoff proposal was not derived")
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("handoff proposal was not admitted")
      const copied = { acceptedAt: JournalPosition.make(Number(taskAProjection.acceptedAt) - 1), plannedAttempt }

      expect(
        Exit.isFailure(
          // @ts-expect-error A plain structural copy cannot carry the private accepted-responsibility capability.
          yield* Effect.exit(admission.bindPlannedAttemptPosition(admitted.reservation, plannedAttempt, copied))
        )
      ).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.FreshTaskCommitted({ commitment: taskACommitment })
      )
    })
  )
)

it.effect("rejects a conflicting accepted exact attempt without discarding the local handoff", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: taskACommitment.operation.acquisition.operationId,
        plannedAttempt,
        specification: makeTaskWorkSpecification({ body: "conflicting", taskId, title: "conflicting" }),
        task
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [taskACommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("handoff proposal was not derived")
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("handoff proposal was not admitted")
      yield* admission.bindPlannedAttemptPosition(admitted.reservation, plannedAttempt, acceptedResponsibility)
      const otherCorrelation = { attemptId: AttemptId.make("attempt:A:conflicting-accepted"), runId }
      const conflictingAttempt = plannedAttemptFor(taskId, otherCorrelation, "conflicting-accepted")
      const result = yield* Effect.exit(admission.synchronize(admissionBasis(1, [conflictingAttempt])))

      expect(Exit.isFailure(result)).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual({
        _tag: "LocallyAcceptedAttemptPosition",
        handoff: { _tag: "FreshCommitmentHandoff", commitment: taskACommitment },
        plannedAttempt,
        responsibilityAcceptedAt
      })
    })
  )
)

it.effect("releases a failed current-graph entry but retains an ambiguous claim-intent entry", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const task = {
        id: TaskId.make("A"),
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
      const predecessorOperationId = OperationId.make("candidate-current-graph:A")
      const beforeGraph = makeFreshTaskCandidateFrontierForTest({
        decisions: [
          {
            step: FreshWorkflowStep.ReadCurrentTaskGraph({ predecessorOperationId, task }),
            transition: RunnableFrontierTransition.ContinueFreshWorkflowOperation({
              operationId: predecessorOperationId,
              taskId: task.id
            })
          }
        ],
        runId
      })
      const graphCandidate = beforeGraph.candidates[0]
      if (graphCandidate === undefined) return yield* Effect.die("missing graph candidate")
      let graphProposal: AcceptedFreshTaskDeliveryProposal | undefined
      const graphReservation = yield* admission.tryReserveFresh(beforeGraph, (accepted) => {
        graphProposal = deliveryProposalOfAcceptedFreshTask(accepted)
        return graphProposal
      })
      if (graphReservation._tag !== "Admitted") return yield* Effect.die("graph candidate was not admitted")
      yield* admission.rollback(graphReservation.reservation, "BeforeDurableClaimIntent")
      expect((yield* admission.snapshot).positions.size).toBe(0)
      expect(yield* admission.tryReserve({ ...Option.getOrThrow(Option.fromUndefinedOr(graphProposal)) })).toEqual({
        _tag: "Deferred",
        reason: "TaskWorkPositionUnavailable"
      })

      const beforeClaim = makeFreshTaskCandidateFrontierForTest({
        decisions: [
          {
            step: FreshWorkflowStep.AcquireTaskClaim({ predecessorOperationId, task }),
            transition: RunnableFrontierTransition.CommitFreshTaskClaimIntent({
              taskId: task.id,
              taskRevision: taskRevisionFor(task)
            })
          }
        ],
        runId
      })
      const claimCandidate = beforeClaim.candidates[0]
      if (claimCandidate === undefined) return yield* Effect.die("missing claim candidate")
      const staleProposal = Option.getOrThrow(Option.fromUndefinedOr(graphProposal))
      const staleResult = yield* Effect.exit(admission.tryReserveFresh(beforeClaim, () => staleProposal))
      expect(Exit.isFailure(staleResult)).toBe(true)
      expect((yield* admission.snapshot).positions.size).toBe(0)
      const claimReservation = yield* admission.tryReserveFresh(beforeClaim, deliveryProposalOfAcceptedFreshTask)
      if (claimReservation._tag !== "Admitted") return yield* Effect.die("claim candidate was not admitted")
      yield* admission.bindFreshTaskClaimOperation(
        claimReservation.reservation,
        OperationId.make("ambiguous-claim-intent:A")
      )
      yield* admission.rollback(claimReservation.reservation, "AfterDurableClaimIntentOrAmbiguity")
      expect((yield* admission.snapshot).positions.size).toBe(1)
    })
  )
)

it.effect("refuses a copied reservation before it can release another action's position", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshGraphEntryDecision("A", "A-r1")],
        runId
      })
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("candidate was not admitted")
      const copied = { ...admitted.reservation } as typeof admitted.reservation
      const reflected = Object.freeze(
        Object.defineProperties({}, Object.getOwnPropertyDescriptors(admitted.reservation))
      ) as typeof admitted.reservation

      const refusal = yield* Effect.exit(admission.rollback(copied, "BeforeDurableClaimIntent"))
      const reflectedRefusal = yield* Effect.exit(admission.rollback(reflected, "BeforeDurableClaimIntent"))

      expect(Exit.isFailure(refusal)).toBe(true)
      expect(Exit.isFailure(reflectedRefusal)).toBe(true)
      expect((yield* admission.snapshot).positions.size).toBe(1)
      yield* admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")
      expect((yield* admission.snapshot).positions.size).toBe(0)

      const later = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (later._tag !== "Admitted") return yield* Effect.die("candidate was not readmitted")
      const replayRefusal = yield* Effect.exit(admission.rollback(admitted.reservation, "BeforeDurableClaimIntent"))
      expect(Exit.isFailure(replayRefusal)).toBe(true)
      expect((yield* admission.snapshot).positions.size).toBe(1)
      yield* admission.rollback(later.reservation, "BeforeDurableClaimIntent")
    })
  )
)

it.effect("does not expose fresh-entry occupancy through its descriptive snapshot", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshGraphEntryDecision("A", "A-r1")],
        runId
      })
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("candidate was not admitted")
      const position = (yield* admission.snapshot).positions.get(taskId)
      if (position?._tag !== "FreshEntryRuntimePosition") return yield* Effect.die("fresh position missing")

      expect(() => {
        ;(position.occupancy as { candidate: unknown }).candidate = undefined
      }).toThrow()
      yield* admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")
      expect((yield* admission.snapshot).positions.size).toBe(0)
    })
  )
)

it.effect("Exit rolls back delivery reservations prepared before owner registration", () =>
  withProtocolController(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const admission = yield* makeAdmissionControllerWithLifecycle(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController(),
        {
          ...lifecycle.admission,
          prepareForwardOwner: (kind) =>
            lifecycle.admission
              .prepareForwardOwner(kind)
              .pipe(
                Effect.map((preparation) => ({
                  ...preparation,
                  register: lifecycle.requestExit.pipe(Effect.andThen(preparation.register))
                }))
              )
        }
      )
      const proposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("exit-racing-admission-target")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("exit-racing-reservation")
      }

      expect((yield* admission.tryReserve(proposal).pipe(Effect.flip))._tag).toBe("ApplicationExiting")
      expect((yield* admission.snapshot).positions.size).toBe(0)
      expect(yield* lifecycle.admission.snapshot).toEqual({
        cutoffClosed: true,
        preparingOwnerCount: 0,
        registeredOwnerCount: 0
      })

      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const secondLifecycle = yield* makeApplicationExitLifecycle()
      const secondAdmission = yield* makeAdmissionControllerWithLifecycle(admissionBasis(1), integrationTargets, {
        ...secondLifecycle.admission,
        prepareForwardOwner: (kind) =>
          secondLifecycle.admission
            .prepareForwardOwner(kind)
            .pipe(
              Effect.map((preparation) => ({
                ...preparation,
                register: secondLifecycle.requestExit.pipe(Effect.andThen(preparation.register))
              }))
            )
      })
      const integrationTarget = IntegrationTarget.make({
        repository: GitRepositoryLocator.make("/admission/exit-race.git"),
        ref: IntegrationTargetRef.make("refs/heads/main")
      })
      const resourceProposal = {
        ...proposal,
        admission: {
          integrationTarget: {
            _tag: "IntegrationTargetResourceRequired" as const,
            access: "Acquire" as const,
            integrationTarget,
            queuedAt: JournalPosition.make(2)
          },
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation },
          taskWorkPosition: { _tag: "NoTaskWorkPosition" as const }
        },
        id: DeliveryProposalId.make("exit-racing-all-non-task-resources")
      }
      expect((yield* secondAdmission.tryReserve(resourceProposal).pipe(Effect.flip))._tag).toBe("ApplicationExiting")
      expect((yield* integrationTargets.snapshot).heldResponsibilityPositions).toEqual(new Set())
      const releasedProtocol = yield* (yield* PlannedAttemptProtocolController).reserve(correlation)
      expect(Option.isSome(releasedProtocol)).toBe(true)
      if (Option.isSome(releasedProtocol)) yield* releasedProtocol.value.release
    })
  )
)

it.effect("Exit registration failure restores a fresh candidate without leaking its position", () =>
  withProtocolController(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const admission = yield* makeAdmissionControllerWithLifecycle(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController(),
        {
          ...lifecycle.admission,
          prepareForwardOwner: (kind) =>
            lifecycle.admission
              .prepareForwardOwner(kind)
              .pipe(
                Effect.map((preparation) => ({
                  ...preparation,
                  register: lifecycle.requestExit.pipe(Effect.andThen(preparation.register))
                }))
              )
        }
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshEntryDecision("A", "exit-fresh-registration-failure")],
        runId
      })
      yield* admission.synchronize(admissionBasis(1), frontier)

      const result = yield* Effect.exit(admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask))

      expect(Exit.isFailure(result)).toBe(true)
      expect((yield* admission.snapshot).positions).toEqual(new Map())
      expect(yield* lifecycle.admission.snapshot).toEqual({
        cutoffClosed: true,
        preparingOwnerCount: 0,
        registeredOwnerCount: 0
      })
    })
  )
)

it.effect("reconciles existing, pending, and integration-backed admission positions exactly", () =>
  withProtocolController(
    Effect.gen(function* () {
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(3, [plannedAttempt]),
        integrationTargets
      )
      expect((yield* admission.snapshot).positions).toEqual(
        new Map([[taskId, TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt })]])
      )
      const proposalBase = trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(1),
        purpose: "EstablishCurrentGraph",
        runId,
        target: FixtureTarget.make("admission-exhaustive-target")
      })
      const proposalFor = (
        id: string,
        taskWorkPosition: Exclude<TaskWorkPositionRequirement, { readonly mode: "Existing" }>
      ) => ({
        ...proposalBase,
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition
        },
        id: DeliveryProposalId.make(id)
      })
      const correlatedProposalFor = (
        id: string,
        taskWorkPosition: TaskWorkPositionRequirement,
        exactCorrelation: typeof correlation
      ) => ({
        ...proposalBase,
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation: exactCorrelation },
          taskWorkPosition
        },
        id: DeliveryProposalId.make(id)
      })
      const matchingExisting = correlatedProposalFor(
        "matching-existing",
        { _tag: "TaskWorkPositionRequired", mode: "Existing", taskId },
        correlation
      )
      const otherCorrelation = { attemptId: AttemptId.make("attempt:A:other"), runId }
      const mismatchingExisting = correlatedProposalFor(
        "mismatching-existing",
        { _tag: "TaskWorkPositionRequired", mode: "Existing", taskId },
        otherCorrelation
      )
      const matchingReservation = yield* admission.tryReserve(matchingExisting)
      expect(matchingReservation._tag).toBe("Admitted")
      if (matchingReservation._tag === "Admitted") yield* admission.complete(matchingReservation.reservation)
      expect((yield* admission.tryReserve(mismatchingExisting))._tag).toBe("Deferred")
      expect(
        (yield* admission.tryReserve(
          proposalFor("reject-existing-without-exact-binding", {
            _tag: "TaskWorkPositionRequired",
            mode: "ReserveOrReuse",
            taskId
          })
        ))._tag
      ).toBe("Deferred")
      const reused = yield* admission.tryReserve(
        correlatedProposalFor(
          "reuse-existing-with-matching-binding",
          { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId },
          correlation
        )
      )
      expect(reused._tag).toBe("Admitted")
      if (reused._tag === "Admitted") yield* admission.complete(reused.reservation)

      const pendingTaskId = TaskId.make("pending")
      const pending = proposalFor("pending-position", {
        _tag: "TaskWorkPositionRequired",
        mode: "ReserveOrReuse",
        taskId: pendingTaskId
      })
      const pendingReservation = yield* admission.tryReserve(pending)
      expect(pendingReservation._tag).toBe("Admitted")
      const boundFromPending = yield* admission.tryReserve(
        correlatedProposalFor(
          "bind-pending-position",
          { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId: pendingTaskId },
          otherCorrelation
        )
      )
      expect(boundFromPending._tag).toBe("Admitted")
      expect((yield* admission.snapshot).positions.get(pendingTaskId)).toMatchObject({
        _tag: "BoundRuntimePosition",
        correlation: otherCorrelation
      })
      if (boundFromPending._tag === "Admitted") yield* admission.complete(boundFromPending.reservation)
      const synchronizedPendingTaskId = TaskId.make("synchronized-pending")
      const synchronizedPending = yield* admission.tryReserve(
        proposalFor("synchronized-pending-position", {
          _tag: "TaskWorkPositionRequired",
          mode: "ReserveOrReuse",
          taskId: synchronizedPendingTaskId
        })
      )
      expect(synchronizedPending._tag).toBe("Admitted")
      const pendingAttempt = plannedAttemptFor(pendingTaskId, otherCorrelation, "pending-other")
      const synchronizedAttempt = plannedAttemptFor(synchronizedPendingTaskId, correlation, "synchronized")
      yield* admission.synchronize(admissionBasis(3, [pendingAttempt, synchronizedAttempt]))
      expect((yield* admission.snapshot).positions.get(pendingTaskId)).toEqual(
        TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: pendingAttempt })
      )
      expect((yield* admission.snapshot).positions.get(synchronizedPendingTaskId)).toEqual(
        TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: synchronizedAttempt })
      )
      expect(yield* admission.releasePlannedAttemptPosition(otherCorrelation)).toBe("Released")
      expect(yield* admission.releasePlannedAttemptPosition(otherCorrelation)).toBe("AlreadyAbsent")

      const integrationTarget = IntegrationTarget.make({
        repository: GitRepositoryLocator.make("/admission/repository.git"),
        ref: IntegrationTargetRef.make("refs/heads/main")
      })
      const heldAt = JournalPosition.make(10)
      const heldResponsibility = { integrationTarget, queuedAt: heldAt }
      yield* integrationTargets.acquire(heldResponsibility)
      yield* integrationTargets.publishAcceptedOwnership(heldResponsibility)
      const integrationProposal = {
        ...proposalFor("integration-conflict", { _tag: "NoTaskWorkPosition" }),
        admission: {
          integrationTarget: {
            _tag: "IntegrationTargetResourceRequired" as const,
            access: "Acquire" as const,
            integrationTarget,
            queuedAt: JournalPosition.make(11)
          },
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation },
          taskWorkPosition: {
            _tag: "TaskWorkPositionRequired" as const,
            mode: "ReserveOrReuse" as const,
            taskId: TaskId.make("integration-task")
          }
        }
      }
      expect(yield* admission.tryReserve(integrationProposal)).toMatchObject({
        _tag: "Deferred",
        reason: "IntegrationTargetUnavailable"
      })
      expect((yield* admission.snapshot).positions.has(TaskId.make("integration-task"))).toBe(false)

      const useHeld = {
        ...integrationProposal,
        admission: {
          integrationTarget: {
            ...integrationProposal.admission.integrationTarget,
            access: "UseHeld" as const,
            queuedAt: heldAt
          },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition: { _tag: "NoTaskWorkPosition" as const }
        },
        id: DeliveryProposalId.make("use-held-integration")
      }
      expect((yield* admission.tryReserve(useHeld))._tag).toBe("Admitted")
      yield* integrationTargets.release({ integrationTarget, queuedAt: heldAt })
      expect((yield* admission.tryReserve(useHeld))._tag).toBe("Deferred")

      const noPosition = proposalFor("no-position", { _tag: "NoTaskWorkPosition" })
      const noPositionReservation = yield* admission.tryReserve(noPosition)
      if (noPositionReservation._tag !== "Admitted") return yield* Effect.die("no-position proposal was deferred")
      yield* admission.complete(noPositionReservation.reservation)

      const acquired = yield* admission.tryReserve({
        ...useHeld,
        admission: {
          ...useHeld.admission,
          integrationTarget: { ...useHeld.admission.integrationTarget, access: "Acquire" }
        },
        id: DeliveryProposalId.make("acquired-integration")
      })
      if (acquired._tag !== "Admitted") return yield* Effect.die("integration target was not acquired")
      yield* admission.rollback(acquired.reservation, "BeforeDurableClaimIntent")
      expect((yield* integrationTargets.snapshot).heldResponsibilityPositions).toEqual(new Set())
    })
  )
)

it.effect("reconstructs a fresh-entry occupancy as a runtime position", () =>
  withProtocolController(
    Effect.gen(function* () {
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshGraphEntryDecision("fresh-entry", "fresh-entry-r1")],
        runId
      })
      const candidate = frontier.candidates[0]
      if (candidate === undefined) return yield* Effect.die("fresh entry candidate was not derived")
      const basis = yield* makeFreshTaskAdmissionBasis({
        capacity: TaskWorkCapacity.make(1),
        entries: [TaskAdmissionOccupancy.FreshEntryReserved({ candidate })],
        runId
      })
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        basis,
        yield* makeIntegrationTargetResourceController()
      )

      expect((yield* admission.snapshot).positions.get(candidate.taskId)).toMatchObject({
        _tag: "FreshEntryRuntimePosition",
        occupancy: { candidate }
      })
    })
  )
)

it.effect("rejects a newer conflicting durable commitment instead of replacing the accepted one", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const replacementProjection = makeFreshTaskAdmissionProjectionForTest(
        taskId,
        OperationId.make("admission-test-conflicting-commitment"),
        runId
      )
      const replacement = admissionBasis(1, [], replacementProjection)

      expect(Exit.isFailure(yield* Effect.exit(admission.synchronize(replacement)))).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.FreshTaskCommitted({ commitment: taskACommitment })
      )
    })
  )
)

it.effect("rejects replacing a durable commitment with an exact attempt without handoff evidence", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const exactAttemptBasis = admissionBasis(1, [plannedAttempt], undefined, taskAProjection.acceptedAt)

      expect(Exit.isFailure(yield* Effect.exit(admission.synchronize(exactAttemptBasis)))).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.FreshTaskCommitted({ commitment: taskACommitment })
      )
    })
  )
)

it.effect("rejects an accepted exact attempt when a live fresh entry has no handoff authority", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshGraphEntryDecision("A", "live-entry-r1")],
        runId
      })
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("fresh entry was not admitted")

      const exactAttemptBasis = admissionBasis(1, [plannedAttempt], undefined, JournalPosition.make(1))
      expect(Exit.isFailure(yield* Effect.exit(admission.synchronize(exactAttemptBasis)))).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "FreshEntryRuntimePosition",
        activity: { _tag: "Owned" }
      })
      yield* admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")
    })
  )
)

it.effect("does not bind an attempt while the accepted basis has no Journal position", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const proposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("null-accepted-position")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("null-accepted-position")
      }
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("attempt reservation was not admitted")

      expect(
        Exit.isFailure(yield* Effect.exit(admission.bindPlannedAttemptPosition(admitted.reservation, plannedAttempt)))
      ).toBe(true)
      yield* admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")
    })
  )
)

it.effect("rejects a structural initial basis before creating a controller", () =>
  withProtocolController(
    Effect.gen(function* () {
      const structuralCopy = Object.freeze({ ...admissionBasis(1) }) as Parameters<
        typeof makeAdmissionControllerWithLifecycle
      >[0]
      const result = yield* Effect.exit(
        makeAdmissionControllerWithLifecycle(
          structuralCopy,
          yield* makeIntegrationTargetResourceController(),
          (yield* makeApplicationExitLifecycle()).admission
        )
      )

      expect(Exit.isFailure(result)).toBe(true)
    })
  )
)

it.effect("rejects a structural basis during synchronization", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const structuralCopy = Object.freeze({ ...admissionBasis(1) }) as Parameters<typeof admission.synchronize>[0]

      expect(Exit.isFailure(yield* Effect.exit(admission.synchronize(structuralCopy)))).toBe(true)
    })
  )
)

it.effect("rejects a copied reservation before binding a claim operation", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshEntryDecision("A", "copied-claim-r1")],
        runId
      })
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("fresh claim was not admitted")
      const copied = { ...admitted.reservation } as typeof admitted.reservation

      expect(
        Exit.isFailure(
          yield* Effect.exit(admission.bindFreshTaskClaimOperation(copied, OperationId.make("copied-claim")))
        )
      ).toBe(true)
      yield* admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")
    })
  )
)

it.effect("rejects completing a fresh claim before its exact operation binding", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshEntryDecision("A", "unbound-completion-r1")],
        runId
      })
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("fresh claim was not admitted")

      expect(Exit.isFailure(yield* Effect.exit(admission.complete(admitted.reservation)))).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "FreshEntryRuntimePosition",
        activity: { _tag: "Owned" }
      })
    })
  )
)

it.effect("rejects binding a claim operation to a graph-read fresh entry", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshGraphEntryDecision("A", "wrong-claim-bind-r1")],
        runId
      })
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("fresh graph entry was not admitted")

      expect(
        Exit.isFailure(
          yield* Effect.exit(
            admission.bindFreshTaskClaimOperation(admitted.reservation, OperationId.make("wrong-bind"))
          )
        )
      ).toBe(true)
      yield* admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")
    })
  )
)

it.effect("retains a durable commitment when the accepted basis omits it without release evidence", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )

      yield* admission.synchronize(admissionBasis(1, [], undefined, taskAProjection.acceptedAt))

      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.FreshTaskCommitted({ commitment: taskACommitment })
      )
    })
  )
)

it.effect("rejects a fresh runtime entry when a different durable commitment appears", () =>
  withProtocolController(
    Effect.gen(function* () {
      const frontier = makeFreshTaskCandidateFrontierForTest({
        acceptedAt: taskAProjection.acceptedAt,
        decisions: [freshEntryDecision("A", "runtime-commitment-mismatch-r1")],
        runId
      })
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1, [], undefined, taskAProjection.acceptedAt),
        yield* makeIntegrationTargetResourceController()
      )
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("fresh entry was not admitted")

      expect(Exit.isFailure(yield* Effect.exit(admission.synchronize(commitmentBasis(1), frontier)))).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "FreshEntryRuntimePosition",
        activity: { _tag: "Owned" }
      })
      yield* admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")
    })
  )
)

it.effect("adopts an exact accepted attempt only after its claim handoff is journaled", () =>
  withProtocolController(
    Effect.gen(function* () {
      const frontier = makeFreshTaskCandidateFrontierForTest({
        acceptedAt: exactHandoffFixture.projection.acceptedAt,
        decisions: [freshEntryDecision("A", "runtime-exact-handoff-r1")],
        runId
      })
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1, [], undefined, exactHandoffFixture.projection.acceptedAt),
        yield* makeIntegrationTargetResourceController()
      )
      const admitted = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (admitted._tag !== "Admitted") return yield* Effect.die("fresh claim was not admitted")

      yield* admission.bindFreshTaskClaimOperation(admitted.reservation, exactHandoffFixture.claimOperationId)
      yield* admission.complete(admitted.reservation)
      yield* admission.synchronize(admissionBasis(1, [], exactHandoffFixture.projection), frontier)

      expect((yield* admission.snapshot).positions.get(taskId)).toEqual(
        TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: exactHandoffFixture.attempt })
      )
    })
  )
)

it.effect("keeps a locally accepted existing attempt while relation publication catches up", () =>
  withProtocolController(
    Effect.gen(function* () {
      const initial = Effect.runSync(
        makeFreshTaskAdmissionBasis({
          acceptedAt: JournalPosition.make(1),
          capacity: TaskWorkCapacity.make(1),
          entries: [TaskAdmissionOccupancy.ExistingResponsibilityReserved({ plannedAttempt })],
          runId
        })
      )
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        initial,
        yield* makeIntegrationTargetResourceController()
      )
      const proposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("locally-accepted-existing")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "Existing" as const, taskId }
        },
        id: DeliveryProposalId.make("locally-accepted-existing")
      }
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("existing position was not admitted")

      yield* admission.bindPlannedAttemptPosition(admitted.reservation, plannedAttempt)
      yield* admission.synchronize(
        Effect.runSync(
          makeFreshTaskAdmissionBasis({
            acceptedAt: JournalPosition.make(2),
            capacity: TaskWorkCapacity.make(1),
            entries: [TaskAdmissionOccupancy.ExistingResponsibilityReserved({ plannedAttempt })],
            runId
          })
        )
      )

      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "LocallyAcceptedAttemptPosition",
        handoff: { _tag: "ExistingAttemptHandoff" },
        plannedAttempt,
        responsibilityAcceptedAt: JournalPosition.make(1)
      })
      yield* admission.complete(admitted.reservation)
    })
  )
)

it.effect("rejects a local fresh handoff when a different commitment is published", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: taskACommitment.operation.acquisition.operationId,
        plannedAttempt,
        specification: makeTaskWorkSpecification({ body: "local-mismatch", taskId, title: "local-mismatch" }),
        task
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [taskACommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("fresh handoff proposal was not derived")
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("fresh handoff was not admitted")

      yield* admission.bindPlannedAttemptPosition(admitted.reservation, plannedAttempt, acceptedResponsibility)
      const differentProjection = makeFreshTaskAdmissionProjectionForTest(
        taskId,
        OperationId.make("admission-test-different-commitment"),
        runId
      )
      expect(
        Exit.isFailure(yield* Effect.exit(admission.synchronize(admissionBasis(1, [], differentProjection))))
      ).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "LocallyAcceptedAttemptPosition",
        handoff: { _tag: "FreshCommitmentHandoff" },
        plannedAttempt
      })
      yield* admission.complete(admitted.reservation)
    })
  )
)

it.effect("rejects a local handoff when the accepted exact attempt differs", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        commitmentBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
      const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
      const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
        claimOperationId: taskACommitment.operation.acquisition.operationId,
        plannedAttempt,
        specification: makeTaskWorkSpecification({
          body: "local-attempt-mismatch",
          taskId,
          title: "local-attempt-mismatch"
        }),
        task
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [taskACommitment])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("fresh handoff proposal was not derived")
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("fresh handoff was not admitted")
      yield* admission.bindPlannedAttemptPosition(admitted.reservation, plannedAttempt, acceptedResponsibility)

      const otherCorrelation = { attemptId: AttemptId.make("attempt:A:accepted-different"), runId }
      const otherAttempt = plannedAttemptFor(taskId, otherCorrelation, "accepted-different")
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            admission.synchronize(admissionBasis(1, [otherAttempt], undefined, responsibilityAcceptedAt))
          )
        )
      ).toBe(true)
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "LocallyAcceptedAttemptPosition",
        plannedAttempt
      })
      yield* admission.complete(admitted.reservation)
    })
  )
)

it.effect("defers a correlated reuse while a fresh graph entry still owns the task position", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [freshGraphEntryDecision("A", "position-correlation-fresh-entry")],
        runId
      })
      const fresh = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (fresh._tag !== "Admitted") return yield* Effect.die("fresh graph entry was not admitted")
      yield* admission.complete(fresh.reservation)

      const proposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("position-correlation-fresh-entry")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("position-correlation-fresh-entry")
      }

      expect(yield* admission.tryReserve(proposal)).toEqual({ _tag: "Deferred", reason: "TaskWorkPositionUnavailable" })
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "FreshEntryRuntimePosition",
        activity: { _tag: "IdlePreIntent" }
      })
    })
  )
)

it.effect("rejects planned-attempt binding after its runtime position was released", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const proposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("released-before-bind")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("released-before-bind")
      }
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("runtime position was not admitted")

      expect(yield* admission.releasePlannedAttemptPosition(correlation)).toBe("Released")
      expect(
        Exit.isFailure(yield* Effect.exit(admission.bindPlannedAttemptPosition(admitted.reservation, plannedAttempt)))
      ).toBe(true)
      yield* admission.rollback(admitted.reservation, "BeforeDurableClaimIntent")
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(false)
    })
  )
)

it.effect("rejects completion replay after the exact reservation has already been consumed", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(1),
        yield* makeIntegrationTargetResourceController()
      )
      const proposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("completion-replay")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition: { _tag: "NoTaskWorkPosition" as const }
        },
        id: DeliveryProposalId.make("completion-replay")
      }
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("no-position proposal was not admitted")

      yield* admission.complete(admitted.reservation)
      expect(Exit.isFailure(yield* Effect.exit(admission.complete(admitted.reservation)))).toBe(true)
    })
  )
)

it.effect("restores the prior fresh-entry position when materialization returns another candidate", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(2),
        yield* makeIntegrationTargetResourceController()
      )
      const frontier = makeFreshTaskCandidateFrontierForTest({
        decisions: [
          freshGraphEntryDecision("A", "restore-previous-A"),
          freshGraphEntryDecision("B", "restore-previous-B")
        ],
        runId
      })
      let proposalA: AcceptedFreshTaskDeliveryProposal | undefined
      const first = yield* admission.tryReserveFresh(frontier, (accepted) => {
        const proposal = deliveryProposalOfAcceptedFreshTask(accepted)
        proposalA = proposal
        return proposal
      })
      if (first._tag !== "Admitted") return yield* Effect.die("A candidate was not admitted")
      const second = yield* admission.tryReserveFresh(frontier, deliveryProposalOfAcceptedFreshTask)
      if (second._tag !== "Admitted") return yield* Effect.die("B candidate was not admitted")
      yield* admission.complete(second.reservation)
      const wrongProposal = Option.getOrThrow(Option.fromUndefinedOr(proposalA))

      expect(Exit.isFailure(yield* Effect.exit(admission.tryReserveFresh(frontier, () => wrongProposal)))).toBe(true)
      expect((yield* admission.snapshot).positions.get(TaskId.make("B"))).toMatchObject({
        _tag: "FreshEntryRuntimePosition",
        activity: { _tag: "IdlePreIntent" }
      })
      yield* admission.rollback(first.reservation, "BeforeDurableClaimIntent")
    })
  )
)

it.effect("does not release a successor position when an older reservation rolls back", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        admissionBasis(2),
        yield* makeIntegrationTargetResourceController()
      )
      const pendingProposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph",
          runId,
          target: FixtureTarget.make("successor-reservation")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("successor-reservation-pending")
      }
      const pending = yield* admission.tryReserve(pendingProposal)
      if (pending._tag !== "Admitted") return yield* Effect.die("pending position was not admitted")
      const successorProposal = {
        ...pendingProposal,
        admission: {
          ...pendingProposal.admission,
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation }
        },
        id: DeliveryProposalId.make("successor-reservation-bound")
      }
      const successor = yield* admission.tryReserve(successorProposal)
      if (successor._tag !== "Admitted") return yield* Effect.die("successor position was not admitted")

      yield* admission.rollback(pending.reservation, "BeforeDurableClaimIntent")
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "BoundRuntimePosition",
        correlation,
        proposalId: successorProposal.id
      })
      yield* admission.complete(successor.reservation)
      expect(yield* admission.releasePlannedAttemptPosition(correlation)).toBe("Released")
    })
  )
)
