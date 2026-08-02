import { it } from "@effect/vitest"
import {
  AttemptId,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  RunId,
  TaskId
} from "@dalph/contracts"
import { Effect } from "effect"
import { expect } from "vitest"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { DeliveryProposalId, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import type { TaskWorkPositionRequirement } from "./delivery-action-proposal.js"
import { makeDeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"

const runId = RunId.make("admission-test-run")
const taskId = TaskId.make("A")
const correlation = { attemptId: AttemptId.make("attempt:A:0"), runId }

it.effect("executor start reserves an exact planned-attempt position", () =>
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
        taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
      },
      id: DeliveryProposalId.make("reserve-A")
    }
    const start = {
      ...proposal,
      admission: {
        ...proposal.admission,
        taskWorkPosition: {
          _tag: "TaskWorkPositionRequired" as const,
          mode: "ReserveOrReuse" as const,
          retainAs: correlation,
          taskId
        }
      },
      id: DeliveryProposalId.make("start-A")
    }
    expect((yield* admission.tryReserve(start))._tag).toBe("Admitted")
    expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({ correlation })
  })
)

it.effect("a successful claim action releases its temporary task-work reservation", () =>
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

it.effect("reconciles existing, pending, and integration-backed admission positions exactly", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const admission = yield* makeDeliveryRuntimeAdmissionController(
      { capacity: TaskWorkCapacity.make(3), held: [{ correlation, taskId }] },
      integrationTargets
    )
    const proposalFor = (id: string, taskWorkPosition: TaskWorkPositionRequirement) => ({
      ...trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(1),
        purpose: "EstablishCurrentGraph",
        runId,
        target: FixtureTarget.make("admission-exhaustive-target")
      }),
      admission: { integrationTarget: { _tag: "NoIntegrationTargetResource" as const }, taskWorkPosition },
      id: DeliveryProposalId.make(id)
    })
    const matchingExisting = proposalFor("matching-existing", {
      _tag: "TaskWorkPositionRequired",
      correlation,
      mode: "Existing",
      taskId
    })
    const otherCorrelation = { attemptId: AttemptId.make("attempt:A:other"), runId }
    const mismatchingExisting = proposalFor("mismatching-existing", {
      _tag: "TaskWorkPositionRequired",
      correlation: otherCorrelation,
      mode: "Existing",
      taskId
    })
    expect((yield* admission.tryReserve(matchingExisting))._tag).toBe("Admitted")
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
    expect(
      (yield* admission.tryReserve(
        proposalFor("reuse-existing-with-matching-binding", {
          _tag: "TaskWorkPositionRequired",
          mode: "ReserveOrReuse",
          retainAs: correlation,
          taskId
        })
      ))._tag
    ).toBe("Admitted")

    const pendingTaskId = TaskId.make("pending")
    const pending = proposalFor("pending-position", {
      _tag: "TaskWorkPositionRequired",
      mode: "ReserveOrReuse",
      taskId: pendingTaskId
    })
    const pendingReservation = yield* admission.tryReserve(pending)
    expect(pendingReservation._tag).toBe("Admitted")
    const boundFromPending = yield* admission.tryReserve(
      proposalFor("bind-pending-position", {
        _tag: "TaskWorkPositionRequired",
        mode: "ReserveOrReuse",
        retainAs: otherCorrelation,
        taskId: pendingTaskId
      })
    )
    expect(boundFromPending._tag).toBe("Admitted")
    expect((yield* admission.snapshot).positions.get(pendingTaskId)).toMatchObject({
      _tag: "BoundRuntimePosition",
      correlation: otherCorrelation
    })
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
    yield* integrationTargets.acquire({ integrationTarget, queuedAt: heldAt })
    const integrationProposal = {
      ...proposalFor("integration-conflict", { _tag: "NoTaskWorkPosition" }),
      admission: {
        integrationTarget: {
          _tag: "IntegrationTargetResourceRequired" as const,
          access: "Acquire" as const,
          integrationTarget,
          queuedAt: JournalPosition.make(11)
        },
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
