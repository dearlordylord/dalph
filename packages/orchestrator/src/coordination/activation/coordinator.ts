/* eslint-disable max-lines -- Activation ownership, its controlled production boundaries, and scoped cleanup remain one domain owner. */
import { Data, Deferred, Effect, Exit, Option, Queue, Ref, Schema } from "effect"
import type * as Scope from "effect/Scope"
import {
  SelectedTransitionIdentity as SelectedTransitionIdentitySchema,
  makeSelectedTransitionIdentity,
  selectedTransitionKey
} from "./selected-transition.js"
import { type RunId, type PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { type OperationId } from "../../workflow/identity.js"
import { type SelectedTransitionIdentity } from "./selected-transition.js"
import {
  FrontierExplanation,
  type RunnableFrontier,
  type RunnableFrontierTransition,
  runnableTransitionOperationId,
  runnableTransitionTaskId
} from "../frontier/frontier.js"
import {
  type TaskAdmissionController,
  type TaskAdmissionControllerSnapshot,
  transitionRequiresTaskAdmissionPosition
} from "../admission/controller.js"

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
  readonly signal: (cause: ActivationCause) => Effect.Effect<void, ActivationCoordinatorClosed>
}

const OwnedTransitionExecutionTypeId: unique symbol = Symbol.for("@dalph/OwnedTransitionExecution")

/** Private proof that the activation coordinator owns this exact runner. */
// eslint-disable-next-line functional/no-mixed-types -- The nominal proof and its sole intent-binding operation form one private capability.
export interface OwnedTransitionExecution {
  readonly [OwnedTransitionExecutionTypeId]: typeof OwnedTransitionExecutionTypeId
  readonly recordIntent: (operationId: OperationId) => Effect.Effect<void>
  readonly bindPlannedAttemptExecutorPosition: (correlation: PlannedAttemptExecutorCorrelation) => Effect.Effect<void>
  readonly releasePlannedAttemptExecutorWorkPosition: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<void>
}

type ActivationCoordinatorCheckpointFailure = Data.TaggedEnum<{
  InterruptActivation: Record<never, never>
  RejectDuplicateOwnership: Record<never, never>
}>

const ActivationCoordinatorCheckpointFailure = Data.taggedEnum<ActivationCoordinatorCheckpointFailure>()

interface ActivationCoordinatorObservation {
  readonly admission: TaskAdmissionControllerSnapshot
  readonly ownership: ActivationOwnershipSnapshot
}

/**
 * Package-internal deterministic conformance boundary. Production
 * compositions omit the control and the public coordinator remains
 * trigger-only.
 */
type ActivationCoordinatorCheckpoint =
  | {
      readonly _tag: "FrontierDerived"
      readonly frontier: RunnableFrontier
      readonly observation: ActivationCoordinatorObservation
    }
  | {
      readonly _tag: "OwnedTransitionsExcluded"
      readonly frontier: RunnableFrontier
      readonly observation: ActivationCoordinatorObservation
    }
  | {
      readonly _tag: "AdmissionReserved"
      readonly observation: ActivationCoordinatorObservation
      readonly transition: RunnableFrontierTransition
    }
  | {
      readonly _tag: "AdmissionReservationCancelled"
      readonly observation: ActivationCoordinatorObservation
      readonly transition: RunnableFrontierTransition
    }
  | {
      readonly _tag: "OwnershipRegistered"
      readonly observation: ActivationCoordinatorObservation
      readonly transition: RunnableFrontierTransition
    }
  | {
      readonly _tag: "IntentBound"
      readonly observation: ActivationCoordinatorObservation
      readonly operationId: OperationId
      readonly transition: RunnableFrontierTransition
    }
  | {
      readonly _tag: "OperationReturned"
      readonly observation: ActivationCoordinatorObservation
      readonly operationId: Option.Option<OperationId>
      readonly runnerExit: "Failed" | "Succeeded"
      readonly transition: RunnableFrontierTransition
    }
  | {
      readonly _tag: "OwnershipReleased"
      readonly observation: ActivationCoordinatorObservation
      readonly operationId: Option.Option<OperationId>
      readonly runnerExit: "Failed" | "Succeeded"
      readonly transition: RunnableFrontierTransition
    }

interface ActivationCoordinatorControl {
  readonly attemptCompetingOwnershipRegistration?: (attempt: Effect.Effect<void>) => Effect.Effect<void>
  readonly checkpoint: (
    checkpoint: ActivationCoordinatorCheckpoint
  ) => Effect.Effect<void, ActivationCoordinatorCheckpointFailure>
}

type MakeActivationCoordinatorInput<E, R> = {
  readonly admissionController: TaskAdmissionController
  readonly control?: ActivationCoordinatorControl
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

const ownedTransitionKey = (runId: RunId, transition: RunnableFrontierTransition): string =>
  selectedTransitionKey(makeSelectedTransitionIdentity(runId, transition))

/** Projects exact live ownership into selector explanations without mutating either authority. */
const projectActivationOwnership = (
  runId: RunId,
  frontier: RunnableFrontier,
  ownership: ReadonlyMap<string, ActivationOwnershipEntry>
): RunnableFrontier => {
  const projected = frontier.transitions.map((transition) => {
    const operationId = runnableTransitionOperationId(transition)
    const entry =
      ownership.get(ownedTransitionKey(runId, transition)) ??
      [...ownership.values()].find(
        (candidate) => operationId !== undefined && Option.getOrUndefined(candidate.operationId) === operationId
      )
    return entry === undefined
      ? { explanation: null, transition }
      : {
          explanation: FrontierExplanation.ActivationInProgress({
            operationId: entry.operationId,
            taskId: runnableTransitionTaskId(transition)
          }),
          transition: null
        }
  })
  return {
    explanations: [
      ...frontier.explanations,
      ...projected.flatMap(({ explanation }) => (explanation === null ? [] : [explanation]))
    ],
    transitions: projected.flatMap(({ transition }) => (transition === null ? [] : [transition]))
  }
}

/**
 * Internal process-local ownership registry owned by the live coordinator.
 * Deterministic controls can ask the coordinator to attempt one competing
 * registration, but cannot observe or mutate this registry directly.
 */
const makeActivationOwnershipRegistry = Effect.fn("ActivationOwnershipRegistry.make")(function* (runId: RunId) {
  const owners = yield* Ref.make<ReadonlyMap<string, ActivationOwnershipEntry>>(new Map())
  const isolatedTransitionKeys = yield* Ref.make<ReadonlySet<string>>(new Set())
  return {
    bindOperation: (key: string, operationId: OperationId) =>
      Ref.update(owners, (current) => {
        Option.getOrThrow(Option.fromUndefinedOr(current.get(key)))
        return new Map(
          [...current].map(([candidateKey, candidate]) =>
            candidateKey === key
              ? ([candidateKey, { ...candidate, operationId: Option.some(operationId) }] as const)
              : ([candidateKey, candidate] as const)
          )
        )
      }),
    exclude: Effect.fn("ActivationOwnershipRegistry.exclude")(function* (frontier: RunnableFrontier) {
      const snapshot = {
        isolatedTransitionKeys: yield* Ref.get(isolatedTransitionKeys),
        owners: yield* Ref.get(owners)
      }
      const withoutOwners = projectActivationOwnership(runId, frontier, snapshot.owners)
      return {
        explanations: withoutOwners.explanations,
        transitions: withoutOwners.transitions.filter(
          (transition) => !snapshot.isolatedTransitionKeys.has(ownedTransitionKey(runId, transition))
        )
      }
    }),
    get: (key: string) => Ref.get(owners).pipe(Effect.map((current) => current.get(key))),
    isolate: (key: string) => Ref.update(isolatedTransitionKeys, (current) => new Set([...current, key])),
    register: (transition: RunnableFrontierTransition) =>
      Ref.modify(owners, (current) => {
        const selected = makeSelectedTransitionIdentity(runId, transition)
        const key = selectedTransitionKey(selected)
        return Option.match(Option.fromUndefinedOr(current.get(key)), {
          onNone: () => {
            const entry: ActivationOwnershipEntry = { operationId: Option.none(), selected, transition }
            return [{ entry, key }, new Map([...current, [key, entry]])] as const
          },
          onSome: () => [undefined, current] as const
        })
      }),
    remove: (key: string) =>
      Ref.modify(owners, (current) => {
        const removed = current.get(key)
        return [removed, new Map([...current].filter(([candidateKey]) => candidateKey !== key))] as const
      }),
    snapshot: (): Effect.Effect<ActivationOwnershipSnapshot> =>
      Effect.all({ isolatedTransitionKeys: Ref.get(isolatedTransitionKeys), owners: Ref.get(owners) })
  } as const
})

/**
 * Creates one scoped coordinator. Its returned surface accepts only order-free
 * causes; selected transitions and ownership capabilities remain private.
 */
export const makeActivationCoordinator = Effect.fn("ActivationCoordinator.make")(function* <E, R>(
  input: MakeActivationCoordinatorInput<E, R>
): Effect.fn.Return<ActivationCoordinator, never, Scope.Scope | R> {
  const scope = yield* Effect.scope
  const triggers = yield* Queue.dropping<ActivationCause>(1)
  const signalState = yield* Ref.make<{
    readonly acknowledgements: ReadonlyArray<Deferred.Deferred<void, ActivationCoordinatorClosed>>
    readonly closed: boolean
  }>({ acknowledgements: [], closed: false })
  const ownership = yield* makeActivationOwnershipRegistry(input.runId)
  const checkpoint = (
    make: (observation: ActivationCoordinatorObservation) => ActivationCoordinatorCheckpoint
  ): Effect.Effect<void, ActivationCoordinatorCheckpointFailure> => {
    const control = input.control
    if (control === undefined) return Effect.void
    return Effect.all({ admission: input.admissionController.snapshot(), ownership: ownership.snapshot() }).pipe(
      Effect.flatMap((observation) => control.checkpoint(make(observation)))
    )
  }

  const signal = Effect.fn("ActivationCoordinator.signal")(function* (cause: ActivationCause) {
    const acknowledgement = yield* Deferred.make<void, ActivationCoordinatorClosed>()
    const accepted = yield* Ref.modify(signalState, (current) =>
      current.closed
        ? ([false, current] as const)
        : ([true, { ...current, acknowledgements: [...current.acknowledgements, acknowledgement] }] as const)
    )
    if (!accepted) return yield* new ActivationCoordinatorClosed()
    yield* Queue.offer(triggers, cause)
    yield* Deferred.await(acknowledgement)
  })

  const runOwnedTransition = (key: string, entry: ActivationOwnershipEntry): Effect.Effect<void, never, R> => {
    const settleRunnerAdmission = (owned: ActivationOwnershipEntry): Effect.Effect<void> => {
      if (!transitionRequiresTaskAdmissionPosition(owned.transition)) {
        return Effect.void
      }
      if (
        owned.transition._tag === "ContinuePlannedAttemptExecutorWork" ||
        owned.transition._tag === "StartPlannedAttemptExecutorWork"
      )
        return Effect.void
      return input.admissionController.cancelReservedPosition(entry.selected).pipe(Effect.orDie, Effect.asVoid)
    }

    const recordIntent = Effect.fn("ActivationCoordinator.recordIntent")(function* (operationId: OperationId) {
      yield* Effect.uninterruptible(ownership.bindOperation(key, operationId))
      yield* checkpoint((observation) => ({
        _tag: "IntentBound",
        observation,
        operationId,
        transition: entry.transition
      })).pipe(Effect.orDie)
    })

    const bindPlannedAttemptExecutorPosition = Effect.fn("ActivationCoordinator.bindPlannedAttemptExecutorPosition")(
      function* (correlation: PlannedAttemptExecutorCorrelation) {
        yield* input.admissionController.bindPlannedAttemptPosition(entry.selected, correlation).pipe(Effect.orDie)
      }
    )

    const releasePlannedAttemptExecutorWorkPosition = Effect.fn(
      "ActivationCoordinator.releasePlannedAttemptExecutorWorkPosition"
    )(function* (correlation: PlannedAttemptExecutorCorrelation) {
      yield* input.admissionController.releasePlannedAttemptPosition(correlation).pipe(Effect.orDie)
    })

    return input
      .runTransition(entry.transition, {
        [OwnedTransitionExecutionTypeId]: OwnedTransitionExecutionTypeId,
        recordIntent,
        bindPlannedAttemptExecutorPosition,
        releasePlannedAttemptExecutorWorkPosition
      })
      .pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          Effect.gen(function* () {
            const owned = Option.getOrThrow(Option.fromUndefinedOr(yield* ownership.get(key)))
            const operationId = owned.operationId
            const runnerExit = Exit.isSuccess(exit) ? ("Succeeded" as const) : ("Failed" as const)
            yield* checkpoint((observation) => ({
              _tag: "OperationReturned",
              observation,
              operationId,
              runnerExit,
              transition: entry.transition
            })).pipe(Effect.orDie)
            yield* settleRunnerAdmission(owned)
            yield* ownership.remove(key)
            yield* checkpoint((observation) => ({
              _tag: "OwnershipReleased",
              observation,
              operationId,
              runnerExit,
              transition: entry.transition
            })).pipe(Effect.orDie)
            yield* signal(ActivationCause.WorkflowResultRecorded()).pipe(
              Effect.catchTag("ActivationCoordinatorClosed", () => Effect.void)
            )
          })
        )
      )
  }

  const isolateDuplicate = (selected: SelectedTransitionIdentity, key: string) =>
    Effect.die(new DuplicateActivationOwnershipDefect({ selected })).pipe(
      Effect.catchCause(() => ownership.isolate(key))
    )

  const admitFirstCandidate = Effect.fn("ActivationCoordinator.admitFirstCandidate")(function* (
    frontier: RunnableFrontier
  ) {
    const candidate = frontier.transitions[0]
    if (candidate === undefined) return undefined
    const admission = yield* input.admissionController.admit(frontier, input.runId)
    if (Option.isNone(admission.transition)) return undefined
    const transition = admission.transition.value
    const selected = makeSelectedTransitionIdentity(input.runId, transition)
    return { key: selectedTransitionKey(selected), selected, transition }
  })

  const handoff = Effect.fn("ActivationCoordinator.handoff")((frontier: RunnableFrontier) =>
    Effect.uninterruptibleMask(() =>
      Effect.gen(function* () {
        const admitted = yield* admitFirstCandidate(frontier)
        if (admitted === undefined) return false
        const { key, selected, transition } = admitted
        const admissionCheckpoint = yield* checkpoint((observation) => ({
          _tag: "AdmissionReserved",
          observation,
          transition
        })).pipe(Effect.result)
        if (admissionCheckpoint._tag === "Failure") {
          if (transitionRequiresTaskAdmissionPosition(transition)) {
            yield* input.admissionController.cancelReservedPosition(selected).pipe(Effect.orDie)
          }
          yield* checkpoint((observation) => ({ _tag: "AdmissionReservationCancelled", observation, transition })).pipe(
            Effect.orDie
          )
          return false
        }
        const registered = yield* ownership.register(transition)
        return yield* Option.match(Option.fromUndefinedOr(registered), {
          // No second reservation is cancelled here: a matching reservation
          // belongs to the existing exact owner. Isolate only this subject.
          onNone: () => isolateDuplicate(selected, key).pipe(Effect.as(false)),
          onSome: (ownedRegistration) =>
            Effect.gen(function* () {
              yield* (
                input.control?.attemptCompetingOwnershipRegistration?.(
                  ownership.register(transition).pipe(
                    Effect.filterOrFail(
                      (competingRegistration) => competingRegistration === undefined,
                      () => new DuplicateActivationOwnershipDefect({ selected })
                    ),
                    Effect.orDie,
                    Effect.andThen(isolateDuplicate(selected, key))
                  )
                ) ?? Effect.void
              )
              const rollbackFailedStart = Effect.gen(function* () {
                const partialOwner = Option.getOrThrow(
                  Option.fromUndefinedOr(yield* ownership.get(ownedRegistration.key))
                )
                if (
                  Option.isNone(partialOwner.operationId) &&
                  transitionRequiresTaskAdmissionPosition(partialOwner.transition)
                ) {
                  yield* input.admissionController
                    .cancelReservedPosition(ownedRegistration.entry.selected)
                    .pipe(Effect.orDie)
                }
                yield* ownership.remove(ownedRegistration.key)
                yield* checkpoint((observation) => ({
                  _tag: "OwnershipReleased",
                  observation,
                  operationId: partialOwner.operationId,
                  runnerExit: "Failed",
                  transition: ownedRegistration.entry.transition
                })).pipe(Effect.orDie)
              })
              const ownershipCheckpoint = yield* checkpoint((observation) => ({
                _tag: "OwnershipRegistered",
                observation,
                transition
              })).pipe(Effect.result)
              if (ownershipCheckpoint._tag === "Failure") {
                const failure = ownershipCheckpoint.failure
                if (failure._tag === "RejectDuplicateOwnership") {
                  yield* isolateDuplicate(selected, key)
                } else {
                  yield* rollbackFailedStart
                  return false
                }
              }
              yield* runOwnedTransition(ownedRegistration.key, ownedRegistration.entry).pipe(
                Effect.forkIn(scope),
                Effect.onError(() => rollbackFailedStart)
              )
              return true
            })
        })
      })
    )
  )

  const runPass = Effect.fn("ActivationCoordinator.runPass")(function* () {
    const frontier = yield* input.readFrontier
    yield* checkpoint((observation) => ({ _tag: "FrontierDerived", frontier, observation })).pipe(Effect.orDie)
    const selectable = yield* ownership.exclude(frontier)
    const exclusionCheckpoint = yield* checkpoint((observation) => ({
      _tag: "OwnedTransitionsExcluded",
      frontier: selectable,
      observation
    })).pipe(Effect.result)
    if (exclusionCheckpoint._tag === "Failure") return false
    const started = yield* handoff(selectable)
    if (!started) return false
    // Let the newly scoped child reach its first boundary before this pass
    // acknowledges startup; deterministic clocks can then observe its schedule.
    yield* Effect.yieldNow
    return started
  })

  const runTriggeredPasses = Effect.fn("ActivationCoordinator.runTriggeredPasses")(function* () {
    for (;;) {
      yield* Queue.take(triggers)
      while (yield* runPass()) {
        // Each established handoff causes a fresh read before another choice.
      }
      const acknowledgements = yield* Ref.modify(
        signalState,
        (current) => [current.acknowledgements, { ...current, acknowledgements: [] }] as const
      )
      yield* Effect.forEach(acknowledgements, (acknowledgement) => Deferred.succeed(acknowledgement, undefined), {
        discard: true
      })
    }
  })

  yield* runTriggeredPasses().pipe(
    Effect.catchCause(() =>
      Effect.gen(function* () {
        const acknowledgements = yield* Ref.modify(
          signalState,
          (current) => [current.acknowledgements, { acknowledgements: [], closed: true }] as const
        )
        yield* Effect.forEach(
          acknowledgements,
          (acknowledgement) => Deferred.fail(acknowledgement, new ActivationCoordinatorClosed()),
          { discard: true }
        )
      })
    ),
    Effect.forkIn(scope)
  )
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* Queue.shutdown(triggers)
      const acknowledgements = yield* Ref.modify(
        signalState,
        (current) => [current.acknowledgements, { acknowledgements: [], closed: true }] as const
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
