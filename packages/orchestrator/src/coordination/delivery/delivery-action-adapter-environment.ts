import type { PlannedAttemptExecutor } from "@dalph/contracts"
import { Context, Effect, Option } from "effect"
import type { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import type { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import type { InRunJournal } from "../../workflow-journal/store.js"
import { EvidenceStore, type EvidenceStoreService } from "../../workflow/protocols/evidence-store.js"
import type {
  OperationIdAllocator,
  PlannedTaskAttemptPlanner
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import type {
  PassivePlannedAttemptObserver,
  PassivePlannedAttemptProjectionPublication
} from "../run/passive-planned-attempt-observer.js"

/** Services captured once by the closed executor and interpreted only by route-specific leaves. */
export type DeliveryActionAdapterEnvironment =
  | InRunJournal
  | OperationIdAllocator
  | PassivePlannedAttemptObserver
  | PassivePlannedAttemptProjectionPublication
  | PlannedAttemptExecutor
  | PlannedTaskAttemptPlanner
  | TaskClaimAcquisitionPlanner
  | WorkflowInterpreter
  | WorkflowTrace

/** Carries the optional immutable acceptance store through the closed live adapter. */
export const optionalEvidenceStoreOf = (context: Context.Context<never>): Option.Option<EvidenceStoreService> =>
  Context.getOption(context, EvidenceStore)

/** Provides the optional acceptance store without widening the closed adapter's environment. */
export const provideOptionalEvidenceStore = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  evidenceStore: Option.Option<EvidenceStoreService>
): Effect.Effect<A, E, R> =>
  Option.isSome(evidenceStore) ? effect.pipe(Effect.provideService(EvidenceStore, evidenceStore.value)) : effect
