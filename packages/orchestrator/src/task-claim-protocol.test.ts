import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  controlledTrackerMutationLayer,
  OperationId,
  runTaskClaimAcquisitionProtocol,
  TaskClaimAcquisition,
  TaskClaimAcquisitionDidNotConverge,
  TaskClaimConflict,
  TaskClaimReadFailure,
  TaskClaimRequestFailure,
  TaskId,
  TrackerMutation
} from "./index.js"

const acquisition = TaskClaimAcquisition.make({
  operationId: OperationId.make("ambiguous-acquisition"),
  owner: ClaimOwner.make("claim-owner"),
  taskId: TaskId.make("claim-task"),
  token: ClaimToken.make("claim-token")
})

it.effect("rereads tracker authority after an ambiguously applied acquisition", () =>
  Effect.gen(function*() {
    const controlled = yield* TrackerMutation
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const requests = yield* Ref.make(0)
    const ambiguous = TrackerMutation.of({
      acquireTaskClaim: (request) =>
        Ref.update(calls, (current) => [...current, "acquire"]).pipe(
          Effect.andThen(controlled.acquireTaskClaim(request)),
          Effect.andThen(Ref.update(requests, (count) => count + 1)),
          Effect.andThen(Effect.fail(
            new TaskClaimRequestFailure({
              acquisition: request,
              detail: "response lost after GitHub accepted the claim",
              outcome: "Unknown"
            })
          ))
        ),
      readTaskClaim: (taskId) =>
        Ref.update(calls, (current) => [...current, "read"]).pipe(
          Effect.andThen(controlled.readTaskClaim(taskId))
        ),
      releaseTaskClaim: controlled.releaseTaskClaim
    })

    const claim = yield* runTaskClaimAcquisitionProtocol(
      ambiguous,
      acquisition
    )

    expect(claim).toMatchObject({
      operationId: acquisition.operationId,
      owner: acquisition.owner,
      token: acquisition.token
    })
    expect(yield* Ref.get(requests)).toBe(1)
    expect(yield* Ref.get(calls)).toEqual(["read", "acquire", "read"])
  }).pipe(Effect.provide(controlledTrackerMutationLayer)))

it.effect("observes an uncertain prior request before repeating it", () =>
  Effect.gen(function*() {
    const controlled = yield* TrackerMutation
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const observed = TrackerMutation.of({
      acquireTaskClaim: (request) =>
        Ref.update(calls, (current) => [...current, "acquire"]).pipe(
          Effect.andThen(controlled.acquireTaskClaim(request))
        ),
      readTaskClaim: (taskId) =>
        Ref.update(calls, (current) => [...current, "read"]).pipe(
          Effect.andThen(controlled.readTaskClaim(taskId))
        ),
      releaseTaskClaim: controlled.releaseTaskClaim
    })

    yield* runTaskClaimAcquisitionProtocol(observed, acquisition)

    expect(yield* Ref.get(calls)).toEqual(["read", "acquire", "read"])
  }).pipe(Effect.provide(controlledTrackerMutationLayer)))

it.effect("stops when atomic acquisition reports a competing claim", () =>
  Effect.gen(function*() {
    const controlled = yield* TrackerMutation
    const foreign = TaskClaimAcquisition.make({
      ...acquisition,
      operationId: OperationId.make("foreign-operation"),
      owner: ClaimOwner.make("foreign-owner"),
      token: ClaimToken.make("foreign-token")
    })
    const conflicting = TrackerMutation.of({
      ...controlled,
      acquireTaskClaim: () =>
        Effect.fail(
          new TaskClaimConflict({
            attempted: acquisition,
            observed: ActiveTaskClaim.make(foreign)
          })
        )
    })

    const failure = yield* runTaskClaimAcquisitionProtocol(
      conflicting,
      acquisition
    ).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskClaimConflict)
  }).pipe(Effect.provide(controlledTrackerMutationLayer)))

it.effect("returns typed non-convergence after bounded unknown outcomes", () =>
  Effect.gen(function*() {
    const controlled = yield* TrackerMutation
    const unavailable = TrackerMutation.of({
      ...controlled,
      acquireTaskClaim: (request) =>
        Effect.fail(
          new TaskClaimRequestFailure({
            acquisition: request,
            detail: "outcome stays unknown",
            outcome: "Unknown"
          })
        )
    })

    const failure = yield* runTaskClaimAcquisitionProtocol(
      unavailable,
      acquisition
    ).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskClaimAcquisitionDidNotConverge)
    expect(failure).toMatchObject({ attempts: 3 })
  }).pipe(Effect.provide(controlledTrackerMutationLayer)))

it.effect("returns an already-owned exact claim without another mutation", () =>
  Effect.gen(function*() {
    const tracker = yield* TrackerMutation
    const expected = yield* tracker.acquireTaskClaim(acquisition)
    const noMutation = TrackerMutation.of({
      ...tracker,
      acquireTaskClaim: () => Effect.die("unexpected repeated mutation")
    })

    expect(yield* runTaskClaimAcquisitionProtocol(noMutation, acquisition)).toEqual(expected)
  }).pipe(Effect.provide(controlledTrackerMutationLayer)))

it.effect("rejects a competing claim discovered by the initial observation", () =>
  Effect.gen(function*() {
    const tracker = yield* TrackerMutation
    const foreign = TaskClaimAcquisition.make({
      ...acquisition,
      operationId: OperationId.make("observed-foreign-operation"),
      owner: ClaimOwner.make("observed-foreign-owner"),
      token: ClaimToken.make("observed-foreign-token")
    })
    yield* tracker.acquireTaskClaim(foreign)

    const failure = yield* runTaskClaimAcquisitionProtocol(
      tracker,
      acquisition
    ).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskClaimConflict)
  }).pipe(Effect.provide(controlledTrackerMutationLayer)))

it.effect("preserves non-request acquisition failures", () =>
  Effect.gen(function*() {
    const tracker = yield* TrackerMutation
    const failed = TrackerMutation.of({
      ...tracker,
      acquireTaskClaim: () =>
        Effect.fail(
          new TaskClaimReadFailure({
            detail: "claim observation failed inside mutation",
            taskId: acquisition.taskId
          })
        )
    })

    const failure = yield* runTaskClaimAcquisitionProtocol(
      failed,
      acquisition
    ).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskClaimReadFailure)
  }).pipe(Effect.provide(controlledTrackerMutationLayer)))
