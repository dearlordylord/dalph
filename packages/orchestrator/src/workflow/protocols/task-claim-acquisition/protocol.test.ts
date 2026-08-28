import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { TaskId } from "@dalph/contracts"
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
  type TaskClaimObservation,
  TaskClaimReadFailure,
  TaskClaimRequestFailure,
  TaskTrackerMutationThrottled,
  TrackerMutation,
  UnclaimedTask
} from "../../../index.js"

type TaskClaimBoundaryCall = "read" | "acquire"

const recordTaskClaimBoundaryCall = (
  calls: Ref.Ref<ReadonlyArray<TaskClaimBoundaryCall>>,
  call: TaskClaimBoundaryCall
) => Ref.update(calls, (current) => [...current, call])

const acquisition = TaskClaimAcquisition.make({
  operationId: OperationId.make("ambiguous-acquisition"),
  owner: ClaimOwner.make("claim-owner"),
  taskId: TaskId.make("claim-task"),
  token: ClaimToken.make("claim-token")
})

it.effect("rereads tracker authority after an ambiguously applied acquisition", () =>
  Effect.gen(function* () {
    const controlled = yield* TrackerMutation
    const calls = yield* Ref.make<ReadonlyArray<TaskClaimBoundaryCall>>([])
    const requests = yield* Ref.make(0)
    const ambiguous = TrackerMutation.of({
      acquireTaskClaim: (request) =>
        recordTaskClaimBoundaryCall(calls, "acquire").pipe(
          Effect.andThen(controlled.acquireTaskClaim(request)),
          Effect.andThen(Ref.update(requests, (count) => count + 1)),
          Effect.andThen(
            Effect.fail(
              new TaskClaimRequestFailure({
                acquisition: request,
                detail: "response lost after GitHub accepted the claim",
                outcome: "Unknown"
              })
            )
          )
        ),
      readTaskClaim: (taskId): Effect.Effect<TaskClaimObservation, TaskClaimReadFailure> =>
        recordTaskClaimBoundaryCall(calls, "read").pipe(Effect.andThen(controlled.readTaskClaim(taskId))),
      releaseTaskClaim: controlled.releaseTaskClaim
    })

    const claim = yield* runTaskClaimAcquisitionProtocol(ambiguous, acquisition)

    expect(claim).toMatchObject({
      operationId: acquisition.operationId,
      owner: acquisition.owner,
      token: acquisition.token
    })
    expect(yield* Ref.get(requests)).toBe(1)
    expect(yield* Ref.get(calls)).toEqual(["read", "acquire", "read"])
  }).pipe(Effect.provide(controlledTrackerMutationLayer))
)

it.effect("observes an uncertain prior request before repeating it", () =>
  Effect.gen(function* () {
    const controlled = yield* TrackerMutation
    const calls = yield* Ref.make<ReadonlyArray<TaskClaimBoundaryCall>>([])
    const observed = TrackerMutation.of({
      acquireTaskClaim: (request) =>
        recordTaskClaimBoundaryCall(calls, "acquire").pipe(Effect.andThen(controlled.acquireTaskClaim(request))),
      readTaskClaim: (taskId) =>
        recordTaskClaimBoundaryCall(calls, "read").pipe(Effect.andThen(controlled.readTaskClaim(taskId))),
      releaseTaskClaim: controlled.releaseTaskClaim
    })

    yield* runTaskClaimAcquisitionProtocol(observed, acquisition)

    expect(yield* Ref.get(calls)).toEqual(["read", "acquire", "read"])
  }).pipe(Effect.provide(controlledTrackerMutationLayer))
)

it.effect("stops when atomic acquisition reports a competing claim", () =>
  Effect.gen(function* () {
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
        Effect.fail(new TaskClaimConflict({ attempted: acquisition, observed: ActiveTaskClaim.make(foreign) }))
    })

    const failure = yield* runTaskClaimAcquisitionProtocol(conflicting, acquisition).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskClaimConflict)
  }).pipe(Effect.provide(controlledTrackerMutationLayer))
)

it.effect("returns typed non-convergence after bounded unknown outcomes", () =>
  Effect.gen(function* () {
    const controlled = yield* TrackerMutation
    const calls = yield* Ref.make<ReadonlyArray<TaskClaimBoundaryCall>>([])
    const requests = yield* Ref.make(0)
    const unavailable = TrackerMutation.of({
      ...controlled,
      acquireTaskClaim: (request) =>
        recordTaskClaimBoundaryCall(calls, "acquire").pipe(
          Effect.andThen(Ref.update(requests, (count) => count + 1)),
          Effect.andThen(
            Effect.fail(
              new TaskClaimRequestFailure({ acquisition: request, detail: "outcome stays unknown", outcome: "Unknown" })
            )
          )
        ),
      readTaskClaim: (taskId) =>
        recordTaskClaimBoundaryCall(calls, "read").pipe(Effect.andThen(controlled.readTaskClaim(taskId)))
    })

    const failure = yield* runTaskClaimAcquisitionProtocol(unavailable, acquisition).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskClaimAcquisitionDidNotConverge)
    expect(failure).toMatchObject({ attempts: 3 })
    expect(yield* Ref.get(requests)).toBe(3)
    expect(yield* Ref.get(calls)).toEqual(["read", "acquire", "read", "acquire", "read", "acquire", "read"])
  }).pipe(Effect.provide(controlledTrackerMutationLayer))
)

it.effect("reads tracker after the third and final ambiguous acquisition request", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<TaskClaimBoundaryCall>>([])
    const reads = yield* Ref.make(0)
    const tracker = TrackerMutation.of({
      acquireTaskClaim: (request) =>
        recordTaskClaimBoundaryCall(calls, "acquire").pipe(
          Effect.andThen(
            Effect.fail(
              new TaskClaimRequestFailure({
                acquisition: request,
                detail: "response lost after GitHub accepted the claim",
                outcome: "Unknown"
              })
            )
          )
        ),
      readTaskClaim: (taskId): Effect.Effect<TaskClaimObservation, TaskClaimReadFailure> =>
        Ref.updateAndGet(reads, (count) => count + 1).pipe(
          Effect.map(
            (readNumber): TaskClaimObservation =>
              readNumber === 4 ? ActiveTaskClaim.make(acquisition) : UnclaimedTask.make({ taskId })
          ),
          Effect.tap(() => recordTaskClaimBoundaryCall(calls, "read"))
        ),
      releaseTaskClaim: () => Effect.void
    })

    const claim = yield* runTaskClaimAcquisitionProtocol(tracker, acquisition)

    expect(claim).toEqual(ActiveTaskClaim.make(acquisition))
    expect(yield* Ref.get(reads)).toBe(4)
    expect(yield* Ref.get(calls)).toEqual(["read", "acquire", "read", "acquire", "read", "acquire", "read"])
    expect(
      yield* Ref.get(calls).pipe(Effect.map((entries) => entries.filter((entry) => entry === "acquire")))
    ).toHaveLength(3)
  })
)

it.effect("returns a conflict when the final reconciliation observes a foreign claim", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<TaskClaimBoundaryCall>>([])
    const reads = yield* Ref.make(0)
    const foreign = ActiveTaskClaim.make({
      ...acquisition,
      operationId: OperationId.make("final-foreign-operation"),
      owner: ClaimOwner.make("final-foreign-owner"),
      token: ClaimToken.make("final-foreign-token")
    })
    const tracker = TrackerMutation.of({
      acquireTaskClaim: (request) =>
        recordTaskClaimBoundaryCall(calls, "acquire").pipe(
          Effect.andThen(
            Effect.fail(
              new TaskClaimRequestFailure({
                acquisition: request,
                detail: "response remained unknown",
                outcome: "Unknown"
              })
            )
          )
        ),
      readTaskClaim: (taskId) =>
        Effect.gen(function* () {
          const readNumber = yield* Ref.updateAndGet(reads, (count) => count + 1)
          yield* recordTaskClaimBoundaryCall(calls, "read")
          return readNumber === 4 ? foreign : UnclaimedTask.make({ taskId })
        }),
      releaseTaskClaim: () => Effect.void
    })

    const failure = yield* runTaskClaimAcquisitionProtocol(tracker, acquisition).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(TaskClaimConflict)
    expect(failure).toMatchObject({ attempted: acquisition, observed: foreign })
    expect(yield* Ref.get(reads)).toBe(4)
    expect(yield* Ref.get(calls)).toEqual(["read", "acquire", "read", "acquire", "read", "acquire", "read"])
  })
)

it.effect("returns a read failure when the final reconciliation is unreadable", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<TaskClaimBoundaryCall>>([])
    const reads = yield* Ref.make(0)
    const tracker = TrackerMutation.of({
      acquireTaskClaim: (request) =>
        recordTaskClaimBoundaryCall(calls, "acquire").pipe(
          Effect.andThen(
            Effect.fail(
              new TaskClaimRequestFailure({
                acquisition: request,
                detail: "response remained unknown",
                outcome: "Unknown"
              })
            )
          )
        ),
      readTaskClaim: (taskId) =>
        Effect.gen(function* () {
          const readNumber = yield* Ref.updateAndGet(reads, (count) => count + 1)
          yield* recordTaskClaimBoundaryCall(calls, "read")
          if (readNumber === 4) {
            return yield* new TaskClaimReadFailure({ detail: "GitHub response was malformed", taskId })
          }
          return UnclaimedTask.make({ taskId })
        }),
      releaseTaskClaim: () => Effect.void
    })

    const failure = yield* runTaskClaimAcquisitionProtocol(tracker, acquisition).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(TaskClaimReadFailure)
    expect(failure).toMatchObject({ taskId: acquisition.taskId })
    expect(yield* Ref.get(reads)).toBe(4)
    expect(yield* Ref.get(calls)).toEqual(["read", "acquire", "read", "acquire", "read", "acquire", "read"])
  })
)

it.effect("returns an already-owned exact claim without another mutation", () =>
  Effect.gen(function* () {
    const tracker = yield* TrackerMutation
    const expected = yield* tracker.acquireTaskClaim(acquisition)
    const noMutation = TrackerMutation.of({
      ...tracker,
      acquireTaskClaim: () => Effect.die("unexpected repeated mutation")
    })

    expect(yield* runTaskClaimAcquisitionProtocol(noMutation, acquisition)).toEqual(expected)
  }).pipe(Effect.provide(controlledTrackerMutationLayer))
)

it.effect("rejects a competing claim discovered by the initial observation", () =>
  Effect.gen(function* () {
    const tracker = yield* TrackerMutation
    const foreign = TaskClaimAcquisition.make({
      ...acquisition,
      operationId: OperationId.make("observed-foreign-operation"),
      owner: ClaimOwner.make("observed-foreign-owner"),
      token: ClaimToken.make("observed-foreign-token")
    })
    yield* tracker.acquireTaskClaim(foreign)

    const failure = yield* runTaskClaimAcquisitionProtocol(tracker, acquisition).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskClaimConflict)
  }).pipe(Effect.provide(controlledTrackerMutationLayer))
)

it.effect("preserves non-request acquisition failures", () =>
  Effect.gen(function* () {
    const tracker = yield* TrackerMutation
    const failed = TrackerMutation.of({
      ...tracker,
      acquireTaskClaim: () =>
        Effect.fail(
          new TaskClaimReadFailure({ detail: "claim observation failed inside mutation", taskId: acquisition.taskId })
        )
    })

    const failure = yield* runTaskClaimAcquisitionProtocol(failed, acquisition).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskClaimReadFailure)
  }).pipe(Effect.provide(controlledTrackerMutationLayer))
)

it.effect("claim acquisition throttling sends one mutation and restart reads before using the same intent", () =>
  Effect.gen(function* () {
    const current = yield* Ref.make<TaskClaimObservation>(UnclaimedTask.make({ taskId: acquisition.taskId }))
    const throttled = yield* Ref.make(true)
    const calls = yield* Ref.make<ReadonlyArray<TaskClaimBoundaryCall>>([])
    const requests = yield* Ref.make<ReadonlyArray<TaskClaimAcquisition>>([])
    const tracker = TrackerMutation.of({
      acquireTaskClaim: (request) =>
        recordTaskClaimBoundaryCall(calls, "acquire").pipe(
          Effect.andThen(Ref.update(requests, (observed) => [...observed, request])),
          Effect.flatMap(() => Ref.get(throttled)),
          Effect.flatMap((isThrottled) =>
            isThrottled
              ? Effect.fail(
                  new TaskTrackerMutationThrottled({
                    detail: "GitHub primary rate limit rejected the GraphQL request",
                    operation: "AcquireTaskClaim",
                    operationId: request.operationId,
                    retry: null
                  })
                )
              : Ref.set(current, ActiveTaskClaim.make(request)).pipe(Effect.as(ActiveTaskClaim.make(request)))
          )
        ),
      readTaskClaim: () => recordTaskClaimBoundaryCall(calls, "read").pipe(Effect.andThen(Ref.get(current))),
      releaseTaskClaim: () => Effect.void
    })

    const failure = yield* runTaskClaimAcquisitionProtocol(tracker, acquisition).pipe(Effect.flip)
    expect(failure).toEqual(
      new TaskTrackerMutationThrottled({
        detail: "GitHub primary rate limit rejected the GraphQL request",
        operation: "AcquireTaskClaim",
        operationId: acquisition.operationId,
        retry: null
      })
    )
    expect(yield* Ref.get(calls)).toEqual(["read", "acquire"])
    expect(yield* Ref.get(requests)).toEqual([acquisition])

    yield* Ref.set(throttled, false)
    expect(yield* runTaskClaimAcquisitionProtocol(tracker, acquisition)).toEqual(ActiveTaskClaim.make(acquisition))
    expect(yield* Ref.get(calls)).toEqual(["read", "acquire", "read", "acquire", "read"])
    expect(yield* Ref.get(requests)).toEqual([acquisition, acquisition])
  })
)
