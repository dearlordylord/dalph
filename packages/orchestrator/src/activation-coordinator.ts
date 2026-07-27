import type { Cause } from "effect"
import { Data, Deferred, Effect, Exit, Option, Queue, Ref, Schema } from "effect"
import type * as Scope from "effect/Scope"
import { SelectedTransitionIdentity as SelectedTransitionIdentitySchema } from "./domain.js"
import type { OperationId, RunId, SelectedTransitionIdentity } from "./domain.js"
import { FrontierExplanation, type RunnableFrontier, type RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "./selected-transition.js"
import type { TaskAdmissionController } from "./task-admission-controller.js"

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
 * The handoff cancels its newly reserved position before this defect escapes.
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
  readonly runTransition: (
    transition: RunnableFrontierTransition,
    execution: OwnedTransitionExecution
  ) => Effect.Effect<void, E, R>
} & {
  readonly onSubjectDefect?: (
    transition: RunnableFrontierTransition,
    cause: Cause.Cause<unknown>
  ) => Effect.Effect<void, never, R>
}

interface ActivationOwnershipEntry {
  readonly operationId: Option.Option<OperationId>
  readonly selected: SelectedTransitionIdentity
  readonly transition: RunnableFrontierTransition
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
  const ownership = yield* Ref.make<ReadonlyMap<string, ActivationOwnershipEntry>>(
    new Map()
  )

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
        yield* Ref.update(ownership, (current) => {
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
        })
        yield* input.admissionController.bindReservedPosition(
          entry.selected,
          operationId
        ).pipe(Effect.orDie)
      }
    )

    return input.runTransition(entry.transition, { recordIntent }).pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        Effect.gen(function*() {
          const owned = (yield* Ref.get(ownership)).get(key)
          yield* Ref.update(ownership, (current) => {
            return new Map(
              [...current].filter(([candidateKey]) => candidateKey !== key)
            )
          })
          if (owned !== undefined && Option.isNone(owned.operationId)) {
            yield* input.admissionController.cancelReservedPosition(entry.selected)
              .pipe(Effect.orDie)
          } else if (
            owned !== undefined
            && Option.isSome(owned.operationId)
            && Exit.isSuccess(exit)
          ) {
            yield* input.admissionController.releaseTaskAdmissionPosition(
              owned.operationId.value
            ).pipe(Effect.orDie)
          }
          if (Exit.isFailure(exit) && input.onSubjectDefect !== undefined) {
            yield* input.onSubjectDefect(entry.transition, exit.cause)
          }
          yield* signal(ActivationCause.WorkflowResultRecorded()).pipe(
            Effect.catchTag("ActivationCoordinatorClosed", () => Effect.void)
          )
        })
      )
    )
  }

  const handoff = Effect.fn("ActivationCoordinator.handoff")(
    (transition: RunnableFrontierTransition) =>
      Effect.uninterruptibleMask(() =>
        Effect.gen(function*() {
          const selected = makeSelectedTransitionIdentity(input.runId, transition)
          const key = selectedTransitionKey(selected)
          const registered = yield* Ref.modify(ownership, (current) => {
            if (current.has(key)) return [false, current] as const
            const entry: ActivationOwnershipEntry = {
              operationId: "operationId" in transition
                ? Option.some(transition.operationId)
                : Option.none(),
              selected,
              transition
            }
            return [true, new Map([...current, [key, entry]])] as const
          })
          if (!registered) {
            yield* input.admissionController.cancelReservedPosition(selected)
              .pipe(Effect.orDie)
            return yield* Effect.die(
              new DuplicateActivationOwnershipDefect({ selected })
            )
          }
          const entry = (yield* Ref.get(ownership)).get(key)
          if (entry === undefined) {
            return yield* Effect.die(new Error("activation ownership disappeared during handoff"))
          }
          yield* runOwnedTransition(key, entry).pipe(Effect.forkIn(scope))
        })
      )
  )

  const runPass = Effect.fn("ActivationCoordinator.runPass")(function*() {
    const frontier = yield* input.readFrontier
    const withoutOwners = excludeOwnedTransitions(
      input.runId,
      frontier,
      yield* Ref.get(ownership)
    )
    const admission = yield* input.admissionController.admit(
      withoutOwners,
      input.runId
    )
    const transition = admission.transitions[0]
    if (transition === undefined) return false
    yield* handoff(transition)
    // Let the newly scoped child reach its first boundary before this pass
    // acknowledges startup; deterministic clocks can then observe its schedule.
    yield* Effect.yieldNow
    return true
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

  yield* runTriggeredPasses().pipe(Effect.forkIn(scope))
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
