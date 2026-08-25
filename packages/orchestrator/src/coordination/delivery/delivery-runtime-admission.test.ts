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
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Layer, Option } from "effect"
import { expect } from "vitest"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { DeliveryProposalId, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import type { TaskWorkPositionRequirement } from "./delivery-action-proposal.js"
import { makeDeliveryRuntimeAdmissionController as makeAdmissionControllerWithLifecycle } from "./delivery-runtime-admission.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { AttemptChoiceRequestId } from "../../workflow/protocols/attempt-choice/events.js"
import { deliveryProposalsOf } from "./delivery-proposal-derivation.js"
import {
  PlannedAttemptProtocolController,
  plannedAttemptProtocolControllerLayer
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"

const makeDeliveryRuntimeAdmissionController = Effect.fn("DeliveryRuntimeAdmissionTest.make")(function* (
  initial: Parameters<typeof makeAdmissionControllerWithLifecycle>[0],
  integrationTargets: Parameters<typeof makeAdmissionControllerWithLifecycle>[1]
) {
  return yield* makeAdmissionControllerWithLifecycle(
    initial,
    integrationTargets,
    (yield* makeApplicationExitLifecycle()).admission
  )
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

// TODO(#54): no case here contracts capacity below the number of held
// positions. The ceiling binds admission only, so existing holders must keep
// their positions and the next reserve must be refused until the count drops.
// See I8 in research/verification-bakeoff/INVARIANTS.md.

it.effect("executor start reserves an exact planned-attempt position", () =>
  withProtocolController(
    Effect.gen(function* () {
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(1), held: [], preStart: [] },
        integrationTargets
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
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({ correlation })
    })
  )
)

it.effect("defers a fresh executor start when its exact planned pre-start position is absent", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(1), held: [], preStart: [] },
        yield* makeIntegrationTargetResourceController()
      )
      const proposal = {
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph" as const,
          runId,
          target: FixtureTarget.make("missing-planned-pre-start-target")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "PlannedAttemptProtocolRequired" as const, correlation },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "Existing" as const, taskId }
        },
        id: DeliveryProposalId.make("start-without-planned-pre-start")
      }

      expect(yield* admission.tryReserve(proposal)).toMatchObject({
        _tag: "Deferred",
        reason: "TaskWorkPositionUnavailable"
      })
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(false)
    })
  )
)

it.effect("keeps proof-based Stop behind an already admitted continuation until its command can be recorded", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(1), held: [], preStart: [] },
        yield* makeIntegrationTargetResourceController()
      )
      const continuationTransition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
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
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({ correlation })
      expect((yield* admission.tryReserve(stop))._tag).toBe("Admitted")
    })
  )
)

it.effect("a successful claim action retains its pre-start task-work reservation", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(1), held: [], preStart: [] },
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
          taskWorkPosition: { _tag: "PreStartTaskWorkPositionRequired" as const, mode: "AcquireFresh" as const, taskId }
        },
        id: DeliveryProposalId.make("claim-A")
      }
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag !== "Admitted") return yield* Effect.die("claim reservation was unexpectedly deferred")

      yield* admission.bindPreStartTaskWorkPosition(taskId, OperationId.make("claim-A"))
      yield* admission.complete(admitted.reservation)

      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({ _tag: "DurablePreStartPosition" })
    })
  )
)

it.effect("three accepted pre-start claims occupy capacity before any fourth claim is admitted", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(3), held: [], preStart: [] },
        yield* makeIntegrationTargetResourceController()
      )
      const proposalFor = (id: string, task: TaskId) => ({
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph" as const,
          runId,
          target: FixtureTarget.make("capacity-pre-start-target")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition: {
            _tag: "PreStartTaskWorkPositionRequired" as const,
            mode: "AcquireFresh" as const,
            taskId: task
          }
        },
        id: DeliveryProposalId.make(id)
      })

      for (const [index, task] of [TaskId.make("A"), TaskId.make("B"), TaskId.make("C")].entries()) {
        const admitted = yield* admission.tryReserve(proposalFor(`claim-${index}`, task))
        if (admitted._tag !== "Admitted") return yield* Effect.die(`claim ${task} was unexpectedly deferred`)
        yield* admission.bindPreStartTaskWorkPosition(task, OperationId.make(`claim-${task}`))
        yield* admission.complete(admitted.reservation)
      }

      expect((yield* admission.snapshot).positions.size).toBe(3)
      const fourth = yield* admission.tryReserve(proposalFor("claim-D", TaskId.make("D")))
      expect(fourth).toMatchObject({ _tag: "Deferred", reason: "TaskWorkPositionUnavailable" })
      expect([...(yield* admission.snapshot).positions.keys()]).toEqual(["A", "B", "C"])
    })
  )
)

it.effect("retains live pre-start reservations across a stale synchronization", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(3), held: [], preStart: [] },
        yield* makeIntegrationTargetResourceController()
      )
      const proposalFor = (id: string, task: TaskId) => ({
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph" as const,
          runId,
          target: FixtureTarget.make("stale-pre-start-target")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition: {
            _tag: "PreStartTaskWorkPositionRequired" as const,
            mode: "AcquireFresh" as const,
            taskId: task
          }
        },
        id: DeliveryProposalId.make(id)
      })
      const reservations = []
      for (const task of [TaskId.make("A"), TaskId.make("B"), TaskId.make("C")]) {
        const admitted = yield* admission.tryReserve(proposalFor(`stale-${task}`, task))
        if (admitted._tag !== "Admitted") return yield* Effect.die(`claim ${task} was unexpectedly deferred`)
        reservations.push(admitted.reservation)
        yield* admission.bindPreStartTaskWorkPosition(task, OperationId.make(`stale-claim-${task}`))
      }

      yield* admission.synchronize({ capacity: TaskWorkCapacity.make(3), held: [], preStart: [] })
      expect(yield* admission.tryReserve(proposalFor("stale-D", TaskId.make("D")))).toMatchObject({
        _tag: "Deferred",
        reason: "TaskWorkPositionUnavailable"
      })
      for (const reservation of reservations) yield* admission.rollback(reservation, false)
    })
  )
)

it.effect("retains a reconstructed running position across a stale synchronization", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(1), held: [{ correlation, taskId }], preStart: [] },
        yield* makeIntegrationTargetResourceController()
      )

      yield* admission.synchronize({ capacity: TaskWorkCapacity.make(1), held: [], preStart: [] })
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({
        _tag: "AcceptedAttemptPositionOmittedOnce",
        correlation
      })

      yield* admission.bindPlannedAttemptPosition(taskId, correlation)
      yield* admission.synchronize({
        capacity: TaskWorkCapacity.make(1),
        held: [{ correlation, taskId }],
        preStart: []
      })
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({ _tag: "AcceptedAttemptPosition" })
      yield* admission.synchronize({ capacity: TaskWorkCapacity.make(1), held: [], preStart: [] })
      yield* admission.synchronize({ capacity: TaskWorkCapacity.make(1), held: [], preStart: [] })
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(false)
    })
  )
)

it.effect("reuses only the exact claim operation and releases only the exact planned attempt", () =>
  withProtocolController(
    Effect.gen(function* () {
      const claimOperationId = OperationId.make("claim-A-exact")
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        {
          capacity: TaskWorkCapacity.make(1),
          held: [],
          preStart: [{ _tag: "PlannedPreStartTaskWorkPosition", claimOperationId, correlation, taskId }]
        },
        yield* makeIntegrationTargetResourceController()
      )
      const proposal = (claim: OperationId) => ({
        ...trackerGraphReadProposalOf({
          acceptedAt: JournalPosition.make(1),
          purpose: "EstablishCurrentGraph" as const,
          runId,
          target: FixtureTarget.make("exact-pre-start-target")
        }),
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
          taskWorkPosition: {
            _tag: "PreStartTaskWorkPositionRequired" as const,
            claimOperationId: claim,
            mode: "ReuseExisting" as const,
            taskId
          }
        },
        id: DeliveryProposalId.make(`read-${claim}`)
      })

      const exact = yield* admission.tryReserve(proposal(claimOperationId))
      expect(exact._tag).toBe("Admitted")
      if (exact._tag === "Admitted") yield* admission.complete(exact.reservation)
      expect((yield* admission.tryReserve(proposal(OperationId.make("claim-A-foreign"))))._tag).toBe("Deferred")

      yield* admission.releasePlannedAttemptPosition({
        attemptId: AttemptId.make("attempt:A:foreign"),
        runId: RunId.make("foreign-run")
      })
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(true)
      yield* admission.releasePlannedAttemptPosition(correlation)
      expect((yield* admission.snapshot).positions.has(taskId)).toBe(false)
    })
  )
)

it.effect("fails closed when a claim or plan binding loses its exact position provenance", () =>
  withProtocolController(
    Effect.gen(function* () {
      const exactClaimOperationId = OperationId.make("claim-binding-exact")
      const foreignClaimOperationId = OperationId.make("claim-binding-foreign")
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        {
          capacity: TaskWorkCapacity.make(2),
          held: [],
          preStart: [{ _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId: exactClaimOperationId, taskId }]
        },
        yield* makeIntegrationTargetResourceController()
      )

      const missingClaim = yield* admission
        .bindPreStartTaskWorkPosition(TaskId.make("missing-binding"), exactClaimOperationId)
        .pipe(Effect.flip)
      expect(missingClaim).toMatchObject({
        _tag: "PreStartClaimTaskWorkPositionBindingContradiction",
        reason: "PositionMissing"
      })

      const foreignClaim = yield* admission
        .bindPreStartTaskWorkPosition(taskId, foreignClaimOperationId)
        .pipe(Effect.flip)
      expect(foreignClaim).toMatchObject({
        _tag: "PreStartClaimTaskWorkPositionBindingContradiction",
        reason: "ClaimOperationMismatch",
        claimOperationId: foreignClaimOperationId
      })

      const plannedCorrelation = { attemptId: AttemptId.make("attempt:binding:0"), runId }
      yield* admission.bindPreStartTaskWorkPosition(taskId, exactClaimOperationId)
      yield* admission.bindPreStartPlannedAttemptPosition(taskId, exactClaimOperationId, plannedCorrelation)

      const foreignAttempt = yield* admission
        .bindPreStartPlannedAttemptPosition(taskId, exactClaimOperationId, {
          attemptId: AttemptId.make("attempt:binding:foreign"),
          runId
        })
        .pipe(Effect.flip)
      expect(foreignAttempt).toMatchObject({
        _tag: "PreStartPlanTaskWorkPositionBindingContradiction",
        reason: "AttemptCorrelationMismatch"
      })

      const foreignExecutorAttempt = yield* admission
        .bindPlannedAttemptPosition(taskId, { attemptId: AttemptId.make("attempt:binding:foreign-executor"), runId })
        .pipe(Effect.flip)
      expect(foreignExecutorAttempt).toMatchObject({
        _tag: "ExecutorPlanTaskWorkPositionBindingContradiction",
        reason: "AttemptCorrelationMismatch"
      })
    })
  )
)

it.effect("Exit rolls back delivery reservations prepared before owner registration", () =>
  withProtocolController(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const admission = yield* makeAdmissionControllerWithLifecycle(
        { capacity: TaskWorkCapacity.make(1), held: [], preStart: [] },
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
      const secondAdmission = yield* makeAdmissionControllerWithLifecycle(
        { capacity: TaskWorkCapacity.make(1), held: [], preStart: [] },
        integrationTargets,
        {
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
        }
      )
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

it.effect("reconciles existing, pending, and integration-backed admission positions exactly", () =>
  withProtocolController(
    Effect.gen(function* () {
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(3), held: [{ correlation, taskId }], preStart: [] },
        integrationTargets
      )
      const missingBinding = yield* admission
        .bindPlannedAttemptPosition(TaskId.make("unknown"), correlation)
        .pipe(Effect.flip)
      expect(missingBinding).toMatchObject({
        _tag: "ExecutorPlanTaskWorkPositionBindingContradiction",
        reason: "PositionMissing"
      })
      expect((yield* admission.snapshot).positions).toEqual(
        new Map([[taskId, { _tag: "AcceptedAttemptPosition", correlation }]])
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
          proposalFor("reuse-existing-without-binding", {
            _tag: "TaskWorkPositionRequired",
            mode: "ReserveOrReuse",
            taskId
          })
        ))._tag
      ).toBe("Admitted")
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
      yield* admission.synchronize({
        capacity: TaskWorkCapacity.make(3),
        preStart: [],
        held: [
          { correlation: otherCorrelation, taskId: pendingTaskId },
          { correlation, taskId: synchronizedPendingTaskId }
        ]
      })
      expect((yield* admission.snapshot).positions.get(pendingTaskId)).toMatchObject({
        _tag: "BoundRuntimePosition",
        correlation: otherCorrelation
      })
      expect((yield* admission.snapshot).positions.get(synchronizedPendingTaskId)).toMatchObject({
        _tag: "BoundRuntimePosition",
        correlation
      })
      yield* admission.releasePlannedAttemptPosition(otherCorrelation)
      yield* admission.releasePlannedAttemptPosition(otherCorrelation)

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
      yield* admission.rollback(acquired.reservation, false)
      expect((yield* integrationTargets.snapshot).heldResponsibilityPositions).toEqual(new Set())
    })
  )
)
