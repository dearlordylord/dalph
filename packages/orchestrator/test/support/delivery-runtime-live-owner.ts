import { Effect } from "effect"
import type { OperationId } from "../../src/workflow/identity.js"
import { makeDeliveryRuntimeAdmissionController } from "../../src/coordination/delivery/delivery-runtime-admission.js"
import { makeApplicationExitLifecycle } from "../../src/coordination/application-exit/lifecycle.js"
import { makeIntegrationTargetResourceController } from "../../src/coordination/admission/integration-target-resource.js"
import { plannedAttemptProtocolControllerLayer } from "../../src/workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { makeFreshTaskAdmissionTestBasis } from "./fresh-task-admission.js"
import type { DeliveryActionProposal } from "../../src/coordination/delivery/delivery-action-proposal.js"
import {
  makeDeliveryRuntimeLiveOwner,
  type DeliveryRuntimeActionIntent,
  type DeliveryRuntimeLiveOwnerSnapshot as DeliveryRuntimeLiveOwnerSnapshotType
} from "../../src/coordination/delivery/delivery-runtime-observation.js"

type TicketOwnerStage =
  | { readonly _tag: "AdmittedDeliveryAction" }
  | {
      readonly _tag: "MaterializedDeliveryAction"
      readonly intent: DeliveryRuntimeActionIntent
      readonly operationId: OperationId
    }
  | { readonly _tag: "SettledBeforeMaterialization" }
  | {
      readonly _tag: "SettledMaterializedDeliveryAction"
      readonly intent: DeliveryRuntimeActionIntent
      readonly operationId: OperationId
    }

/** Admits the fixture through production resource admission and snapshots its real owner without executing work. */
export const ticketOwnerSnapshotForTest = (
  proposal: DeliveryActionProposal,
  stage: TicketOwnerStage = { _tag: "AdmittedDeliveryAction" }
): DeliveryRuntimeLiveOwnerSnapshotType =>
  Effect.runSync(
    Effect.gen(function* () {
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const lifecycle = yield* makeApplicationExitLifecycle()
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        makeFreshTaskAdmissionTestBasis({ capacity: 1 }),
        integrationTargets,
        lifecycle.admission
      )
      const admitted = yield* admission.tryReserve(proposal)
      if (admitted._tag === "Deferred")
        return yield* Effect.die(`projection fixture admission deferred: ${admitted.reason}`)
      const owner = yield* makeDeliveryRuntimeLiveOwner(admitted.reservation)
      if (stage._tag === "MaterializedDeliveryAction" || stage._tag === "SettledMaterializedDeliveryAction") {
        yield* owner.materialize(stage.operationId)
        if (stage.intent === "IntentRecorded") yield* owner.recordIntent(stage.operationId)
      }
      if (stage._tag === "SettledBeforeMaterialization" || stage._tag === "SettledMaterializedDeliveryAction")
        yield* owner.settle
      const snapshot = yield* owner.snapshot
      yield* admission.complete(admitted.reservation)
      return snapshot
    }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer))
  )
