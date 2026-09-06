import { Effect } from "effect"
import { makeTaskWorkSpecification, type TaskId } from "@dalph/contracts"
import {
  projectTrackerSnapshot,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  type TrackerTarget
} from "@dalph/orchestrator"
import type { AuthoredOperationCausalContext, StoryCursor } from "./authored-cursor.js"

export const trackerReadFailure = (
  detail: string,
  reason: TrackerAdapterReadFailureReason = TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
) =>
  new TrackerAdapterReadError({
    context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
    detail,
    reason
  })

export const consumeControlledTrackerGraph = Effect.fn("AuthoredCassette.consumeControlledTrackerGraph")(function* (
  cursor: StoryCursor,
  target: TrackerTarget,
  context?: AuthoredOperationCausalContext
) {
  const item = yield* cursor
    .consumeTrackerGraphFor(target, context)
    .pipe(
      Effect.mapError((failure) =>
        trackerReadFailure(
          `${failure._tag} at story position ${failure.storyPosition}`,
          TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({})
        )
      )
    )
  if (item._tag === "TrackerGraphReadFailed") {
    return yield* trackerReadFailure(`authored cassette tracker graph read failed: ${item.reason}`)
  }
  const projection = projectTrackerSnapshot(item.graph)
  return projection._tag === "Valid"
    ? projection.snapshot
    : yield* trackerReadFailure(
        `authored cassette tracker graph is invalid: ${projection.issues.map(({ _tag }) => _tag).join(", ")}`,
        TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({})
      )
})

export const consumeControlledTaskWorkSpecification = Effect.fn(
  "AuthoredCassette.consumeControlledTaskWorkSpecification"
)(function* (cursor: StoryCursor, taskId: TaskId, context?: AuthoredOperationCausalContext) {
  const item = yield* cursor
    .consumeTaskWorkSpecificationFor(taskId, context)
    .pipe(
      Effect.mapError((failure) =>
        trackerReadFailure(
          `${failure._tag} at story position ${failure.storyPosition}`,
          TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({})
        )
      )
    )
  return makeTaskWorkSpecification(item)
})
