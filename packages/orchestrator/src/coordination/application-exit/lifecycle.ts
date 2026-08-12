import { Clock, Context, Data, Deferred, Effect, Ref } from "effect"
import type {
  InterruptibleWorkflowBoundaryExecution,
  InterruptibleWorkflowBoundaryFamily,
  InterruptibleWorkflowBoundaryIntent
} from "../../workflow/interpretation/interpreter.js"
import { ApplicationExiting, type ApplicationExitResult, type ForwardOwnerKind } from "./lifecycle-decision.js"

type ForwardOwnerId = number

/** The exact durable intent whose outside result may remain unknown after Exit interrupts the local wait. */
export type InterruptibleBoundaryFamily = InterruptibleWorkflowBoundaryFamily
export type InterruptibleBoundaryIntent = InterruptibleWorkflowBoundaryIntent

/** The current local tracker/Git call state retained only while its forward owner is live. */
export type InterruptibleBoundaryOwnerSnapshot = Data.TaggedEnum<{
  NoBoundaryCall: Record<never, never>
  AwaitingBoundaryResult: { readonly intent: InterruptibleBoundaryIntent }
  BoundaryResultProduced: { readonly intent: InterruptibleBoundaryIntent }
  BoundaryResultRecorded: { readonly intent: InterruptibleBoundaryIntent }
  RecoverableAmbiguity: { readonly intent: InterruptibleBoundaryIntent }
}>

export const InterruptibleBoundaryOwnerSnapshot = Data.taggedEnum<InterruptibleBoundaryOwnerSnapshot>()

type ForwardOwnerState =
  | { readonly kind: ForwardOwnerKind; readonly phase: "Preparing" }
  | {
      readonly boundary: InterruptibleBoundaryOwnerSnapshot
      readonly kind: "InterruptibleBoundary"
      readonly phase: "Registered"
    }
  | { readonly kind: Exclude<ForwardOwnerKind, "InterruptibleBoundary">; readonly phase: "Registered" }

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

interface ForwardOwnerLeaseBase {
  readonly release: Effect.Effect<void>
}

/** One admitted tracker/Git owner whose exact intent and local call phase control Exit interruption. */
export interface InterruptibleForwardOwnerLease extends ForwardOwnerLeaseBase, InterruptibleWorkflowBoundaryExecution {
  readonly kind: "InterruptibleBoundary"
  readonly snapshot: Effect.Effect<InterruptibleBoundaryOwnerSnapshot>
}

/** One owner admitted before the application Exit cutoff; release is idempotent. */
export type ForwardOwnerLease =
  | InterruptibleForwardOwnerLease
  | (ForwardOwnerLeaseBase & { readonly kind: Exclude<ForwardOwnerKind, "InterruptibleBoundary"> })

export interface ApplicationExitLifecycleSnapshot {
  readonly cutoffClosed: boolean
  readonly preparingOwnerCount: number
  readonly registeredOwnerCount: number
}

/** Least authority required to admit and observe process-local forward-progress ownership. */
export interface ApplicationExitAdmissionService {
  /** Atomically rejects late work or records its preparation before any reservation is acquired. */
  readonly prepareForwardOwner: (kind: ForwardOwnerKind) => Effect.Effect<ForwardOwnerPreparation, ApplicationExiting>
  /** Acquires one registered owner without exposing the preparation state to callers that reserve nothing. */
  readonly acquireForwardOwner: (kind: ForwardOwnerKind) => Effect.Effect<ForwardOwnerLease, ApplicationExiting>
  readonly snapshot: Effect.Effect<ApplicationExitLifecycleSnapshot>
}

/** The application-owned admission capability injected into isolated runtime compositions. */
export class ApplicationExitAdmission extends Context.Service<
  ApplicationExitAdmission,
  ApplicationExitAdmissionService
>()("@dalph/ApplicationExitAdmission") {}

export interface ApplicationExitLifecycleService {
  readonly admission: ApplicationExitAdmissionService
  /** Every request closes or joins one cutoff, monotonic deadline, driver, and result. */
  readonly requestExit: Effect.Effect<ApplicationExitRequest>
  readonly completeExit: (result: ApplicationExitResult) => Effect.Effect<boolean>
  readonly awaitExitDriverFinished: Effect.Effect<void>
  readonly completeExitDriver: Effect.Effect<boolean>
  /** Completes only after Exit closed admission and every pre-cutoff owner released. */
  readonly awaitForwardOwnersReleased: Effect.Effect<void>
  /** Lets the application runtime stop its ordinary scope without persisting an Exit fact. */
  readonly awaitExitRequested: Effect.Effect<void>
}

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

  const interruptibleSnapshot = (ownerId: ForwardOwnerId) =>
    Ref.get(state).pipe(
      Effect.map((current) => {
        const owner = current.owners.get(ownerId)
        return owner?.phase === "Registered" && owner.kind === "InterruptibleBoundary"
          ? owner.boundary
          : InterruptibleBoundaryOwnerSnapshot.NoBoundaryCall()
      })
    )

  const updateInterruptibleBoundary = (
    ownerId: ForwardOwnerId,
    update: (current: InterruptibleBoundaryOwnerSnapshot) => InterruptibleBoundaryOwnerSnapshot
  ) =>
    Ref.update(state, (current) => {
      const owner = current.owners.get(ownerId)
      if (owner?.phase !== "Registered" || owner.kind !== "InterruptibleBoundary") return current
      return {
        ...current,
        owners: new Map(current.owners).set(ownerId, { ...owner, boundary: update(owner.boundary) })
      }
    })

  const runInterruptibleBoundary = <A, E, R, B, E2, R2>(
    ownerId: ForwardOwnerId,
    intent: InterruptibleBoundaryIntent,
    call: Effect.Effect<A, E, R>,
    recordResult: (result: A) => Effect.Effect<B, E2, R2>
  ): Effect.Effect<B, E | E2, R | R2> =>
    Effect.gen(function* () {
      const admitted = yield* Ref.modify(state, (current) => {
        const owner = current.owners.get(ownerId)
        if (
          current.phase !== "Serving" ||
          owner?.phase !== "Registered" ||
          owner.kind !== "InterruptibleBoundary" ||
          owner.boundary._tag !== "NoBoundaryCall"
        ) {
          return [false, current] as const
        }
        const owners = new Map(current.owners).set(ownerId, {
          ...owner,
          boundary: InterruptibleBoundaryOwnerSnapshot.AwaitingBoundaryResult({ intent })
        })
        return [true, { ...current, owners }] as const
      })
      if (!admitted) return yield* Effect.interrupt

      const interrupted = { _tag: "Interrupted" as const }
      const boundaryResult = yield* Effect.raceFirst(
        call.pipe(Effect.map((value) => ({ _tag: "Result" as const, value }))),
        Deferred.await(exitRequested).pipe(Effect.as(interrupted))
      )
      if (boundaryResult._tag === "Interrupted") {
        yield* updateInterruptibleBoundary(ownerId, () =>
          InterruptibleBoundaryOwnerSnapshot.RecoverableAmbiguity({ intent })
        )
        return yield* Effect.interrupt
      }

      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          yield* updateInterruptibleBoundary(ownerId, () =>
            InterruptibleBoundaryOwnerSnapshot.BoundaryResultProduced({ intent })
          )
          const recorded = yield* recordResult(boundaryResult.value)
          yield* updateInterruptibleBoundary(ownerId, () =>
            InterruptibleBoundaryOwnerSnapshot.BoundaryResultRecorded({ intent })
          )
          const cutoffClosed = (yield* Ref.get(state)).phase === "Exiting"
          return cutoffClosed ? yield* Effect.interrupt : recorded
        })
      )
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
          const registered =
            kind === "InterruptibleBoundary"
              ? ({ boundary: InterruptibleBoundaryOwnerSnapshot.NoBoundaryCall(), kind, phase: "Registered" } as const)
              : ({ kind, phase: "Registered" } as const)
          const registeredOwners = new Map(registrationState.owners).set(ownerId, registered)
          return [true, { ...registrationState, owners: registeredOwners }] as const
        })
        if (!registered) return yield* new ApplicationExiting()
        return kind === "InterruptibleBoundary"
          ? ({
              kind,
              release: removeOwner(ownerId),
              run: (intent, call, recordResult) => runInterruptibleBoundary(ownerId, intent, call, recordResult),
              snapshot: interruptibleSnapshot(ownerId)
            } satisfies InterruptibleForwardOwnerLease)
          : ({ kind, release: removeOwner(ownerId) } satisfies ForwardOwnerLease)
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

  const admission = {
    acquireForwardOwner: Effect.fn("ApplicationExitLifecycle.acquireForwardOwner")((kind: ForwardOwnerKind) =>
      prepareForwardOwner(kind).pipe(
        Effect.flatMap((preparation) => preparation.register.pipe(Effect.onError(() => preparation.cancel)))
      )
    ),
    prepareForwardOwner,
    snapshot
  } satisfies ApplicationExitAdmissionService

  return {
    admission,
    awaitExitDriverFinished: Deferred.await(exitDriverFinished),
    awaitExitRequested: Deferred.await(exitRequested),
    awaitForwardOwnersReleased: Deferred.await(forwardOwnersReleased),
    completeExitDriver: Deferred.succeed(exitDriverFinished, undefined),
    completeExit: (exitResult) => Deferred.succeed(result, exitResult),
    requestExit
  } satisfies ApplicationExitLifecycleService
})
