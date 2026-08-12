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
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { DeliveryProposalId, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import type { TaskWorkPositionRequirement } from "./delivery-action-proposal.js"
import { makeDeliveryRuntimeAdmissionController as makeAdmissionControllerWithLifecycle } from "./delivery-runtime-admission.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { AttemptChoiceRequestId } from "../../workflow/protocols/attempt-choice/events.js"
import { deliveryProposalsOf } from "./delivery-proposal-derivation.js"
import type { PlannedAttemptProtocolController } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"

const makeDeliveryRuntimeAdmissionController = Effect.fn("DeliveryRuntimeAdmissionTest.make")(function* (
  initial: Parameters<typeof makeAdmissionControllerWithLifecycle>[0],
  integrationTargets: Parameters<typeof makeAdmissionControllerWithLifecycle>[1]
) {
  return yield* makeAdmissionControllerWithLifecycle(initial, integrationTargets, yield* makeApplicationExitLifecycle())
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
        { capacity: TaskWorkCapacity.make(1), held: [] },
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

it.effect("keeps proof-based Stop behind an already admitted continuation until its command can be recorded", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(1), held: [] },
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

it.effect("a successful claim action releases its temporary task-work reservation", () =>
  withProtocolController(
    Effect.gen(function* () {
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(1), held: [] },
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

      expect((yield* admission.snapshot).positions.size).toBe(0)
    })
  )
)

it.effect("Exit rolls back delivery reservations prepared before owner registration", () =>
  withProtocolController(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const admission = yield* makeAdmissionControllerWithLifecycle(
        { capacity: TaskWorkCapacity.make(1), held: [] },
        yield* makeIntegrationTargetResourceController(),
        {
          ...lifecycle,
          prepareForwardOwner: (kind) =>
            lifecycle
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
      expect(yield* lifecycle.snapshot).toEqual({ cutoffClosed: true, preparingOwnerCount: 0, registeredOwnerCount: 0 })
    })
  )
)

it.effect("reconciles existing, pending, and integration-backed admission positions exactly", () =>
  withProtocolController(
    Effect.gen(function* () {
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        { capacity: TaskWorkCapacity.make(3), held: [{ correlation, taskId }] },
        integrationTargets
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
          plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
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
