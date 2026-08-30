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
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect, Fiber, Ref, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { DeliveryActionProtocolAdmissionMissing } from "./delivery-action-executor.js"
import {
  DeliveryProposalId,
  DeliveryProposalOrdinal,
  trackerGraphReadProposalOf,
  type DeliveryActionProposal,
  type TaskWorkPositionRequirement
} from "./delivery-action-proposal.js"
import { deliveryRuntimeResourceCapabilitiesOf } from "./delivery-runtime-resources.js"
import type { DeliveryTaskWorkAdmissionBasis } from "./relations.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import {
  deliveryRuntimeLiveOwnerSnapshots,
  makeDeliveryRuntimeLiveOwner,
  makeDeliveryRuntimeObservationController,
  makeObservedDeliveryActionLease,
  type DeliveryRuntimeLiveOwnerSource
} from "./delivery-runtime-observation.js"
import { deliveryStatusSignalOf } from "./delivery-status.js"

const runId = RunId.make("delivery-runtime-observation-test")
const taskId = TaskId.make("owner-task")
const proposal = {
  ...trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(1),
    purpose: "EstablishCurrentGraph",
    runId,
    target: FixtureTarget.make("owner-target")
  }),
  id: DeliveryProposalId.make("owner-proposal")
}
const correlation = plannedAttemptExecutorCorrelation(
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make("owner-attempt"),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/owner-task"),
    executor: TaskExecutorLocator.make("executor:owner-test"),
    runId,
    taskId,
    taskRevision: TaskRevision.make("owner-revision"),
    worktree: WorktreeLocator.make("/owner-test/worktree")
  })
)

const makeOwner = Effect.fn("DeliveryRuntimeObservationTest.makeOwner")(function* (
  ownerProposal: DeliveryActionProposal = proposal,
  preStart: DeliveryTaskWorkAdmissionBasis["preStart"] = []
) {
  const integrationTargets = yield* makeIntegrationTargetResourceController()
  const { resources } = yield* deliveryRuntimeResourceCapabilitiesOf(
    integrationTargets,
    (yield* makeApplicationExitLifecycle()).admission
  )
  const admission = yield* resources
    .makeAdmissionController({ capacity: TaskWorkCapacity.make(1), held: [], preStart })
    .pipe(Effect.provide(plannedAttemptProtocolControllerLayer))
  const admitted = yield* admission.tryReserve(ownerProposal)
  if (admitted._tag === "Deferred") return yield* Effect.die("fixture proposal must be admitted")
  const owner: DeliveryRuntimeLiveOwnerSource = yield* makeDeliveryRuntimeLiveOwner(admitted.reservation)
  return { admission, integrationTargets, owner }
})

const taskScopedProposal = (id: string, taskWorkPosition: TaskWorkPositionRequirement): DeliveryActionProposal =>
  ({
    ...proposal,
    admission: { ...proposal.admission, taskWorkPosition },
    id: DeliveryProposalId.make(id),
    order: {
      _tag: "FreshWorkflowOrder",
      frontierOrdinal: DeliveryProposalOrdinal.make(0),
      step: "AcquireTaskClaim",
      taskId
    }
  }) as DeliveryActionProposal

it.effect("publishes each exact owner lifecycle atomically and keeps proposal identities branded", () =>
  Effect.gen(function* () {
    const { owner } = yield* makeOwner()
    const laterProposal = { ...proposal, id: DeliveryProposalId.make("z-owner-proposal") }
    const laterOwner = yield* makeDeliveryRuntimeLiveOwner({ ...owner.reservation, proposal: laterProposal })
    const owners = new Map([
      [laterProposal.id, laterOwner],
      [proposal.id, owner]
    ])

    expect(yield* deliveryRuntimeLiveOwnerSnapshots(owners)).toMatchObject([
      { _tag: "AdmittedDeliveryAction", proposal: { id: proposal.id } },
      { _tag: "AdmittedDeliveryAction", proposal: { id: laterProposal.id } }
    ])

    yield* owner.settle
    expect(yield* owner.intentRecorded).toBe(false)
    expect(yield* owner.isSettled).toBe(true)
    expect(yield* owner.operationId).toMatchObject({ _tag: "None" })
    yield* owner.settle
    expect(yield* deliveryRuntimeLiveOwnerSnapshots(owners)).toMatchObject([
      { _tag: "SettledBeforeMaterialization", proposal: { id: proposal.id } },
      { _tag: "AdmittedDeliveryAction", proposal: { id: laterProposal.id } }
    ])

    const operationId = OperationId.make("owner-operation")
    yield* owner.materialize(operationId)
    expect(yield* deliveryRuntimeLiveOwnerSnapshots(owners)).toMatchObject([
      { _tag: "SettledBeforeMaterialization" },
      { _tag: "AdmittedDeliveryAction" }
    ])

    expect(yield* owner.recordIntent(operationId)).toBe(false)
    expect(yield* deliveryRuntimeLiveOwnerSnapshots(owners)).toMatchObject([
      { _tag: "SettledBeforeMaterialization" },
      { _tag: "AdmittedDeliveryAction" }
    ])
  })
)

it.effect("moves one admitted owner through exact atomic materialization, intent, and settlement cutpoints", () =>
  Effect.gen(function* () {
    const { owner } = yield* makeOwner()
    const operationId = OperationId.make("atomic-owner-operation")

    yield* owner.materialize(operationId)
    expect(yield* owner.snapshot).toMatchObject({
      _tag: "MaterializedDeliveryAction",
      intent: "IntentNotRecorded",
      operationId,
      proposal
    })

    expect(yield* owner.recordIntent(OperationId.make("wrong-owner-operation"))).toBe(false)
    expect(yield* owner.snapshot).toMatchObject({ intent: "IntentNotRecorded", operationId })

    expect(yield* owner.recordIntent(operationId)).toBe(true)
    expect(yield* owner.snapshot).toMatchObject({ intent: "IntentRecorded", operationId })

    yield* owner.settle
    expect(yield* owner.intentRecorded).toBe(true)
    expect(yield* owner.isSettled).toBe(true)
    expect(yield* owner.operationId).toMatchObject({ _tag: "Some", value: operationId })
    expect(yield* owner.snapshot).toMatchObject({
      _tag: "SettledMaterializedDeliveryAction",
      intent: "IntentRecorded",
      operationId,
      proposal
    })
    yield* owner.settle
    expect(yield* owner.recordIntent(operationId)).toBe(false)
    expect(yield* owner.snapshot).toMatchObject({ _tag: "SettledMaterializedDeliveryAction", operationId })
  })
)

it.effect("rejects protocol work when the admitted action owns no planned-attempt permit", () =>
  Effect.gen(function* () {
    const { admission, integrationTargets, owner } = yield* makeOwner()
    const changed = yield* Ref.make(0)
    const lease = makeObservedDeliveryActionLease(
      admission,
      integrationTargets,
      owner,
      Ref.update(changed, (count) => count + 1)
    )

    const operationId = OperationId.make("lease-owner-operation")
    yield* owner.materialize(operationId)
    yield* lease.recordIntent(operationId)
    expect(yield* owner.intentRecorded).toBe(true)
    expect(yield* Ref.get(changed)).toBe(1)

    const rejectedIntent = yield* Effect.exit(lease.recordIntent(OperationId.make("wrong-lease-owner-operation")))
    expect(rejectedIntent._tag).toBe("Failure")

    const failure = yield* lease.withPlannedAttemptProtocol(correlation, () => Effect.void).pipe(Effect.flip)
    expect(failure).toEqual(
      new DeliveryActionProtocolAdmissionMissing({ correlation, proposalId: owner.reservation.proposal.id })
    )
  })
)

it.effect("fails closed for every task-position phase exposed through an observed action lease", () =>
  Effect.gen(function* () {
    const operationId = OperationId.make("lease-position-operation")
    const foreignOperationId = OperationId.make("lease-position-foreign-operation")

    const runScoped = yield* makeOwner()
    const runScopedLease = makeObservedDeliveryActionLease(
      runScoped.admission,
      runScoped.integrationTargets,
      runScoped.owner,
      Effect.void
    )
    expect((yield* Effect.exit(runScopedLease.bindPreStartTaskWorkPosition(operationId)))._tag).toBe("Failure")
    expect((yield* Effect.exit(runScopedLease.bindPreStartPlannedAttemptPosition(operationId, correlation)))._tag).toBe(
      "Failure"
    )
    expect((yield* Effect.exit(runScopedLease.bindPlannedAttemptPosition(correlation)))._tag).toBe("Failure")

    const taskWithoutPosition = yield* makeOwner(
      taskScopedProposal("lease-task-without-position", { _tag: "NoTaskWorkPosition" })
    )
    const taskWithoutPositionLease = makeObservedDeliveryActionLease(
      taskWithoutPosition.admission,
      taskWithoutPosition.integrationTargets,
      taskWithoutPosition.owner,
      Effect.void
    )
    expect((yield* taskWithoutPositionLease.bindPreStartTaskWorkPosition(operationId).pipe(Effect.flip)).reason).toBe(
      "UnexpectedPositionPhase"
    )
    expect(
      (yield* taskWithoutPositionLease.bindPreStartPlannedAttemptPosition(operationId, correlation).pipe(Effect.flip))
        .reason
    ).toBe("UnexpectedPositionPhase")
    expect((yield* taskWithoutPositionLease.bindPlannedAttemptPosition(correlation).pipe(Effect.flip)).reason).toBe(
      "UnexpectedPositionPhase"
    )

    const running = yield* makeOwner(
      taskScopedProposal("lease-running-position", { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId })
    )
    const runningLease = makeObservedDeliveryActionLease(
      running.admission,
      running.integrationTargets,
      running.owner,
      Effect.void
    )
    expect((yield* runningLease.bindPreStartTaskWorkPosition(operationId).pipe(Effect.flip)).reason).toBe(
      "UnexpectedPositionPhase"
    )
    expect(
      (yield* runningLease.bindPreStartPlannedAttemptPosition(operationId, correlation).pipe(Effect.flip)).reason
    ).toBe("UnexpectedPositionPhase")
    yield* runningLease.bindPlannedAttemptPosition(correlation)

    const freshClaim = yield* makeOwner(
      taskScopedProposal("lease-fresh-claim-position", {
        _tag: "PreStartTaskWorkPositionRequired",
        mode: "AcquireFresh",
        taskId
      })
    )
    const freshClaimLease = makeObservedDeliveryActionLease(
      freshClaim.admission,
      freshClaim.integrationTargets,
      freshClaim.owner,
      Effect.void
    )
    yield* freshClaimLease.bindPreStartTaskWorkPosition(operationId)
    expect(
      (yield* freshClaimLease.bindPreStartPlannedAttemptPosition(operationId, correlation).pipe(Effect.flip)).reason
    ).toBe("UnexpectedPositionPhase")
    expect((yield* freshClaimLease.bindPlannedAttemptPosition(correlation).pipe(Effect.flip)).reason).toBe(
      "UnexpectedPositionPhase"
    )

    const existingClaim = yield* makeOwner(
      taskScopedProposal("lease-existing-claim-position", {
        _tag: "PreStartTaskWorkPositionRequired",
        claimOperationId: operationId,
        mode: "ReuseExisting",
        taskId
      }),
      [{ _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId: operationId, taskId }]
    )
    const existingClaimLease = makeObservedDeliveryActionLease(
      existingClaim.admission,
      existingClaim.integrationTargets,
      existingClaim.owner,
      Effect.void
    )
    expect((yield* existingClaimLease.bindPreStartTaskWorkPosition(foreignOperationId).pipe(Effect.flip)).reason).toBe(
      "ClaimOperationMismatch"
    )
    yield* existingClaimLease.bindPreStartTaskWorkPosition(operationId)
    expect(
      (yield* existingClaimLease.bindPreStartPlannedAttemptPosition(foreignOperationId, correlation).pipe(Effect.flip))
        .reason
    ).toBe("ClaimOperationMismatch")
    yield* existingClaimLease.bindPreStartPlannedAttemptPosition(operationId, correlation)
    expect(
      (yield* existingClaimLease.bindPreStartPlannedAttemptPosition(foreignOperationId, correlation).pipe(Effect.flip))
        .reason
    ).toBe("ClaimOperationMismatch")
    yield* existingClaimLease.bindPreStartPlannedAttemptPosition(operationId, correlation)
    expect(
      (yield* existingClaim.admission
        .bindPlannedAttemptPosition(
          taskId,
          { ...correlation, attemptId: AttemptId.make("lease-position-foreign-attempt") },
          existingClaim.owner.proposal.id
        )
        .pipe(Effect.flip)).reason
    ).toBe("AttemptCorrelationMismatch")
    yield* existingClaim.admission.bindPlannedAttemptPosition(taskId, correlation, existingClaim.owner.proposal.id)
  })
)

it.effect("closes a not-ready observation once and preserves that final state when closed again", () =>
  Effect.gen(function* () {
    const controller = yield* makeDeliveryRuntimeObservationController()
    yield* controller.close
    expect(yield* controller.signal.get).toMatchObject({ _tag: "Closed", final: { _tag: "NotReady" } })

    yield* controller.close
    expect(yield* controller.signal.get).toMatchObject({ _tag: "Closed", final: { _tag: "NotReady" } })
  })
)

it.effect("closes the status observer with the last published not-ready value", () =>
  Effect.gen(function* () {
    const controller = yield* makeDeliveryRuntimeObservationController()
    const subject = { _tag: "Run" as const, runId }
    const status = yield* deliveryStatusSignalOf(controller.signal, subject)
    const observed = yield* status.changes.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
    yield* Effect.yieldNow

    yield* controller.close

    expect(Array.from(yield* Fiber.join(observed))).toEqual([
      { _tag: "DeliveryStatusNotReady", subject },
      { _tag: "DeliveryStatusClosed", subject, final: { _tag: "DeliveryStatusNotReady", subject } }
    ])
  })
)

it.effect("keeps Alice's runtime observation open when an ordinary runtime phase releases integration targets", () =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const { observation, resources } = yield* deliveryRuntimeResourceCapabilitiesOf(
      integrationTargets,
      (yield* makeApplicationExitLifecycle()).admission
    )

    yield* resources.integrationTargets.releaseAll

    expect(yield* observation.signal.get).toMatchObject({ _tag: "NotReady" })
    yield* observation.close
  })
)
