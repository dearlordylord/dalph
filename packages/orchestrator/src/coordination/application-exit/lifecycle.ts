import { Clock, Context, Deferred, Effect, Layer, Ref } from "effect"
import { ApplicationExiting, type ApplicationExitResult, type ForwardOwnerKind } from "./lifecycle-decision.js"

type ForwardOwnerId = number

interface ForwardOwnerState {
  readonly kind: ForwardOwnerKind
  readonly phase: "Preparing" | "Registered"
}

interface ApplicationExitLifecycleStateFields {
  readonly nextOwnerId: ForwardOwnerId
  readonly owners: ReadonlyMap<ForwardOwnerId, ForwardOwnerState>
}

type ApplicationExitLifecycleState =
  | (ApplicationExitLifecycleStateFields & { readonly phase: "Serving" })
  | (ApplicationExitLifecycleStateFields & { readonly cutoffAt: bigint; readonly phase: "Exiting" })

export interface ApplicationExitRequest {
  readonly cutoffAt: bigint
  readonly first: boolean
  readonly result: Deferred.Deferred<ApplicationExitResult>
}

interface ExitRequestDecision extends Omit<ApplicationExitRequest, "result"> {
  readonly ownersDrained: boolean
}

/** The process-local permission to finish registering one exact forward-progress owner. */
export interface ForwardOwnerPreparation {
  readonly cancel: Effect.Effect<void>
  readonly register: Effect.Effect<ForwardOwnerLease, ApplicationExiting>
}

/** One owner admitted before the application Exit cutoff; release is idempotent. */
export interface ForwardOwnerLease {
  readonly kind: ForwardOwnerKind
  readonly release: Effect.Effect<void>
}

export interface ApplicationExitLifecycleSnapshot {
  readonly cutoffClosed: boolean
  readonly preparingOwnerCount: number
  readonly registeredOwnerCount: number
}

export interface ApplicationExitLifecycleService {
  /** Atomically rejects late work or records its preparation before any reservation is acquired. */
  readonly prepareForwardOwner: (kind: ForwardOwnerKind) => Effect.Effect<ForwardOwnerPreparation, ApplicationExiting>
  /** Every request closes or joins one cutoff, monotonic deadline, driver, and result. */
  readonly requestExit: Effect.Effect<ApplicationExitRequest>
  readonly completeExit: (result: ApplicationExitResult) => Effect.Effect<boolean>
  readonly awaitExitDriverFinished: Effect.Effect<void>
  readonly completeExitDriver: Effect.Effect<boolean>
  /** Completes only after Exit closed admission and every pre-cutoff owner released. */
  readonly awaitForwardOwnersReleased: Effect.Effect<void>
  /** Lets the application runtime stop its ordinary scope without persisting an Exit fact. */
  readonly awaitExitRequested: Effect.Effect<void>
  readonly snapshot: Effect.Effect<ApplicationExitLifecycleSnapshot>
}

/** The single process-wide lifecycle boundary shared by control calls and delivery admission. */
export class ApplicationExitLifecycle extends Context.Service<
  ApplicationExitLifecycle,
  ApplicationExitLifecycleService
>()("@dalph/ApplicationExitLifecycle") {}

export const makeApplicationExitLifecycle = Effect.fn("ApplicationExitLifecycle.make")(function* () {
  const result = yield* Deferred.make<ApplicationExitResult>()
  const exitDriverFinished = yield* Deferred.make<void>()
  const exitRequested = yield* Deferred.make<void>()
  const forwardOwnersReleased = yield* Deferred.make<void>()
  const state = yield* Ref.make<ApplicationExitLifecycleState>({ nextOwnerId: 0, owners: new Map(), phase: "Serving" })

  const removeOwner = (ownerId: ForwardOwnerId) =>
    Ref.modify(state, (current) => {
      if (!current.owners.has(ownerId)) return [false, current] as const
      const owners = new Map(current.owners)
      owners.delete(ownerId)
      return [current.phase === "Exiting" && owners.size === 0, { ...current, owners }] as const
    }).pipe(Effect.flatMap((drained) => (drained ? Deferred.succeed(forwardOwnersReleased, undefined) : Effect.void)))

  const prepareForwardOwner = Effect.fn("ApplicationExitLifecycle.prepareForwardOwner")((kind: ForwardOwnerKind) =>
    Effect.gen(function* () {
      const ownerId = yield* Ref.modify(state, (current) => {
        if (current.phase === "Exiting") return [undefined, current] as const
        const ownerId = current.nextOwnerId
        const owners = new Map(current.owners).set(ownerId, { kind, phase: "Preparing" } as const)
        return [ownerId, { ...current, nextOwnerId: ownerId + 1, owners }] as const
      })
      if (ownerId === undefined) return yield* new ApplicationExiting()
      const cancel = removeOwner(ownerId)
      const register = Effect.gen(function* () {
        const registered = yield* Ref.modify(state, (registrationState) => {
          const owner = registrationState.owners.get(ownerId)
          if (registrationState.phase === "Exiting" || owner?.phase !== "Preparing") {
            return [false, registrationState] as const
          }
          const registeredOwners = new Map(registrationState.owners).set(ownerId, {
            kind,
            phase: "Registered"
          } as const)
          return [true, { ...registrationState, owners: registeredOwners }] as const
        })
        if (!registered) return yield* new ApplicationExiting()
        return { kind, release: removeOwner(ownerId) } satisfies ForwardOwnerLease
      })
      return { cancel, register } satisfies ForwardOwnerPreparation
    })
  )

  const requestExit = Effect.gen(function* () {
    const requestedAt = yield* Clock.monotonicTimeNanos
    const decision = yield* Ref.modify(
      state,
      (current): readonly [ExitRequestDecision, ApplicationExitLifecycleState] => {
        if (current.phase === "Exiting") {
          return [{ cutoffAt: current.cutoffAt, first: false, ownersDrained: false }, current]
        }
        return [
          { cutoffAt: requestedAt, first: true, ownersDrained: current.owners.size === 0 },
          { ...current, cutoffAt: requestedAt, phase: "Exiting" as const }
        ]
      }
    )
    if (decision.first) yield* Deferred.succeed(exitRequested, undefined)
    if (decision.ownersDrained) yield* Deferred.succeed(forwardOwnersReleased, undefined)
    return { cutoffAt: decision.cutoffAt, first: decision.first, result } satisfies ApplicationExitRequest
  })

  const snapshot = Ref.get(state).pipe(
    Effect.map(
      (current): ApplicationExitLifecycleSnapshot => ({
        cutoffClosed: current.phase === "Exiting",
        preparingOwnerCount: [...current.owners.values()].filter(({ phase }) => phase === "Preparing").length,
        registeredOwnerCount: [...current.owners.values()].filter(({ phase }) => phase === "Registered").length
      })
    )
  )

  return ApplicationExitLifecycle.of({
    awaitExitDriverFinished: Deferred.await(exitDriverFinished),
    awaitExitRequested: Deferred.await(exitRequested),
    awaitForwardOwnersReleased: Deferred.await(forwardOwnersReleased),
    completeExitDriver: Deferred.succeed(exitDriverFinished, undefined),
    completeExit: (exitResult) => Deferred.succeed(result, exitResult),
    prepareForwardOwner,
    requestExit,
    snapshot
  })
})

export const applicationExitLifecycleLayer = Layer.effect(ApplicationExitLifecycle, makeApplicationExitLifecycle())
