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
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { DeliveryActionProtocolAdmissionMissing } from "./delivery-action-executor.js"
import { DeliveryProposalId, trackerGraphReadProposalOf } from "./delivery-action-proposal.js"
import { deliveryRuntimeResourceCapabilitiesOf } from "./delivery-runtime-resources.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import {
  deliveryRuntimeLiveOwnerSnapshots,
  makeDeliveryRuntimeLiveOwner,
  makeDeliveryRuntimeObservationController,
  makeObservedDeliveryActionLease,
  type DeliveryRuntimeLiveOwnerSource
} from "./delivery-runtime-observation.js"

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

const makeOwner = Effect.fn("DeliveryRuntimeObservationTest.makeOwner")(function* () {
  const integrationTargets = yield* makeIntegrationTargetResourceController()
  const { resources } = yield* deliveryRuntimeResourceCapabilitiesOf(
    integrationTargets,
    (yield* makeApplicationExitLifecycle()).admission
  )
  const admission = yield* resources
    .makeAdmissionController({ capacity: TaskWorkCapacity.make(1), held: [] })
    .pipe(Effect.provide(plannedAttemptProtocolControllerLayer))
  const admitted = yield* admission.tryReserve(proposal)
  if (admitted._tag === "Deferred") return yield* Effect.die("fixture proposal must be admitted")
  const owner: DeliveryRuntimeLiveOwnerSource = yield* makeDeliveryRuntimeLiveOwner(admitted.reservation)
  return { admission, integrationTargets, owner }
})

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

it.effect("closes a not-ready observation once and preserves that final state when closed again", () =>
  Effect.gen(function* () {
    const controller = yield* makeDeliveryRuntimeObservationController()
    yield* controller.close
    expect(yield* controller.signal.get).toMatchObject({ _tag: "Closed", final: null })

    yield* controller.close
    expect(yield* controller.signal.get).toMatchObject({ _tag: "Closed", final: null })
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
