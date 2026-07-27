import { Data, Deferred, Effect, Exit, Option, Queue, Ref, Schema } from "effect"
import type * as Scope from "effect/Scope"
import { SelectedTransitionIdentity as SelectedTransitionIdentitySchema } from "./domain.js"
import type { OperationId, RunId, SelectedTransitionIdentity } from "./domain.js"
import { FrontierExplanation, type RunnableFrontier, type RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "./selected-transition.js"
import { type TaskAdmissionController, transitionRequiresTaskAdmissionPosition } from "./task-admission-controller.js"

export type ActivationCause = Data.TaggedEnum<{
  AdmissionMayNowBePossible: Record<never, never>
  Restart: Record<never, never>
  Resume: Record<never, never>
  Startup: Record<never, never>
  WorkflowResultRecorded: Record<never, never>
}>

export const ActivationCause = Data.taggedEnum<ActivationCause>()

/** The scoped activation coordinator ended and cannot accept another signal. */
export class ActivationCoordinatorClosed extends Schema.TaggedErrorClass<ActivationCoordinatorClosed>()(
  "ActivationCoordinatorClosed",
  {}
) {}

/**
 * An internal second ownership registration for one exact selector result.
 * The controller recognizes the existing exact reservation and creates no
 * second position; the handoff starts no second runner.
 */
class DuplicateActivationOwnershipDefect extends Schema.TaggedErrorClass<DuplicateActivationOwnershipDefect>()(
  "DuplicateActivationOwnershipDefect",
  { selected: SelectedTransitionIdentitySchema }
) {}

export interface ActivationCoordinator {
  readonly signal: (
    cause: ActivationCause
  ) => Effect.Effect<void, ActivationCoordinatorClosed>
}

interface OwnedTransitionExecution {
  readonly recordIntent: (operationId: OperationId) => Effect.Effect<void>
}

type MakeActivationCoordinatorInput<E, R> = {
  readonly admissionController: TaskAdmissionController
  readonly readFrontier: Effect.Effect<RunnableFrontier, E, R>
  readonly runId: RunId
} & {
  readonly runTransition: (
    transition: RunnableFrontierTransition,
    execution: OwnedTransitionExecution
  ) => Effect.Effect<void, E, R>
}

interface ActivationOwnershipEntry {
  readonly operationId: Option.Option<OperationId>
  readonly selected: SelectedTransitionIdentity
  readonly transition: RunnableFrontierTransition
}

interface ActivationOwnershipSnapshot {
  readonly isolatedTransitionKeys: ReadonlySet<string>
  readonly owners: ReadonlyMap<string, ActivationOwnershipEntry>
}

const ownedTransitionKey = (
  runId: RunId,
  transition: RunnableFrontierTransition
): string => selectedTransitionKey(makeSelectedTransitionIdentity(runId, transition))

const excludeOwnedTransitions = (
  runId: RunId,
  frontier: RunnableFrontier,
  ownership: ReadonlyMap<string, ActivationOwnershipEntry>
): RunnableFrontier => {
  const projected = frontier.transitions.map((transition) => {
    const entry = ownership.get(ownedTransitionKey(runId, transition))
      ?? [...ownership.values()].find((candidate) =>
        "operationId" in transition
        && Option.getOrUndefined(candidate.operationId) === transition.operationId
      )
    return entry === undefined
      ? { explanation: null, transition }
      : {
        explanation: FrontierExplanation.ActivationInProgress({
          operationId: entry.operationId,
          taskId: transition.taskId
        }),
        transition: null
      }
  })
  return {
    explanations: [
      ...frontier.explanations,
      ...projected.flatMap(({ explanation }) => explanation === null ? [] : [explanation])
    ],
    transitions: projected.flatMap(({ transition }) => transition === null ? [] : [transition])
  }
}

/**
 * Internal process-local ownership registry shared by the live coordinator
 * and the closed M2 adapter. It is intentionally absent from package exports.
 */
export const makeActivationOwnershipRegistry = Effect.fn(
  "ActivationOwnershipRegistry.make"
)(function*(runId: RunId) {
  const owners = yield* Ref.make<ReadonlyMap<string, ActivationOwnershipEntry>>(
    new Map()
  )
  const isolatedTransitionKeys = yield* Ref.make<ReadonlySet<string>>(
    new Set()
  )
  return {
    bindOperation: (
      key: string,
      operationId: OperationId
    ) =>
      Ref.update(owners, (current) => {
        const owned = current.get(key)
        if (owned === undefined) return current
        return new Map(
          [...current].map(([candidateKey, candidate]) =>
            candidateKey === key
              ? [
                candidateKey,
                { ...candidate, operationId: Option.some(operationId) }
              ] as const
              : [candidateKey, candidate] as const
          )
        )
      }),
    exclude: Effect.fn("ActivationOwnershipRegistry.exclude")(
      function*(frontier: RunnableFrontier) {
        const snapshot = {
          isolatedTransitionKeys: yield* Ref.get(isolatedTransitionKeys),
          owners: yield* Ref.get(owners)
        }
        const withoutOwners = excludeOwnedTransitions(
          runId,
          frontier,
          snapshot.owners
        )
        return {
          explanations: withoutOwners.explanations,
          transitions: withoutOwners.transitions.filter(
            (transition) =>
              !snapshot.isolatedTransitionKeys.has(
                ownedTransitionKey(runId, transition)
              )
          )
        }
      }
    ),
    get: (key: string) => Ref.get(owners).pipe(Effect.map((current) => current.get(key))),
    isolate: (key: string) => Ref.update(isolatedTransitionKeys, (current) => new Set([...current, key])),
    register: (
      transition: RunnableFrontierTransition
    ) =>
      Ref.modify(owners, (current) => {
        const selected = makeSelectedTransitionIdentity(runId, transition)
        const key = selectedTransitionKey(selected)
        if (current.has(key)) return [undefined, current] as const
        const entry: ActivationOwnershipEntry = {
          operationId: "operationId" in transition
            ? Option.some(transition.operationId)
            : Option.none(),
          selected,
          transition
        }
        return [
          { entry, key },
          new Map([...current, [key, entry]])
        ] as const
      }),
    remove: (key: string) =>
      Ref.modify(owners, (current) => {
        const removed = current.get(key)
        return [
          removed,
          new Map([...current].filter(([candidateKey]) => candidateKey !== key))
        ] as const
      }),
    snapshot: (): Effect.Effect<ActivationOwnershipSnapshot> =>
      Effect.all({
        isolatedTransitionKeys: Ref.get(isolatedTransitionKeys),
        owners: Ref.get(owners)
      })
  } as const
})

/**
 * Creates one scoped coordinator. Its returned surface accepts only order-free
 * causes; selected transitions and ownership capabilities remain private.
 */
export const makeActivationCoordinator = Effect.fn(
  "ActivationCoordinator.make"
)(function*<E, R>(
  input: MakeActivationCoordinatorInput<E, R>
): Effect.fn.Return<ActivationCoordinator, never, Scope.Scope | R> {
  const scope = yield* Effect.scope
  const triggers = yield* Queue.dropping<ActivationCause>(1)
  const closed = yield* Ref.make(false)
  const signalAcknowledgements = yield* Ref.make<
    ReadonlyArray<Deferred.Deferred<void, ActivationCoordinatorClosed>>
  >([])
  const ownership = yield* makeActivationOwnershipRegistry(input.runId)

  const signal = Effect.fn("ActivationCoordinator.signal")(function*(cause: ActivationCause) {
    if (yield* Ref.get(closed)) return yield* new ActivationCoordinatorClosed()
    const acknowledgement = yield* Deferred.make<
      void,
      ActivationCoordinatorClosed
    >()
    yield* Ref.update(signalAcknowledgements, (current) => [
      ...current,
      acknowledgement
    ])
    yield* Queue.offer(triggers, cause)
    yield* Deferred.await(acknowledgement)
  })

  const runOwnedTransition = (
    key: string,
    entry: ActivationOwnershipEntry
  ): Effect.Effect<void, never, R> => {
    const recordIntent = Effect.fn("ActivationCoordinator.recordIntent")(
      function*(operationId: OperationId) {
        yield* Effect.uninterruptible(Effect.gen(function*() {
          // Bind the controller first. If that exact reservation is absent,
          // ownership remains pre-intent and finalization can still cancel it
          // by the immutable selection identity.
          if (transitionRequiresTaskAdmissionPosition(entry.transition)) {
            yield* input.admissionController.bindReservedPosition(
              entry.selected,
              operationId
            ).pipe(Effect.orDie)
          }
          yield* ownership.bindOperation(key, operationId)
        }))
      }
    )

    return input.runTransition(entry.transition, { recordIntent }).pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        Effect.gen(function*() {
          const owned = yield* ownership.get(key)
          if (
            owned !== undefined
            && Option.isNone(owned.operationId)
            && transitionRequiresTaskAdmissionPosition(owned.transition)
          ) {
            yield* input.admissionController.cancelReservedPosition(entry.selected)
              .pipe(Effect.orDie)
          } else if (
            owned !== undefined
            && Option.isSome(owned.operationId)
            && Exit.isSuccess(exit)
            && transitionRequiresTaskAdmissionPosition(owned.transition)
          ) {
            yield* input.admissionController.releaseTaskAdmissionPosition(
              owned.operationId.value
            ).pipe(Effect.orDie)
          }
          yield* ownership.remove(key)
          yield* signal(ActivationCause.WorkflowResultRecorded()).pipe(
            Effect.catchTag("ActivationCoordinatorClosed", () => Effect.void)
          )
        })
      )
    )
  }

  const handoff = Effect.fn("ActivationCoordinator.handoff")(
    (frontier: RunnableFrontier) =>
      Effect.uninterruptibleMask(() =>
        Effect.gen(function*() {
          const candidate = frontier.transitions[0]
          if (candidate === undefined) return false
          const candidateSelected = makeSelectedTransitionIdentity(
            input.runId,
            candidate
          )
          const candidateKey = selectedTransitionKey(candidateSelected)
          if ((yield* ownership.get(candidateKey)) !== undefined) {
            // The defect is raised and caught inside this exact-subject
            // supervisor. It remains a defect rather than an expected error,
            // while the serialized coordinator loop stays alive for C.
            yield* Effect.die(
              new DuplicateActivationOwnershipDefect({
                selected: candidateSelected
              })
            ).pipe(
              Effect.catchCause(() => ownership.isolate(candidateKey))
            )
            return false
          }
          const admission = yield* input.admissionController.admit(
            frontier,
            input.runId
          )
          const transition = admission.transitions[0]
          if (transition === undefined) return false
          const selected = makeSelectedTransitionIdentity(input.runId, transition)
          const key = selectedTransitionKey(selected)
          const registered = yield* ownership.register(transition)
          if (registered === undefined) {
            // No second reservation is cancelled here: a matching reservation
            // belongs to the existing exact owner. Isolate only this subject.
            yield* Effect.die(
              new DuplicateActivationOwnershipDefect({ selected })
            ).pipe(
              Effect.catchCause(() => ownership.isolate(key))
            )
            return false
          }
          const rollbackFailedStart = Effect.gen(function*() {
            const partialOwner = yield* ownership.get(registered.key)
            if (
              partialOwner !== undefined
              && Option.isNone(partialOwner.operationId)
              && transitionRequiresTaskAdmissionPosition(
                partialOwner.transition
              )
            ) {
              yield* input.admissionController.cancelReservedPosition(
                registered.entry.selected
              ).pipe(Effect.orDie)
            }
            yield* ownership.remove(registered.key)
          })
          yield* runOwnedTransition(
            registered.key,
            registered.entry
          ).pipe(
            Effect.forkIn(scope),
            Effect.onError(() => rollbackFailedStart)
          )
          return true
        })
      )
  )

  const runPass = Effect.fn("ActivationCoordinator.runPass")(function*() {
    const frontier = yield* input.readFrontier
    const selectable = yield* ownership.exclude(frontier)
    const started = yield* handoff(selectable)
    if (!started) return false
    // Let the newly scoped child reach its first boundary before this pass
    // acknowledges startup; deterministic clocks can then observe its schedule.
    yield* Effect.yieldNow
    return started
  })

  const runTriggeredPasses = Effect.fn("ActivationCoordinator.runTriggeredPasses")(
    function*() {
      for (;;) {
        yield* Queue.take(triggers)
        while (yield* runPass()) {
          // Each established handoff causes a fresh read before another choice.
        }
        const acknowledgements = yield* Ref.getAndSet(
          signalAcknowledgements,
          []
        )
        yield* Effect.forEach(
          acknowledgements,
          (acknowledgement) => Deferred.succeed(acknowledgement, undefined),
          { discard: true }
        )
      }
    }
  )

  yield* runTriggeredPasses().pipe(
    Effect.catchCause(() =>
      Effect.gen(function*() {
        yield* Ref.set(closed, true)
        const acknowledgements = yield* Ref.getAndSet(
          signalAcknowledgements,
          []
        )
        yield* Effect.forEach(
          acknowledgements,
          (acknowledgement) =>
            Deferred.fail(
              acknowledgement,
              new ActivationCoordinatorClosed()
            ),
          { discard: true }
        )
      })
    ),
    Effect.forkIn(scope)
  )
  yield* Effect.addFinalizer(() =>
    Effect.gen(function*() {
      yield* Ref.set(closed, true)
      yield* Queue.shutdown(triggers)
      const acknowledgements = yield* Ref.getAndSet(
        signalAcknowledgements,
        []
      )
      yield* Effect.forEach(
        acknowledgements,
        (acknowledgement) => Deferred.fail(acknowledgement, new ActivationCoordinatorClosed()),
        { discard: true }
      )
    })
  )

  return { signal } satisfies ActivationCoordinator
})
