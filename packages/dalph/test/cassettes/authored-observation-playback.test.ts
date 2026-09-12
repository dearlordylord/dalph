import { RunId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Ref, Schema } from "effect"
import { expect } from "vitest"
import {
  FixtureTarget,
  initialRunPolicyRevision,
  RunControlPolicy,
  TaskWorkCapacity,
  trackerGraphReadProposalOf,
  type DeliveryRelationInputBundle
} from "@dalph/orchestrator"
import { makeFreshTaskAdmissionTestBasis } from "../../../orchestrator/test/support/fresh-task-admission.js"
import { AuthoredRunActivationOrdinal } from "../../src/cassettes/authored-domain.js"
import { makeAuthoredObservationPlayback } from "../../src/cassettes/authored-observation-playback.js"
import {
  AuthoredObservationCaptureOrder,
  AuthoredStoryPosition,
  evaluateAuthoredObservationCapture,
  type AuthoredObservationCapture,
  type AuthoredObservationMoment
} from "../../src/cassettes/authored-runner.js"

const runId = RunId.make("playback-helper-run")
const target = FixtureTarget.make("playback-helper-target")
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})
const bundle: DeliveryRelationInputBundle = {
  actionInputs: {
    freshTaskCandidates: [],
    proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
    reflectionProposals: [],
    runtimeFacts: {
      acceptedAt: null,
      cancellationApplied: false,
      pauseCoverage: {
        _tag: "PauseCoverageGraphNotEstablished",
        applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
      },
      quiescence: { _tag: "TrackerReconfirmationAllowed" },
      taskWork: makeFreshTaskAdmissionTestBasis({ capacity: policy.taskExecutionCapacity, runId })
    },
    trackerGraphProposals: [
      trackerGraphReadProposalOf({ acceptedAt: null, purpose: "EstablishCurrentGraph", runId, target })
    ]
  },
  publication: { exactEvidence: [], graph: { _tag: "GraphNotEstablished" }, policy }
}

const captureAt = (order: number): AuthoredObservationCapture => {
  const correlation = {
    activationOrdinal: AuthoredRunActivationOrdinal.make(1),
    captureOrder: AuthoredObservationCaptureOrder.make(order),
    storyPosition: AuthoredStoryPosition.make(0)
  }
  return order % 2 === 0
    ? {
        ...correlation,
        _tag: "DeliveryPublicationCaptured",
        publication: {
          activationOrdinal: correlation.activationOrdinal,
          storyPosition: correlation.storyPosition,
          bundle
        }
      }
    : { ...correlation, _tag: "DeliveryRuntimeOwnersCaptured", liveOwners: [] }
}

const exactOrder = (moments: ReadonlyArray<AuthoredObservationMoment>, orders: ReadonlyArray<number>) =>
  moments.length === orders.length && moments.every((moment, index) => moment.captureOrder === orders[index])

class PlaybackProjectionFailed extends Schema.TaggedError<PlaybackProjectionFailed>()("PlaybackProjectionFailed", {
  captureOrder: Schema.Int
}) {}

type PlaybackProjectionError =
  | Effect.Error<ReturnType<typeof evaluateAuthoredObservationCapture>>
  | PlaybackProjectionFailed

it.effect("Finish drains every pre-cut capture once in FIFO order and closes admission", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const evaluated = yield* Ref.make<ReadonlyArray<number>>([])
      const playback = yield* makeAuthoredObservationPlayback((capture, previous) =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(Ref.update(evaluated, (orders) => [...orders, capture.captureOrder])),
          Effect.andThen(evaluateAuthoredObservationCapture(capture, previous))
        )
      )
      for (const order of [1, 2, 3]) expect(playback.appendUnsafe(captureAt(order))).toBe(true)
      yield* Deferred.await(entered)
      const finished = yield* playback.finish.pipe(Effect.forkScoped)
      yield* Deferred.succeed(release, undefined)
      const result = yield* Fiber.join(finished)
      expect(yield* Ref.get(evaluated)).toEqual([1, 2, 3])
      expect(exactOrder(result.moments, [1, 2, 3])).toBe(true)
      expect(result.work).toEqual({
        enqueuedCaptures: 3,
        projectedCaptures: 3,
        projectedPublications: 1,
        retainedMomentNodes: 3
      })
      expect(Object.isFrozen(result.moments)).toBe(true)
      expect(Object.isFrozen(result.work)).toBe(true)
      expect(playback.appendUnsafe(captureAt(4))).toBe(false)
      expect(result.moments).toHaveLength(3)
      expect(result.work.enqueuedCaptures).toBe(3)
    })
  )
)

it.effect("supervision and Finish retain the exact typed projector failure without partial success", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const failure = new PlaybackProjectionFailed({ captureOrder: 2 })
      const playback = yield* makeAuthoredObservationPlayback(
        (capture, previous): Effect.Effect<AuthoredObservationMoment, PlaybackProjectionError> =>
          capture.captureOrder === 2 ? Effect.fail(failure) : evaluateAuthoredObservationCapture(capture, previous)
      )
      expect(playback.appendUnsafe(captureAt(1))).toBe(true)
      expect(playback.appendUnsafe(captureAt(2))).toBe(true)
      const supervised = yield* Effect.exit(playback.awaitFailure)
      const finished = yield* Effect.exit(playback.finish)
      expect(Exit.isFailure(supervised)).toBe(true)
      expect(Exit.isFailure(finished)).toBe(true)
      if (Exit.isFailure(supervised) && Exit.isFailure(finished)) {
        expect(Cause.squash(supervised.cause)).toBe(failure)
        expect(Cause.squash(finished.cause)).toBe(failure)
        expect(supervised.cause.reasons).toHaveLength(1)
        expect(supervised.cause.reasons[0]?._tag).toBe("Fail")
        expect(finished.cause).toBe(supervised.cause)
      }
      expect(playback.appendUnsafe(captureAt(3))).toBe(false)
    })
  )
)

it.effect("the first genuine callback defect wins before a later projector can run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const defect = { message: "first moment callback failed" }
      const later = new PlaybackProjectionFailed({ captureOrder: 2 })
      const evaluated = yield* Ref.make<ReadonlyArray<number>>([])
      const playback = yield* makeAuthoredObservationPlayback(
        (capture, previous): Effect.Effect<AuthoredObservationMoment, PlaybackProjectionError> => {
          const projected: Effect.Effect<AuthoredObservationMoment, PlaybackProjectionError> =
            capture.captureOrder === 2 ? Effect.fail(later) : evaluateAuthoredObservationCapture(capture, previous)
          return Ref.update(evaluated, (orders) => [...orders, capture.captureOrder]).pipe(Effect.andThen(projected))
        },
        () => Effect.die(defect)
      )
      expect(playback.appendUnsafe(captureAt(1))).toBe(true)
      expect(playback.appendUnsafe(captureAt(2))).toBe(true)
      const supervised = yield* Effect.exit(playback.awaitFailure)
      const finished = yield* Effect.exit(playback.finish)
      expect(Exit.isFailure(supervised)).toBe(true)
      expect(Exit.isFailure(finished)).toBe(true)
      if (Exit.isFailure(supervised) && Exit.isFailure(finished)) {
        expect(Cause.squash(supervised.cause)).toBe(defect)
        expect(Cause.squash(finished.cause)).toBe(defect)
        expect(supervised.cause.reasons).toHaveLength(1)
        expect(supervised.cause.reasons[0]?._tag).toBe("Die")
        expect(finished.cause).toBe(supervised.cause)
      }
      expect(yield* Ref.get(evaluated)).toEqual([1])
    })
  )
)

it.effect("interrupting the owner settles its worker and closes the queue without a join hang", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const stopped = yield* Deferred.make<void>()
    const created = yield* Deferred.make<Effect.Success<ReturnType<typeof makeAuthoredObservationPlayback>>>()
    const owner = yield* Effect.scoped(
      Effect.gen(function* () {
        const playback = yield* makeAuthoredObservationPlayback(() =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(stopped, undefined))
          )
        )
        yield* Deferred.succeed(created, playback)
        expect(playback.appendUnsafe(captureAt(1))).toBe(true)
        return yield* playback.awaitFailure
      })
    ).pipe(Effect.forkScoped)
    const playback = yield* Deferred.await(created)
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(owner)
    yield* Deferred.await(stopped)
    expect(playback.appendUnsafe(captureAt(2))).toBe(false)
    const finish = yield* Effect.exit(playback.finish)
    expect(Exit.isFailure(finish)).toBe(true)
    if (Exit.isFailure(finish)) expect(Cause.hasInterrupts(finish.cause)).toBe(true)
  })
)

it.effect("N and 2N accepted captures have exact linear projection and retained-moment counts", () =>
  Effect.gen(function* () {
    for (const size of [32, 64])
      yield* Effect.scoped(
        Effect.gen(function* () {
          const visits = yield* Ref.make(0)
          const playback = yield* makeAuthoredObservationPlayback((capture, previous) =>
            Ref.update(visits, (count) => count + 1).pipe(
              Effect.andThen(evaluateAuthoredObservationCapture(capture, previous))
            )
          )
          const orders = Array.from({ length: size }, (_, index) => index + 1)
          for (const order of orders) expect(playback.appendUnsafe(captureAt(order))).toBe(true)
          const result = yield* playback.finish
          expect(exactOrder(result.moments, orders)).toBe(true)
          expect(yield* Ref.get(visits)).toBe(size)
          expect(result.work).toEqual({
            enqueuedCaptures: size,
            projectedCaptures: size,
            projectedPublications: size / 2,
            retainedMomentNodes: size
          })
        })
      )
  })
)

it.effect("the exact chronology oracle exposes duplicate reordered and dropped captures", () =>
  Effect.gen(function* () {
    for (const orders of [
      [1, 2, 2, 3],
      [2, 1, 3],
      [1, 3]
    ])
      yield* Effect.scoped(
        Effect.gen(function* () {
          const playback = yield* makeAuthoredObservationPlayback(evaluateAuthoredObservationCapture)
          for (const order of orders) expect(playback.appendUnsafe(captureAt(order))).toBe(true)
          const result = yield* playback.finish
          expect(exactOrder(result.moments, [1, 2, 3])).toBe(false)
          expect(result.work.enqueuedCaptures).toBe(orders.length)
          expect(result.work.projectedCaptures).toBe(orders.length)
        })
      )
  })
)
