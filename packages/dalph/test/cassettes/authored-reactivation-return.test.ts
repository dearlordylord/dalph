import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Option, Ref } from "effect"
import { expect } from "vitest"
import { AttemptId, TaskId, TaskRevision } from "@dalph/contracts"
import { TaskWorkCapacity } from "@dalph/orchestrator"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import { makeStoryCursor } from "../../src/cassettes/authored-cursor.js"
import {
  AuthoredStoryPosition,
  awaitAuthoredProcessDeathAfterActivationReturn,
  deliverAuthoredRunReactivationHints,
  makeAuthoredHintDeliveryRendezvous,
  settleAuthoredReactivationOwnerReturn,
  settleCoordinatorActivationReturn
} from "../../src/cassettes/authored-runner.js"

const unsettledResponsibility = { _tag: "RunMustRemainActive" as const, reason: "UnsettledResponsibility" as const }
const storyReturnSignal = (acknowledgement: Deferred.Deferred<void>, item: AuthoredCassetteStoryItem | undefined) => ({
  acknowledgement,
  successor: { _tag: "StoryItem" as const, item }
})

it.effect("correlates successful hint delivery by exact story position and never releases on failure", () =>
  Effect.gen(function* () {
    const rendezvous = yield* makeAuthoredHintDeliveryRendezvous()
    const exactPosition = AuthoredStoryPosition.make(7)
    const foreignPosition = AuthoredStoryPosition.make(8)
    const offered = yield* Ref.make<ReadonlyArray<"TrackerNotification" | "Timer">>([])
    const secondOfferEntered = yield* Deferred.make<void>()
    const releaseSecondOffer = yield* Deferred.make<void>()
    const exactWaiter = yield* rendezvous.awaitAt(exactPosition).pipe(Effect.forkScoped({ startImmediately: true }))
    const foreignWaiter = yield* rendezvous.awaitAt(foreignPosition).pipe(Effect.forkScoped({ startImmediately: true }))
    const delivery = yield* deliverAuthoredRunReactivationHints({
      complete: rendezvous.completeAt(exactPosition),
      hints: ["TrackerNotification", "Timer"],
      offer: (hint) =>
        Ref.update(offered, (current) => [...current, hint]).pipe(
          Effect.andThen(
            hint === "Timer"
              ? Deferred.succeed(secondOfferEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseSecondOffer)))
              : Effect.void
          )
        )
    }).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(secondOfferEntered)
    expect(exactWaiter.pollUnsafe()).toBeUndefined()
    expect(foreignWaiter.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(releaseSecondOffer, undefined)
    yield* Fiber.join(delivery)
    yield* Fiber.join(exactWaiter)
    expect(yield* Ref.get(offered)).toEqual(["TrackerNotification", "Timer"])
    expect(foreignWaiter.pollUnsafe()).toBeUndefined()
    yield* Fiber.interrupt(foreignWaiter)

    const replayPosition = AuthoredStoryPosition.make(9)
    yield* deliverAuthoredRunReactivationHints({
      complete: rendezvous.completeAt(replayPosition),
      hints: ["TrackerNotification", "Timer"],
      offer: () => Effect.void
    })
    yield* rendezvous.awaitAt(replayPosition)

    const failedPosition = AuthoredStoryPosition.make(10)
    const failedWaiter = yield* rendezvous.awaitAt(failedPosition).pipe(Effect.forkScoped({ startImmediately: true }))
    const failed = yield* deliverAuthoredRunReactivationHints({
      complete: rendezvous.completeAt(failedPosition),
      hints: ["TrackerNotification", "Timer"],
      offer: () => Effect.fail("hint delivery failed")
    }).pipe(Effect.exit)
    expect(Exit.isFailure(failed)).toBe(true)
    expect(failedWaiter.pollUnsafe()).toBeUndefined()
    yield* Fiber.interrupt(failedWaiter)

    const interruptedPosition = AuthoredStoryPosition.make(11)
    const interruptedWaiter = yield* rendezvous
      .awaitAt(interruptedPosition)
      .pipe(Effect.forkScoped({ startImmediately: true }))
    const neverDelivered = yield* Deferred.make<void>()
    const interruptedDelivery = yield* deliverAuthoredRunReactivationHints({
      complete: rendezvous.completeAt(interruptedPosition),
      hints: ["Timer"],
      offer: () => Deferred.await(neverDelivered)
    }).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Fiber.interrupt(interruptedDelivery)
    expect(interruptedWaiter.pollUnsafe()).toBeUndefined()
    yield* Fiber.interrupt(interruptedWaiter)
  })
)

it.effect("signals only an exogenous process death after the exact callback return and current capacity", () =>
  Effect.gen(function* () {
    const capacity = { _tag: "SetTaskExecutionCapacity" as const, capacity: TaskWorkCapacity.make(2) }
    const death = { _tag: "CoordinatorProcessDies" as const }
    const cursor = yield* makeStoryCursor([capacity, death])
    const callbackReturned = yield* Deferred.make<ReturnType<typeof storyReturnSignal>>()
    const acknowledgement = yield* Deferred.make<void>()
    const processDied = yield* Deferred.make<void>()
    const watcher = yield* awaitAuthoredProcessDeathAfterActivationReturn({
      awaitActivationReturn: Deferred.await(callbackReturned),
      cursor,
      onProcessDeath: Deferred.succeed(processDied, undefined)
    }).pipe(Effect.forkScoped({ startImmediately: true }))
    expect(watcher.pollUnsafe()).toBeUndefined()

    yield* Deferred.succeed(callbackReturned, storyReturnSignal(acknowledgement, capacity))
    const reserved = yield* cursor.consumeCapacityChange
    if (Option.isNone(reserved)) return yield* Effect.die("capacity change was not reserved")
    expect(watcher.pollUnsafe()).toBeUndefined()
    yield* cursor.settleCapacityChange(reserved.value)
    yield* Fiber.join(watcher)
    yield* Deferred.await(processDied)
    expect(Option.isNone(yield* Deferred.poll(acknowledgement))).toBe(true)
    expect(yield* cursor.storyPosition).toBe(2)
  })
)

it.effect("signals an immediate process death after the callback return", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([{ _tag: "CoordinatorProcessDies" }])
    const acknowledgement = yield* Deferred.make<void>()
    const processDied = yield* Deferred.make<void>()
    yield* awaitAuthoredProcessDeathAfterActivationReturn({
      awaitActivationReturn: Effect.succeed(storyReturnSignal(acknowledgement, { _tag: "CoordinatorProcessDies" })),
      cursor,
      onProcessDeath: Deferred.succeed(processDied, undefined)
    })
    expect(Option.isSome(yield* Deferred.poll(processDied))).toBe(true)
    expect(Option.isNone(yield* Deferred.poll(acknowledgement))).toBe(true)
    expect(yield* cursor.storyPosition).toBe(1)
  })
)

const continueAttempt = AuthoredCassetteStoryItem.cases.OperatorContinuesAttempt.make({
  attemptId: AttemptId.make("attempt:B:1"),
  expected: { _tag: "Applied" },
  observedTaskRevision: TaskRevision.make("revision-B-2"),
  requestNonce: "continue-B",
  taskId: TaskId.make("B")
})

it.effect("acknowledges callback return without consuming the following Continue", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([continueAttempt])
    const acknowledgement = yield* Deferred.make<void>()
    const processDied = yield* Deferred.make<void>()
    yield* awaitAuthoredProcessDeathAfterActivationReturn({
      awaitActivationReturn: Effect.succeed(storyReturnSignal(acknowledgement, continueAttempt)),
      cursor,
      onProcessDeath: Deferred.succeed(processDied, undefined)
    })
    expect(Option.isSome(yield* Deferred.poll(acknowledgement))).toBe(true)
    expect(Option.isNone(yield* Deferred.poll(processDied))).toBe(true)
    expect(yield* cursor.storyPosition).toBe(0)
    expect(yield* cursor.currentStoryItem).toEqual(continueAttempt)
  })
)

it.effect("fails closed when one capacity change is followed by Continue instead of process death", () =>
  Effect.gen(function* () {
    const capacity = { _tag: "SetTaskExecutionCapacity" as const, capacity: TaskWorkCapacity.make(2) }
    const cursor = yield* makeStoryCursor([capacity, continueAttempt])
    const acknowledgement = yield* Deferred.make<void>()
    const processDied = yield* Deferred.make<void>()
    const watcher = yield* awaitAuthoredProcessDeathAfterActivationReturn({
      awaitActivationReturn: Effect.succeed(storyReturnSignal(acknowledgement, capacity)),
      cursor,
      onProcessDeath: Deferred.succeed(processDied, undefined)
    }).pipe(Effect.forkScoped({ startImmediately: true }))
    expect(watcher.pollUnsafe()).toBeUndefined()
    const reserved = yield* cursor.consumeCapacityChange
    if (Option.isNone(reserved)) return yield* Effect.die("capacity change was not reserved")
    yield* cursor.settleCapacityChange(reserved.value)
    const exit = yield* Fiber.await(watcher)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return yield* Effect.die("capacity followed by Continue unexpectedly succeeded")
    const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    expect(failure?._tag === "Fail" ? failure.error : undefined).toMatchObject({
      _tag: "AuthoredCassetteInteractionMismatch",
      actual: "OperatorContinuesAttempt",
      expected: "CoordinatorProcessDies after SetTaskExecutionCapacity",
      storyPosition: 1
    })
    expect(Option.isNone(yield* Deferred.poll(acknowledgement))).toBe(true)
    expect(Option.isNone(yield* Deferred.poll(processDied))).toBe(true)
    expect(yield* cursor.storyPosition).toBe(1)
    expect(yield* cursor.currentStoryItem).toEqual(continueAttempt)
  })
)

it.effect("does not miss capacity advancement between reading and awaiting it", () =>
  Effect.gen(function* () {
    const capacity = { _tag: "SetTaskExecutionCapacity" as const, capacity: TaskWorkCapacity.make(2) }
    const death = { _tag: "CoordinatorProcessDies" as const }
    const cursor = yield* makeStoryCursor([capacity, death])
    const processDied = yield* Deferred.make<void>()
    const reserved = yield* cursor.consumeCapacityChange
    if (Option.isNone(reserved)) return yield* Effect.die("capacity change was not reserved")
    yield* cursor.settleCapacityChange(reserved.value)
    yield* awaitAuthoredProcessDeathAfterActivationReturn({
      awaitActivationReturn: Effect.succeed(storyReturnSignal(yield* Deferred.make<void>(), capacity)),
      cursor,
      onProcessDeath: Deferred.succeed(processDied, undefined)
    })
    expect(Option.isSome(yield* Deferred.poll(processDied))).toBe(true)
    expect(yield* cursor.storyPosition).toBe(2)
  })
)

it.effect("leaves non-death and interrupted post-return boundaries unconsumed", () =>
  Effect.gen(function* () {
    const returned = { _tag: "CoordinatorActivationReturned" as const, decision: unsettledResponsibility }
    const death = { _tag: "CoordinatorProcessDies" as const }
    const untouched = yield* makeStoryCursor([returned])
    const acknowledgement = yield* Deferred.make<void>()
    const processDied = yield* Deferred.make<void>()
    yield* awaitAuthoredProcessDeathAfterActivationReturn({
      awaitActivationReturn: Effect.succeed(storyReturnSignal(acknowledgement, returned)),
      cursor: untouched,
      onProcessDeath: Deferred.succeed(processDied, undefined)
    })
    expect(yield* untouched.storyPosition).toBe(0)
    expect(Option.isSome(yield* Deferred.poll(acknowledgement))).toBe(true)
    expect(Option.isNone(yield* Deferred.poll(processDied))).toBe(true)

    const hints = {
      _tag: "CassetteOffersRunReactivationHints" as const,
      hints: ["TrackerNotification", "Timer"] as const
    }
    const hinted = yield* makeStoryCursor([hints, death])
    const hintedAcknowledgement = yield* Deferred.make<void>()
    const hintDelivery = yield* Deferred.make<void>()
    const hintedWatcher = yield* awaitAuthoredProcessDeathAfterActivationReturn({
      awaitActivationReturn: Effect.succeed({
        acknowledgement: hintedAcknowledgement,
        successor: { _tag: "HintDelivery" as const, awaitDelivery: Deferred.await(hintDelivery) }
      }),
      cursor: hinted,
      onProcessDeath: Deferred.succeed(processDied, undefined)
    }).pipe(Effect.forkScoped({ startImmediately: true }))
    expect(yield* hinted.storyPosition).toBe(0)
    expect(hintedWatcher.pollUnsafe()).toBeUndefined()
    expect(Option.isNone(yield* Deferred.poll(hintedAcknowledgement))).toBe(true)
    yield* Deferred.succeed(hintDelivery, undefined)
    yield* Fiber.join(hintedWatcher)
    expect(Option.isSome(yield* Deferred.poll(hintedAcknowledgement))).toBe(true)
    expect(Option.isNone(yield* Deferred.poll(processDied))).toBe(true)

    const foreignDeath = yield* makeStoryCursor([death])
    const foreignAcknowledgement = yield* Deferred.make<void>()
    const foreign = yield* awaitAuthoredProcessDeathAfterActivationReturn({
      awaitActivationReturn: Effect.succeed(storyReturnSignal(foreignAcknowledgement, death)),
      cursor: {
        awaitStoryItemAdvance: foreignDeath.awaitStoryItemAdvance,
        currentStoryItem: foreignDeath.currentStoryItem,
        pauseAtCoordinatorProcessDeath: Effect.die("foreign process failure"),
        storyPosition: foreignDeath.storyPosition
      },
      onProcessDeath: Deferred.succeed(processDied, undefined)
    }).pipe(Effect.exit)
    expect(Exit.isFailure(foreign)).toBe(true)
    expect(yield* foreignDeath.storyPosition).toBe(0)
    expect(Option.isNone(yield* Deferred.poll(foreignAcknowledgement))).toBe(true)

    const capacity = { _tag: "SetTaskExecutionCapacity" as const, capacity: TaskWorkCapacity.make(2) }
    const interrupted = yield* makeStoryCursor([capacity, death])
    const interruptedAcknowledgement = yield* Deferred.make<void>()
    const waiting = yield* awaitAuthoredProcessDeathAfterActivationReturn({
      awaitActivationReturn: Effect.succeed(storyReturnSignal(interruptedAcknowledgement, capacity)),
      cursor: interrupted,
      onProcessDeath: Deferred.succeed(processDied, undefined)
    }).pipe(Effect.forkScoped({ startImmediately: true }))
    expect(waiting.pollUnsafe()).toBeUndefined()
    yield* Fiber.interrupt(waiting)
    const reserved = yield* interrupted.consumeCapacityChange
    if (Option.isNone(reserved)) return yield* Effect.die("interrupted capacity change was not reserved")
    yield* interrupted.settleCapacityChange(reserved.value)
    expect(yield* interrupted.currentStoryItem).toEqual(death)
    expect(Option.isNone(yield* Deferred.poll(interruptedAcknowledgement))).toBe(true)
    expect(Option.isNone(yield* Deferred.poll(processDied))).toBe(true)
  })
)

it.effect(
  "settles only authored current-first callback returns while leaving absent and unrelated boundaries untouched",
  () =>
    Effect.gen(function* () {
      const returned = { _tag: "CoordinatorActivationReturned" as const, decision: unsettledResponsibility }
      const hints = { _tag: "CassetteOffersRunReactivationHints" as const, hints: ["Timer"] as const }
      const currentFirst = { _tag: "CurrentFirstReactivationAfterProcessDeath" as const }

      const authored = yield* makeStoryCursor([returned, hints])
      expect(
        Option.isSome(yield* settleAuthoredReactivationOwnerReturn(currentFirst, authored, unsettledResponsibility))
      ).toBe(true)
      expect(yield* authored.storyPosition).toBe(1)
      expect(
        Option.isNone(yield* settleAuthoredReactivationOwnerReturn(currentFirst, authored, unsettledResponsibility))
      ).toBe(true)
      expect(yield* authored.storyPosition).toBe(1)

      const unrelated = yield* makeStoryCursor([returned])
      expect(
        Option.isNone(yield* settleAuthoredReactivationOwnerReturn(undefined, unrelated, unsettledResponsibility))
      ).toBe(true)
      expect(yield* unrelated.storyPosition).toBe(0)
    })
)

it.effect("keeps restart hints unavailable before the production finality result", () =>
  Effect.gen(function* () {
    const projection = {
      _tag: "PlannedAttemptExecutorProjectionReturned" as const,
      report: { _tag: "ExecutorWorkExecuting" as const, attemptId: AttemptId.make("attempt:A:0") }
    }
    const returned = { _tag: "CoordinatorActivationReturned" as const, decision: unsettledResponsibility }
    const hints = {
      _tag: "CassetteOffersRunReactivationHints" as const,
      hints: ["TrackerNotification", "Timer"] as const
    }
    const cursor = yield* makeStoryCursor([projection, returned, hints])

    expect(Option.isNone(yield* cursor.consumeRunReactivationHints)).toBe(true)
    const early = yield* settleCoordinatorActivationReturn(cursor, Exit.succeed(unsettledResponsibility)).pipe(
      Effect.exit
    )
    expect(Exit.isFailure(early)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(0)

    expect(Option.isSome(yield* cursor.consumeExecutorProjectionFor(projection.report.attemptId))).toBe(true)
    const wrong = yield* settleCoordinatorActivationReturn(
      cursor,
      Exit.succeed({ _tag: "RunMustRemainActive", reason: "RunnableTransition" })
    ).pipe(Effect.exit)
    expect(Exit.isFailure(wrong)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(1)

    const failed = yield* settleCoordinatorActivationReturn(cursor, Exit.fail("production finality failed")).pipe(
      Effect.exit
    )
    expect(Exit.isFailure(failed)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(1)

    yield* settleCoordinatorActivationReturn(cursor, Exit.succeed(unsettledResponsibility))
    expect(yield* cursor.storyPosition).toBe(2)
    const duplicate = yield* settleCoordinatorActivationReturn(cursor, Exit.succeed(unsettledResponsibility)).pipe(
      Effect.exit
    )
    expect(Exit.isFailure(duplicate)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(2)
    expect(Option.isSome(yield* cursor.consumeRunReactivationHints)).toBe(true)
  })
)

it.effect("settles the reconstructed restart return once before delayed interruption and later hints", () =>
  Effect.gen(function* () {
    const publicationEntered = yield* Deferred.make<void>()
    const releasePublication = yield* Deferred.make<void>()
    const occurrenceCount = yield* Ref.make(0)
    const returned = { _tag: "CoordinatorActivationReturned" as const, decision: unsettledResponsibility }
    const hints = { _tag: "CassetteOffersRunReactivationHints" as const, hints: ["TrackerNotification"] as const }
    const cursor = yield* makeStoryCursor([returned, hints], {
      onOccurrence: ({ item }) =>
        item._tag === "CoordinatorActivationReturned"
          ? Ref.update(occurrenceCount, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(publicationEntered, undefined)),
              Effect.andThen(Deferred.await(releasePublication))
            )
          : Effect.void
    })

    const settlement = yield* settleCoordinatorActivationReturn(cursor, Exit.succeed(unsettledResponsibility)).pipe(
      Effect.forkScoped
    )
    yield* Deferred.await(publicationEntered)
    const interrupted = yield* Fiber.interrupt(settlement).pipe(Effect.forkScoped)
    const hinted = yield* cursor.consumeRunReactivationHints.pipe(Effect.forkScoped)
    yield* Effect.yieldNow
    expect(interrupted.pollUnsafe()).toBeUndefined()
    expect(hinted.pollUnsafe()).toBeUndefined()

    yield* Deferred.succeed(releasePublication, undefined)
    yield* Fiber.join(interrupted)
    expect(Exit.isFailure(yield* Fiber.await(settlement))).toBe(true)
    expect(Option.isSome(yield* Fiber.join(hinted))).toBe(true)
    expect(yield* Ref.get(occurrenceCount)).toBe(1)
    expect(yield* cursor.storyPosition).toBe(2)
  })
)
