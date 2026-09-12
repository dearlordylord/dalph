import { Effect, Exit, Fiber, Queue } from "effect"
import type { AuthoredObservationCapture, AuthoredObservationMoment } from "./authored-runner.js"

/** Commands in the test-owned projection worker, never workflow occurrences. */
type PlaybackCommand =
  | { readonly _tag: "Capture"; readonly capture: AuthoredObservationCapture }
  | { readonly _tag: "Finish" }

const previousObservationMomentOffset = -1

export interface AuthoredObservationPlaybackWork {
  readonly enqueuedCaptures: number
  readonly projectedCaptures: number
  readonly projectedPublications: number
  readonly retainedMomentNodes: number
}

/** One Run's ordered playback; callbacks receive individual immutable moments, not its builder. */
export const makeAuthoredObservationPlayback = Effect.fn("AuthoredCassette.makeObservationPlayback")(function* <E>(
  evaluate: (
    capture: AuthoredObservationCapture,
    previous: AuthoredObservationMoment | null
  ) => Effect.Effect<AuthoredObservationMoment, E>,
  onMoment?: (moment: AuthoredObservationMoment) => Effect.Effect<void, E>
) {
  let acceptingCaptures = true
  const commands = yield* Effect.acquireRelease(Queue.unbounded<PlaybackCommand>(), (queue) =>
    Effect.sync(() => {
      acceptingCaptures = false
    }).pipe(Effect.andThen(Queue.shutdown(queue)))
  )
  let enqueuedCaptures = 0
  let projectedCaptures = 0
  let projectedPublications = 0
  const worker = yield* Effect.gen(function* () {
    const moments: Array<AuthoredObservationMoment> = []
    let command = yield* Queue.take(commands)
    while (command._tag === "Capture") {
      projectedCaptures++
      if (command.capture._tag === "DeliveryPublicationCaptured") projectedPublications++
      const moment = yield* evaluate(command.capture, moments.at(previousObservationMomentOffset) ?? null)
      moments.push(moment)
      if (onMoment !== undefined) yield* onMoment(moment)
      command = yield* Queue.take(commands)
    }
    return {
      moments: Object.freeze(moments),
      work: Object.freeze({
        enqueuedCaptures,
        projectedCaptures,
        projectedPublications,
        retainedMomentNodes: moments.length
      }) satisfies AuthoredObservationPlaybackWork
    }
  }).pipe(
    Effect.onExit(() =>
      Effect.sync(() => {
        acceptingCaptures = false
      })
    ),
    Effect.forkScoped
  )
  return {
    // Called inside the capture Ref.modify turn so the queue and exported
    // capture ledger retain the same order even if another fiber appends.
    appendUnsafe: (capture: AuthoredObservationCapture): boolean => {
      if (!acceptingCaptures) return false
      const accepted = Queue.offerUnsafe(commands, { _tag: "Capture", capture })
      if (accepted) enqueuedCaptures++
      return accepted
    },
    // A normal Finish is not a competing execution result. Only failure wins
    // supervision; interrupting this waiter does not interrupt the owned worker.
    awaitFailure: Fiber.await(worker).pipe(
      Effect.flatMap((exit) => (Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.never))
    ),
    finish: Effect.gen(function* () {
      acceptingCaptures = false
      yield* Queue.offer(commands, { _tag: "Finish" })
      return yield* Fiber.join(worker)
    })
  }
})
