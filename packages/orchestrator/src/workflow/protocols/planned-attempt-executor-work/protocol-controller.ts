import {
  plannedAttemptExecutorCorrelationKey,
  samePlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Context, Deferred, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"

/** Process-local structural identity of one exact Run and planned attempt protocol guard. */
const PlannedAttemptProtocolGuardKey = Schema.NonEmptyString.pipe(Schema.brand("PlannedAttemptProtocolGuardKey"))
type PlannedAttemptProtocolGuardKey = typeof PlannedAttemptProtocolGuardKey.Type

const plannedAttemptProtocolGuardKey = (
  correlation: PlannedAttemptExecutorCorrelation
): PlannedAttemptProtocolGuardKey =>
  PlannedAttemptProtocolGuardKey.make(plannedAttemptExecutorCorrelationKey(correlation))

const PlannedAttemptProtocolPermitTypeId: unique symbol = Symbol.for("@dalph/PlannedAttemptProtocolPermit")

/** Opaque process-local capability proving exclusive ownership of one exact planned-attempt protocol. */
// eslint-disable-next-line functional/no-mixed-types -- The capability carries exact-attempt identity alongside the guarded intent operation and its lifecycle effects.
export interface PlannedAttemptProtocolPermit {
  readonly [PlannedAttemptProtocolPermitTypeId]: typeof PlannedAttemptProtocolPermitTypeId
  readonly activate: Effect.Effect<"Active" | "Released">
  /** Records a durable protocol fact without consuming the ambiguity-crossing intent boundary. */
  readonly recordFact: <A, E, R>(append: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** Commits the ambiguity-crossing intent and prevents terminal preemption until its owner releases. */
  readonly commitIntent: <A, E, R>(append: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly release: Effect.Effect<void>
}

export interface PlannedAttemptProtocolControllerService {
  readonly reserve: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<Option.Option<PlannedAttemptProtocolPermit>>
  readonly withPermit: <A, E, R>(
    correlation: PlannedAttemptExecutorCorrelation,
    use: (permit: PlannedAttemptProtocolPermit) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>
  readonly withTerminalPermit: <A, E, R>(
    correlation: PlannedAttemptExecutorCorrelation,
    use: () => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>
}

/** Owns all process-local exclusion between executor protocol changes and exact-attempt abandonment. */
export class PlannedAttemptProtocolController extends Context.Service<
  PlannedAttemptProtocolController,
  PlannedAttemptProtocolControllerService
>()("@dalph/PlannedAttemptProtocolController") {}

interface ProtocolOwner {
  readonly _tag: "ProtocolOwner"
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly intentGate: Semaphore.Semaphore
  readonly phase: "IntentCommitted" | "PreIntentCancellable"
  readonly released: Deferred.Deferred<void>
}

/** Whether Terminal must restore or finish the exact pre-intent protocol owner it displaced. */
type TerminalPreemption =
  | { readonly _tag: "None" }
  | { readonly _tag: "Released"; readonly owner: ProtocolOwner }
  | { readonly _tag: "Retained"; readonly owner: ProtocolOwner }

interface TerminalOwner {
  readonly _tag: "TerminalOwner"
  readonly completed: Deferred.Deferred<void>
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly preemption: TerminalPreemption
  readonly released: Deferred.Deferred<void>
}

type GuardOwner = ProtocolOwner | TerminalOwner

const ownersWith = (
  owners: ReadonlyMap<PlannedAttemptProtocolGuardKey, GuardOwner>,
  key: PlannedAttemptProtocolGuardKey,
  owner: GuardOwner
): ReadonlyMap<PlannedAttemptProtocolGuardKey, GuardOwner> => new Map([...owners, [key, owner] as const])

const ownersWithout = (
  owners: ReadonlyMap<PlannedAttemptProtocolGuardKey, GuardOwner>,
  key: PlannedAttemptProtocolGuardKey
): ReadonlyMap<PlannedAttemptProtocolGuardKey, GuardOwner> =>
  new Map([...owners].filter(([candidate]) => candidate !== key))

type IntentCommitAttempt<A> =
  | { readonly _tag: "Committed"; readonly value: A }
  | { readonly _tag: "Preempted"; readonly terminal: TerminalOwner }

type FactRecordAttempt<A> =
  | { readonly _tag: "Recorded"; readonly value: A }
  | { readonly _tag: "Preempted"; readonly terminal: TerminalOwner }

type TerminalAcquireDecision =
  | { readonly _tag: "Acquired"; readonly owner: TerminalOwner }
  | { readonly _tag: "Retry" }
  | { readonly _tag: "Wait"; readonly released: Deferred.Deferred<void> }

interface GuardState {
  readonly owners: ReadonlyMap<PlannedAttemptProtocolGuardKey, GuardOwner>
}

const sameOwner = (left: GuardOwner | undefined, right: GuardOwner): boolean =>
  left?._tag === right._tag && left.released === right.released

const terminalPreemptedOwner = (current: GuardOwner | undefined, owner: ProtocolOwner): TerminalOwner | undefined =>
  current?._tag === "TerminalOwner" &&
  current.preemption._tag !== "None" &&
  current.preemption.owner.released === owner.released
    ? current
    : undefined

/** Constructs one empty controller; process restart constructs another and reconstructs truth only from the journal. */
export const makePlannedAttemptProtocolController = Effect.fn("PlannedAttemptProtocolController.make")(function* () {
  const state = yield* Ref.make<GuardState>({ owners: new Map() })

  const permitOf = (
    correlation: PlannedAttemptExecutorCorrelation,
    key: PlannedAttemptProtocolGuardKey,
    initialOwner: ProtocolOwner
  ): PlannedAttemptProtocolPermit => {
    const activate: Effect.Effect<"Active" | "Released"> = Effect.suspend(() =>
      Ref.get(state).pipe(
        Effect.flatMap((current) => {
          const owner = current.owners.get(key)
          if (sameOwner(owner, initialOwner)) return Effect.succeed("Active" as const)
          const terminal = terminalPreemptedOwner(owner, initialOwner)
          return terminal === undefined
            ? Effect.succeed("Released" as const)
            : Deferred.await(terminal.completed).pipe(Effect.andThen(activate))
        })
      )
    )
    const commitIntent = <A, E, R>(append: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
      const attempt: Effect.Effect<IntentCommitAttempt<A>, E, R> = initialOwner.intentGate.withPermit(
        Ref.get(state).pipe(
          Effect.flatMap((current): Effect.Effect<IntentCommitAttempt<A>, E, R> => {
            const owner = current.owners.get(key)
            if (sameOwner(owner, initialOwner) && owner?._tag === "ProtocolOwner") {
              return append.pipe(
                Effect.flatMap((value) =>
                  Ref.update(state, (latest) => {
                    const currentOwner = latest.owners.get(key)
                    if (!sameOwner(currentOwner, initialOwner) || currentOwner?._tag !== "ProtocolOwner") {
                      return latest
                    }
                    return { owners: ownersWith(latest.owners, key, { ...currentOwner, phase: "IntentCommitted" }) }
                  }).pipe(Effect.as({ _tag: "Committed" as const, value } satisfies IntentCommitAttempt<A>))
                )
              )
            }
            const terminal = terminalPreemptedOwner(owner, initialOwner)
            return terminal === undefined ? Effect.interrupt : Effect.succeed({ _tag: "Preempted" as const, terminal })
          })
        )
      )
      return attempt.pipe(
        Effect.flatMap((result) =>
          result._tag === "Committed"
            ? Effect.succeed(result.value)
            : Deferred.await(result.terminal.completed).pipe(Effect.andThen(commitIntent(append)))
        )
      )
    }
    const recordFact = <A, E, R>(append: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
      const attempt: Effect.Effect<FactRecordAttempt<A>, E, R> = initialOwner.intentGate.withPermit(
        Ref.get(state).pipe(
          Effect.flatMap((current): Effect.Effect<FactRecordAttempt<A>, E, R> => {
            const owner = current.owners.get(key)
            if (sameOwner(owner, initialOwner) && owner?._tag === "ProtocolOwner") {
              return append.pipe(Effect.map((value) => ({ _tag: "Recorded" as const, value })))
            }
            const terminal = terminalPreemptedOwner(owner, initialOwner)
            return terminal === undefined ? Effect.interrupt : Effect.succeed({ _tag: "Preempted" as const, terminal })
          })
        )
      )
      return attempt.pipe(
        Effect.flatMap((result) =>
          result._tag === "Recorded"
            ? Effect.succeed(result.value)
            : Deferred.await(result.terminal.completed).pipe(Effect.andThen(recordFact(append)))
        )
      )
    }
    return {
      [PlannedAttemptProtocolPermitTypeId]: PlannedAttemptProtocolPermitTypeId,
      activate,
      recordFact,
      commitIntent,
      correlation,
      release: Ref.modify(state, (current) => {
        const owner = current.owners.get(key)
        if (sameOwner(owner, initialOwner)) {
          return ["Released" as const, { owners: ownersWithout(current.owners, key) }] as const
        }
        const terminal = terminalPreemptedOwner(owner, initialOwner)
        if (terminal === undefined || terminal.preemption._tag !== "Retained") {
          return ["NoOp" as const, current] as const
        }
        return [
          "Deferred" as const,
          {
            owners: ownersWith(current.owners, key, {
              ...terminal,
              preemption: { _tag: "Released", owner: terminal.preemption.owner }
            })
          }
        ] as const
      }).pipe(
        Effect.flatMap((release) =>
          release === "Released" ? Deferred.succeed(initialOwner.released, undefined) : Effect.void
        )
      )
    }
  }

  const tryAcquire = Effect.fn("PlannedAttemptProtocolController.tryAcquire")(function* (
    correlation: PlannedAttemptExecutorCorrelation
  ) {
    const key = plannedAttemptProtocolGuardKey(correlation)
    const intentGate = yield* Semaphore.make(1)
    const released = yield* Deferred.make<void>()
    const owner: ProtocolOwner = {
      _tag: "ProtocolOwner",
      correlation,
      intentGate,
      phase: "PreIntentCancellable",
      released
    }
    const acquired = yield* Ref.modify(state, (current) => {
      if (current.owners.has(key)) return [false, current] as const
      return [true, { owners: ownersWith(current.owners, key, owner) }] as const
    })
    return acquired ? Option.some(permitOf(correlation, key, owner)) : Option.none()
  })

  const acquire = Effect.fn("PlannedAttemptProtocolController.acquire")(function* (
    correlation: PlannedAttemptExecutorCorrelation
  ): Effect.fn.Return<PlannedAttemptProtocolPermit> {
    const reserved = yield* tryAcquire(correlation)
    if (Option.isSome(reserved)) return reserved.value
    const occupied = yield* Ref.get(state).pipe(
      Effect.map((current) => current.owners.get(plannedAttemptProtocolGuardKey(correlation)))
    )
    if (occupied !== undefined) yield* Deferred.await(occupied.released)
    return yield* acquire(correlation)
  })

  const acquireTerminal = Effect.fn("PlannedAttemptProtocolController.acquireTerminal")(function* (
    correlation: PlannedAttemptExecutorCorrelation
  ): Effect.fn.Return<TerminalOwner> {
    const key = plannedAttemptProtocolGuardKey(correlation)
    const current = yield* Ref.get(state).pipe(Effect.map((snapshot) => snapshot.owners.get(key)))
    if (current?._tag === "TerminalOwner") {
      yield* Deferred.await(current.released)
      return yield* acquireTerminal(correlation)
    }
    const completed = yield* Deferred.make<void>()
    const released = yield* Deferred.make<void>()
    const terminal = (preemption: TerminalPreemption): TerminalOwner => ({
      _tag: "TerminalOwner",
      completed,
      correlation,
      preemption,
      released
    })
    if (current === undefined) {
      const owner = terminal({ _tag: "None" })
      const acquired = yield* Ref.modify(state, (snapshot) => {
        if (snapshot.owners.has(key)) return [false, snapshot] as const
        return [true, { owners: ownersWith(snapshot.owners, key, owner) }] as const
      })
      return acquired ? owner : yield* acquireTerminal(correlation)
    }
    const decision = yield* current.intentGate.withPermit(
      Ref.modify(state, (snapshot): readonly [TerminalAcquireDecision, GuardState] => {
        const latest = snapshot.owners.get(key)
        if (!sameOwner(latest, current) || latest?._tag !== "ProtocolOwner") {
          return [{ _tag: "Retry" as const }, snapshot] as const
        }
        if (latest.phase === "IntentCommitted") {
          return [{ _tag: "Wait" as const, released: latest.released }, snapshot] as const
        }
        const owner = terminal({ _tag: "Retained", owner: latest })
        return [{ _tag: "Acquired" as const, owner }, { owners: ownersWith(snapshot.owners, key, owner) }] as const
      })
    )
    if (decision._tag === "Acquired") return decision.owner
    if (decision._tag === "Wait") yield* Deferred.await(decision.released)
    return yield* acquireTerminal(correlation)
  })

  const releaseTerminal = Effect.fn("PlannedAttemptProtocolController.releaseTerminal")(function* (
    owner: TerminalOwner
  ) {
    const key = plannedAttemptProtocolGuardKey(owner.correlation)
    const released = yield* Ref.modify(state, (current): readonly [TerminalOwner | false, GuardState] => {
      const active = current.owners.get(key)
      if (active?._tag !== "TerminalOwner" || active.released !== owner.released) return [false, current] as const
      const owners =
        active.preemption._tag === "None" || active.preemption._tag === "Released"
          ? ownersWithout(current.owners, key)
          : ownersWith(current.owners, key, active.preemption.owner)
      return [active, { owners }] as const
    })
    if (released !== false) {
      yield* Deferred.succeed(released.released, undefined)
      if (released.preemption._tag === "Released") {
        yield* Deferred.succeed(released.preemption.owner.released, undefined)
      }
      yield* Deferred.succeed(released.completed, undefined)
    }
  })

  return PlannedAttemptProtocolController.of({
    reserve: tryAcquire,
    withPermit: (correlation, use) => Effect.acquireUseRelease(acquire(correlation), use, ({ release }) => release),
    withTerminalPermit: (correlation, use) =>
      Effect.acquireUseRelease(acquireTerminal(correlation), use, releaseTerminal)
  })
})

export const plannedAttemptProtocolControllerLayer = Layer.effect(
  PlannedAttemptProtocolController,
  makePlannedAttemptProtocolController()
)

/** Runs trusted internal protocol work only when the capability belongs to the same exact attempt. */
export const withPlannedAttemptProtocolPermit = <A, E, R>(
  permit: PlannedAttemptProtocolPermit,
  correlation: PlannedAttemptExecutorCorrelation,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  samePlannedAttemptExecutorCorrelation(permit.correlation, correlation)
    ? permit.activate.pipe(Effect.flatMap((activation) => (activation === "Released" ? Effect.interrupt : effect)))
    : Effect.die(
        new Error(
          `planned-attempt protocol permit ${permit.correlation.runId}/${permit.correlation.attemptId} cannot guard ${correlation.runId}/${correlation.attemptId}`
        )
      )
