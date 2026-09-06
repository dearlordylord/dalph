import {
  PlannedAttemptExecutorLifecycleObservation,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorProjection,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Context, Deferred, Effect, Ref, Semaphore, Stream } from "effect"
import * as Scope from "effect/Scope"
import {
  type publishPlannedAttemptExecutorProjectionResultWithPermit,
  type PlannedAttemptExecutorObservationResult
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import type { PlannedAttemptProtocolPermit } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import type { ApplicationExiting } from "../application-exit/lifecycle-decision.js"

type PassiveProjectionPublicationError = Effect.Error<
  ReturnType<typeof publishPlannedAttemptExecutorProjectionResultWithPermit>
>

export interface PassivePlannedAttemptProjectionPublicationService {
  readonly publish: (
    plannedAttempt: PlannedTaskAttempt,
    projection: PlannedAttemptExecutorProjection
  ) => Effect.Effect<PlannedAttemptExecutorObservationResult, PassiveProjectionPublicationError | ApplicationExiting>
  readonly publishWithPermit: (
    permit: PlannedAttemptProtocolPermit,
    plannedAttempt: PlannedTaskAttempt,
    projection: PlannedAttemptExecutorProjection
  ) => Effect.Effect<PlannedAttemptExecutorObservationResult, PassiveProjectionPublicationError>
}

/** Process-owned sink; only it can enter the serialized Journal protocol. */
export class PassivePlannedAttemptProjectionPublication extends Context.Service<
  PassivePlannedAttemptProjectionPublication,
  PassivePlannedAttemptProjectionPublicationService
>()("@dalph/PassivePlannedAttemptProjectionPublication") {}

// eslint-disable-next-line functional/no-mixed-types -- The exact attempt subject travels with its two capability-narrow publication continuations.
interface PassivePlannedAttemptObservationAttachment {
  readonly plannedAttempt: PlannedTaskAttempt
  /** Uses the caller's already-admitted permit only before `attach` returns. */
  readonly publishCurrent: (
    projection: PlannedAttemptExecutorProjection
  ) => Effect.Effect<PlannedAttemptExecutorObservationResult, PassiveProjectionPublicationError>
  /** Process-scoped exact-candidate sink retained by the waiting fiber. */
  readonly publishChange: (
    projection: PlannedAttemptExecutorProjection
  ) => Effect.Effect<void, PassiveProjectionPublicationError | ApplicationExiting>
}

export interface PassivePlannedAttemptObserverService {
  readonly attach: (
    input: PassivePlannedAttemptObservationAttachment
  ) => Effect.Effect<PlannedAttemptExecutorObservationResult, PassiveProjectionPublicationError>
}

/** Mandatory process-scoped owner installed by every workflow executor composition. */
export class PassivePlannedAttemptObserver extends Context.Service<
  PassivePlannedAttemptObserver,
  PassivePlannedAttemptObserverService
>()("@dalph/PassivePlannedAttemptObserver") {}

const isExecuting = (projection: PlannedAttemptExecutorProjection): boolean =>
  projection._tag === "Exact" && projection.report._tag === "ExecutorWorkExecuting"

/**
 * Owns at most one process-local wait for each exact executor correlation.
 * It can read lifecycle projections and publish candidates; it has no Journal,
 * tracker, command, scheduling, or task-selection capability.
 */
export const makePassivePlannedAttemptObserver = Effect.fn("PassivePlannedAttemptObserver.make")(function* () {
  const lifecycle = yield* PlannedAttemptExecutorLifecycleObservation
  const scope = yield* Effect.scope
  const owners = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorObservationResult>>(new Map())
  const attachmentGate = yield* Semaphore.make(1)

  const attach = Effect.fn("PassivePlannedAttemptObserver.attach")(function* (
    input: PassivePlannedAttemptObservationAttachment
  ) {
    const correlation = plannedAttemptExecutorCorrelation(input.plannedAttempt)
    const key = plannedAttemptExecutorCorrelationKey(correlation)
    return yield* attachmentGate.withPermit(
      Effect.gen(function* () {
        const existing = (yield* Ref.get(owners)).get(key)
        if (existing !== undefined) return existing
        const attachment = yield* lifecycle.attach(correlation).pipe(Effect.provideService(Scope.Scope, scope))
        const current = yield* input.publishCurrent(attachment.current).pipe(Effect.onError(() => attachment.close))
        if (!isExecuting(attachment.current)) {
          yield* attachment.close
          return current
        }
        const attached = yield* Deferred.make<void>()
        const wait = Deferred.await(attached).pipe(
          Effect.andThen(attachment.changes.pipe(Stream.take(1), Stream.runForEach(input.publishChange))),
          Effect.ensuring(
            attachment.close.pipe(
              Effect.andThen(
                attachmentGate.withPermit(
                  Ref.update(owners, (results) => new Map([...results].filter(([id]) => id !== key)))
                )
              )
            )
          )
        )
        yield* wait.pipe(Effect.forkIn(scope))
        yield* Ref.update(owners, (results) => new Map(results).set(key, current))
        yield* Deferred.succeed(attached, undefined)
        return current
      })
    )
  })

  return { attach } satisfies PassivePlannedAttemptObserverService
})
