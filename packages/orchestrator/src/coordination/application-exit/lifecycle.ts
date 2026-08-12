import { Context, Deferred, Effect, Layer, Ref } from "effect"
import { ApplicationExiting, type ApplicationExitResult, type ForwardOwnerKind } from "./lifecycle-decision.js"

type ForwardOwnerId = number

interface ForwardOwnerState {
  readonly kind: ForwardOwnerKind
  readonly phase: "Preparing" | "Registered"
}

interface ApplicationExitLifecycleState {
  readonly nextOwnerId: ForwardOwnerId
  readonly owners: ReadonlyMap<ForwardOwnerId, ForwardOwnerState>
  readonly phase: "Exiting" | "Serving"
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
  /** Every request closes the same cutoff and receives the same application-level result Deferred. */
  readonly requestExit: Effect.Effect<Deferred.Deferred<ApplicationExitResult>>
  readonly completeExit: (result: ApplicationExitResult) => Effect.Effect<boolean>
  readonly snapshot: Effect.Effect<ApplicationExitLifecycleSnapshot>
}

/** The single process-wide lifecycle boundary shared by control calls and delivery admission. */
export class ApplicationExitLifecycle extends Context.Service<
  ApplicationExitLifecycle,
  ApplicationExitLifecycleService
>()("@dalph/ApplicationExitLifecycle") {}

export const makeApplicationExitLifecycle = Effect.fn("ApplicationExitLifecycle.make")(function* () {
  const result = yield* Deferred.make<ApplicationExitResult>()
  const state = yield* Ref.make<ApplicationExitLifecycleState>({ nextOwnerId: 0, owners: new Map(), phase: "Serving" })

  const removeOwner = (ownerId: ForwardOwnerId) =>
    Ref.update(state, (current) => {
      if (!current.owners.has(ownerId)) return current
      const owners = new Map(current.owners)
      owners.delete(ownerId)
      return { ...current, owners }
    })

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

  const requestExit = Ref.modify(
    state,
    (current) => [result, current.phase === "Exiting" ? current : { ...current, phase: "Exiting" as const }] as const
  )

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
    completeExit: (exitResult) => Deferred.succeed(result, exitResult),
    prepareForwardOwner,
    requestExit,
    snapshot
  })
})

export const applicationExitLifecycleLayer = Layer.effect(ApplicationExitLifecycle, makeApplicationExitLifecycle())
