import { type RunId } from "@dalph/contracts"
import { Effect, Schema, Stream } from "effect"
import type { IntegrationTargetResourceSnapshot } from "../admission/integration-target-resource.js"
import { DeliveryRuntimeObservationState } from "../delivery/delivery-runtime-observation.js"
import type { DeliveryRuntimeResourcesService } from "../delivery/delivery-runtime-resources.js"
import { attachCurrentSignal } from "../delivery/relations.js"
import { ControlDirectionSubject } from "../../workflow/protocols/control-direction-application/events.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import {
  PauseNotApplied,
  PauseObservationRunMismatch,
  type PauseProgressProjectionConflict,
  type PauseProgressView,
  pauseProgressViewOf
} from "./pause-progress-observation.js"

type ReadyRuntimeObservation = Extract<DeliveryRuntimeObservationState, { readonly _tag: "Ready" }>

export interface PauseObservationAcceptedBasis {
  /** Latest accepted journal position present when Alice began this observation. */
  readonly latestAcceptedAt: JournalPosition | null
}

type PauseProgressObservationResources = Pick<DeliveryRuntimeResourcesService, "runtimeObservation"> & {
  readonly integrationTargets: Pick<DeliveryRuntimeResourcesService["integrationTargets"], "changes">
}

const runtimeIncludesAcceptedPosition = (
  runtime: DeliveryRuntimeObservationState,
  minimumAcceptedAt: JournalPosition | null
): runtime is ReadyRuntimeObservation =>
  runtime._tag === "Ready" &&
  (minimumAcceptedAt === null ||
    (runtime.evaluation.acceptedAt !== null && runtime.evaluation.acceptedAt >= minimumAcceptedAt))

const samePositions = (left: ReadonlySet<JournalPosition>, right: ReadonlySet<JournalPosition>): boolean => {
  if (left.size !== right.size) return false
  for (const position of left) if (!right.has(position)) return false
  return true
}

const currentResourceSnapshots = (resources: PauseProgressObservationResources) =>
  resources.integrationTargets.changes.pipe(
    Stream.changesWith(
      (left, right) =>
        samePositions(left.heldResponsibilityPositions, right.heldResponsibilityPositions) &&
        samePositions(left.activeResponsibilityPositions, right.activeResponsibilityPositions)
    )
  )

const openRuntimeObservation = (runtime: DeliveryRuntimeObservationState): DeliveryRuntimeObservationState =>
  runtime._tag === "Closed" ? (runtime.final ?? DeliveryRuntimeObservationState.NotReady()) : runtime

type PauseProgressEmission = PauseProgressView | PauseNotApplied | PauseProgressProjectionConflict
type PauseProgressDomainError = PauseNotApplied | PauseObservationRunMismatch | PauseProgressProjectionConflict

/** Observes only current process-local facts; subscribing performs no tracker, Git, executor, or journal call. */
export const observePauseProgress = (
  resources: PauseProgressObservationResources,
  expectedRunId: RunId,
  acceptedBasis: PauseObservationAcceptedBasis | null,
  input: unknown
): Stream.Stream<
  PauseProgressView,
  Schema.SchemaError | PauseNotApplied | PauseObservationRunMismatch | PauseProgressProjectionConflict
> =>
  Stream.unwrap(
    Schema.decodeUnknownEffect(ControlDirectionSubject)(input).pipe(
      Effect.map((subject): Stream.Stream<PauseProgressView, PauseProgressDomainError> => {
        if (subject.runId !== expectedRunId) {
          return Stream.fail(new PauseObservationRunMismatch({ expectedRunId, requestedRunId: subject.runId }))
        }
        const minimumAcceptedAt = acceptedBasis?.latestAcceptedAt ?? null
        const runtimeObservations = Stream.unwrap(
          attachCurrentSignal(resources.runtimeObservation).pipe(
            Effect.map(({ changes, current }) => Stream.scoped(Stream.concat(Stream.make(current), changes)))
          )
        )
        return Stream.zipLatest(runtimeObservations, currentResourceSnapshots(resources)).pipe(
          Stream.takeUntil(([runtime]) => runtime._tag === "Closed"),
          Stream.map(([runtime, snapshot]) => [openRuntimeObservation(runtime), snapshot] as const),
          Stream.filter((entry): entry is [ReadyRuntimeObservation, IntegrationTargetResourceSnapshot] =>
            runtimeIncludesAcceptedPosition(entry[0], minimumAcceptedAt)
          ),
          Stream.map(([runtime, snapshot]) => pauseProgressViewOf(subject, runtime, snapshot)),
          Stream.mapAccum(
            () => false,
            (wasApplied, projection): readonly [boolean, ReadonlyArray<PauseProgressEmission>] => {
              if (projection._tag === "PauseProgressProjectionConflict") return [wasApplied, [projection]]
              if (projection._tag === "PauseProjectionNotApplied") {
                return wasApplied
                  ? [true, [{ _tag: "PauseNoLongerApplied", subject } satisfies PauseProgressView]]
                  : [false, [new PauseNotApplied({ subject })]]
              }
              return [true, [projection]]
            }
          ),
          Stream.flatMap((value) =>
            value._tag === "PauseNotApplied" || value._tag === "PauseProgressProjectionConflict"
              ? Stream.fail(value)
              : Stream.succeed(value)
          ),
          Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
          Stream.takeUntil(({ _tag }) => _tag === "PauseConfirmed" || _tag === "PauseNoLongerApplied")
        )
      })
    )
  )
