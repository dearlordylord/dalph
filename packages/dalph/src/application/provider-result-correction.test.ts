import { Deferred, Duration, Effect, Fiber, Option, Schema } from "effect"
import { it } from "@effect/vitest"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  ProviderResultInstantMilliseconds,
  ProviderResultCycle,
  ProviderResultRequestToken,
  ProviderResultResponseIntent,
  providerResultCycleTransitionProblem,
  providerResultResponseExpired,
  sameProviderResultResponseIntent,
  prepareProviderResultCorrection,
  prepareProviderResultContinuation,
  observeProviderResultTurn,
  rejectProviderResultResponse,
  withinProviderResultDeadline,
  ProviderResultTurnId
} from "./provider-result-correction.js"

const correction = { _tag: "Correction", ordinal: 2, token: "correction:one", intendedAt: 10_000, deadline: 40_000 }
const decode = Schema.decodeUnknownOption(ProviderResultResponseIntent, { onExcessProperty: "error" })

it("rejects a fourth response and a modified thirty-second allowance at the durable boundary", () => {
  expect(Option.isSome(decode(correction))).toBe(true)
  expect(Option.isNone(decode({ ...correction, ordinal: 4 }))).toBe(true)
  expect(Option.isNone(decode({ ...correction, deadline: 40_001 }))).toBe(true)
  expect(Option.isNone(decode({ ...correction, intendedAt: -1, deadline: 29_999 }))).toBe(true)
})

it("recovers the original deadline and expires at its exact boundary", () => {
  const request = Schema.decodeUnknownSync(ProviderResultResponseIntent)(correction)
  const recovered = Schema.decodeUnknownSync(ProviderResultResponseIntent)(JSON.parse(JSON.stringify(request)))
  expect(sameProviderResultResponseIntent(request, recovered)).toBe(true)
  expect(providerResultResponseExpired(recovered, ProviderResultInstantMilliseconds.make(39_999))).toBe(false)
  expect(providerResultResponseExpired(recovered, ProviderResultInstantMilliseconds.make(40_000))).toBe(true)
  expect(providerResultResponseExpired(recovered, ProviderResultInstantMilliseconds.make(50_000))).toBe(true)
})

it("does not impose the additional-response deadline on initial implementation or fresh verification", () => {
  const initial = Schema.decodeUnknownSync(ProviderResultResponseIntent)({
    _tag: "Initial",
    ordinal: 1,
    token: "initial:one",
    intendedAt: 10_000
  })
  expect(providerResultResponseExpired(initial, ProviderResultInstantMilliseconds.make(1_000_000))).toBe(false)
  expect(Option.isNone(decode({ ...initial, deadline: 40_000 }))).toBe(true)
})

it("refuses to equate a changed token, ordinal or replenished original deadline with redelivery", () => {
  const request = Schema.decodeUnknownSync(ProviderResultResponseIntent)(correction)
  for (const changed of [
    { ...correction, token: "correction:other" },
    { ...correction, ordinal: 3 },
    { ...correction, intendedAt: 20_000, deadline: 50_000 }
  ]) {
    expect(
      sameProviderResultResponseIntent(request, Schema.decodeUnknownSync(ProviderResultResponseIntent)(changed))
    ).toBe(false)
  }
})

const initialIntent = { _tag: "Initial", ordinal: 1, token: "initial:one", intendedAt: 0 }
const initialRejected = {
  _tag: "ResponseRejected",
  intent: initialIntent,
  turnId: "turn:initial",
  responseObservedAt: 1_000,
  reason: "ResultEnvelopeInvalid"
}
const cycle = (responses: ReadonlyArray<unknown>, cycleId = "cycle:one") =>
  Schema.decodeUnknownSync(ProviderResultCycle)({ cycleId, responses })

it("requires contiguous unique intents and a rejected predecessor before another response", () => {
  const decodeCycle = Schema.decodeUnknownOption(ProviderResultCycle)
  for (const responses of [
    [],
    [{ _tag: "RequestIntended", intent: correction }],
    [
      { _tag: "RequestIntended", intent: initialIntent },
      { _tag: "RequestIntended", intent: correction }
    ],
    [initialRejected, { _tag: "RequestIntended", intent: { ...correction, token: initialIntent.token } }],
    [initialRejected, { _tag: "RequestIntended", intent: { ...correction, ordinal: 3 } }],
    [initialRejected, { _tag: "TurnObserved", intent: correction, turnId: "turn:initial" }]
  ]) {
    expect(Option.isNone(decodeCycle({ cycleId: "cycle:one", responses }))).toBe(true)
  }
})

it("refuses late correction responses and requests preceding the observed rejection", () => {
  const decodeCycle = Schema.decodeUnknownOption(ProviderResultCycle)
  const rejectedCorrection = {
    _tag: "ResponseRejected",
    intent: correction,
    turnId: "turn:correction",
    reason: "CandidateHeadMismatch",
    responseObservedAt: 39_999
  }
  expect(Option.isSome(decodeCycle({ cycleId: "cycle:one", responses: [initialRejected, rejectedCorrection] }))).toBe(
    true
  )
  for (const responseObservedAt of [9_999, 40_000, 50_000]) {
    expect(
      Option.isNone(
        decodeCycle({
          cycleId: "cycle:one",
          responses: [initialRejected, { ...rejectedCorrection, responseObservedAt }]
        })
      )
    ).toBe(true)
  }
  expect(
    Option.isNone(
      decodeCycle({
        cycleId: "cycle:one",
        responses: [
          { ...initialRejected, responseObservedAt: 11_000 },
          { _tag: "RequestIntended", intent: correction }
        ]
      })
    )
  ).toBe(true)
})

it("retains budget and immutable deadline across intent, observation, rejection and correction", () => {
  const intended = cycle([{ _tag: "RequestIntended", intent: initialIntent }])
  const observed = cycle([{ _tag: "TurnObserved", intent: initialIntent, turnId: "turn:initial" }])
  const rejected = cycle([initialRejected])
  const correcting = cycle([initialRejected, { _tag: "RequestIntended", intent: correction }])
  expect(providerResultCycleTransitionProblem(undefined, intended)).toBeUndefined()
  expect(providerResultCycleTransitionProblem(intended, observed)).toBeUndefined()
  expect(providerResultCycleTransitionProblem(observed, rejected)).toBeUndefined()
  expect(providerResultCycleTransitionProblem(rejected, correcting)).toBeUndefined()
  expect(
    providerResultCycleTransitionProblem(correcting, cycle(JSON.parse(JSON.stringify(correcting.responses))))
  ).toBeUndefined()
  expect(providerResultCycleTransitionProblem(correcting, rejected)).toBe("response budget cannot be replenished")
  expect(providerResultCycleTransitionProblem(intended, rejected)).toBe(
    "response observation cannot reverse or skip its intent"
  )
  expect(providerResultCycleTransitionProblem(rejected, intended)).toBe(
    "response observation cannot reverse or skip its intent"
  )
  expect(
    providerResultCycleTransitionProblem(
      correcting,
      cycle([
        initialRejected,
        { _tag: "RequestIntended", intent: { ...correction, intendedAt: 20_000, deadline: 50_000 } }
      ])
    )
  ).toBe("original response intent changed")
  expect(
    providerResultCycleTransitionProblem(
      rejected,
      cycle([{ _tag: "RequestIntended", intent: initialIntent }], "cycle:new")
    )
  ).toBe("a different cycle requires distinct explicit recovery authorization")
})

it.effect("prepares one correction only after rejection and reconciles the same pending intent after restart", () =>
  Effect.gen(function* () {
    const rejected = cycle([initialRejected])
    const prepared = yield* prepareProviderResultCorrection(
      rejected,
      ProviderResultRequestToken.make("correction:prepared"),
      ProviderResultInstantMilliseconds.make(10_000)
    )
    expect(prepared._tag).toBe("CorrectionIntentPrepared")
    if (prepared._tag !== "CorrectionIntentPrepared") return expect.fail("expected a prepared correction intent")
    expect(prepared.request).toMatchObject({ ordinal: 2, intendedAt: 10_000, deadline: 40_000 })
    expect(providerResultCycleTransitionProblem(rejected, prepared.cycle)).toBeUndefined()
    const restored = cycle(JSON.parse(JSON.stringify(prepared.cycle.responses)))
    const decision = yield* prepareProviderResultCorrection(
      restored,
      ProviderResultRequestToken.make("must-not-be-used"),
      ProviderResultInstantMilliseconds.make(20_000)
    )
    expect(decision).toEqual({ _tag: "ReconcileOwnedRequest", request: prepared.request })
    const expired = yield* prepareProviderResultCorrection(
      restored,
      ProviderResultRequestToken.make("also-not-used"),
      ProviderResultInstantMilliseconds.make(40_000)
    )
    expect(expired).toEqual({ _tag: "OperatorRequired", reason: "Deadline" })
  })
)

it.effect("exhausted three-response history authorizes no replacement request or replenished cycle", () =>
  Effect.gen(function* () {
    const exhausted = cycle([
      initialRejected,
      {
        _tag: "ResponseRejected",
        intent: correction,
        turnId: "turn:two",
        responseObservedAt: 20_000,
        reason: "CandidateHeadMismatch"
      },
      {
        _tag: "ResponseRejected",
        intent: { ...correction, ordinal: 3, token: "correction:three", intendedAt: 20_000, deadline: 50_000 },
        turnId: "turn:three",
        responseObservedAt: 30_000,
        reason: "ResultEnvelopeInvalid"
      }
    ])
    const decision = yield* prepareProviderResultCorrection(
      exhausted,
      ProviderResultRequestToken.make("never-four"),
      ProviderResultInstantMilliseconds.make(60_000)
    )
    expect(decision).toEqual({ _tag: "OperatorRequired", reason: "CorrectionExhausted" })
    expect(exhausted.responses).toHaveLength(3)
  })
)

it.effect("binds an observed turn only to the exact retained request and refuses expired new observations", () =>
  Effect.gen(function* () {
    const pending = cycle([initialRejected, { _tag: "RequestIntended", intent: correction }])
    const token = ProviderResultRequestToken.make(correction.token)
    const turn = ProviderResultTurnId.make("turn:two")
    const now = ProviderResultInstantMilliseconds.make(20_000)
    const observed = yield* observeProviderResultTurn(pending, token, turn, now)
    expect(providerResultCycleTransitionProblem(pending, observed)).toBeUndefined()
    const replayed = yield* observeProviderResultTurn(
      observed,
      token,
      turn,
      ProviderResultInstantMilliseconds.make(50_000)
    )
    expect(replayed).toEqual(observed)
    const foreignRequest = yield* observeProviderResultTurn(
      pending,
      ProviderResultRequestToken.make(initialIntent.token),
      turn,
      now
    ).pipe(Effect.flip)
    expect(foreignRequest).toMatchObject({ _tag: "ProviderResultObservationMismatch", reason: "RequestToken" })
    const foreignTurn = yield* observeProviderResultTurn(
      observed,
      token,
      ProviderResultTurnId.make("turn:other"),
      now
    ).pipe(Effect.flip)
    expect(foreignTurn).toMatchObject({ _tag: "ProviderResultObservationMismatch", reason: "TurnIdentity" })
    const expired = yield* observeProviderResultTurn(
      pending,
      token,
      turn,
      ProviderResultInstantMilliseconds.make(40_000)
    ).pipe(Effect.flip)
    expect(expired).toMatchObject({ _tag: "ProviderResultObservationMismatch", reason: "Expired" })
    expect(pending.responses.at(-1)?._tag).toBe("RequestIntended")
  })
)

it("retains the original Git Base and rejects substitution or retroactive invention", () => {
  const pending = cycle([{ _tag: "RequestIntended", intent: initialIntent }])
  const original = Schema.decodeUnknownSync(ProviderResultCycle)({ ...pending, plannedBaseSha: "1".repeat(40) })
  const replacement = Schema.decodeUnknownSync(ProviderResultCycle)({ ...original, plannedBaseSha: "2".repeat(40) })
  expect(providerResultCycleTransitionProblem(original, replacement)).toBeDefined()
  expect(providerResultCycleTransitionProblem(original, pending)).toBeDefined()
  expect(providerResultCycleTransitionProblem(pending, original)).toBeDefined()
  expect(
    providerResultCycleTransitionProblem(
      original,
      Schema.decodeUnknownSync(ProviderResultCycle)(JSON.parse(JSON.stringify(original)))
    )
  ).toBeUndefined()
})

it.effect("requires exact response ownership and preserves rejection facts through recovery before correction", () =>
  Effect.gen(function* () {
    const pending = cycle([{ _tag: "RequestIntended", intent: initialIntent }])
    const token = ProviderResultRequestToken.make(initialIntent.token)
    const turnId = ProviderResultTurnId.make("turn:initial")
    const observedAt = ProviderResultInstantMilliseconds.make(1_000)
    const skipped = yield* rejectProviderResultResponse(
      pending,
      token,
      turnId,
      observedAt,
      "ResultEnvelopeInvalid"
    ).pipe(Effect.flip)
    expect(skipped).toMatchObject({ reason: "ObservationStage" })
    const observed = yield* observeProviderResultTurn(pending, token, turnId, observedAt)
    const rejected = yield* rejectProviderResultResponse(observed, token, turnId, observedAt, "ResultEnvelopeInvalid")
    expect(providerResultCycleTransitionProblem(observed, rejected)).toBeUndefined()
    const restored = Schema.decodeUnknownSync(ProviderResultCycle)(JSON.parse(JSON.stringify(rejected)))
    expect(yield* rejectProviderResultResponse(restored, token, turnId, observedAt, "ResultEnvelopeInvalid")).toEqual(
      rejected
    )
    for (const changed of [
      { at: ProviderResultInstantMilliseconds.make(2_000), reason: "ResultEnvelopeInvalid" as const },
      { at: observedAt, reason: "CandidateHeadMismatch" as const }
    ]) {
      const mismatch = yield* rejectProviderResultResponse(restored, token, turnId, changed.at, changed.reason).pipe(
        Effect.flip
      )
      expect(mismatch).toMatchObject({ reason: "ResponseFacts" })
    }
    const next = yield* prepareProviderResultCorrection(
      restored,
      ProviderResultRequestToken.make("next:exact"),
      ProviderResultInstantMilliseconds.make(2_000)
    )
    expect(next).toMatchObject({ _tag: "CorrectionIntentPrepared", request: { ordinal: 2 } })
  })
)

it.effect("recovered correction waits only its original remainder and refuses an already expired effect", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknownEffect(ProviderResultResponseIntent)({
        ...correction,
        intendedAt: 0,
        deadline: 30_000
      })
      yield* TestClock.adjust(Duration.millis(20_000))
      const started = yield* Deferred.make<void>()
      const waiting = yield* withinProviderResultDeadline(
        request,
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
      ).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* TestClock.adjust(Duration.millis(9_999))
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust(Duration.millis(1))
      const expired = yield* Fiber.join(waiting).pipe(Effect.flip)
      expect(expired).toMatchObject({
        _tag: "ProviderResultDeadlineElapsed",
        token: correction.token,
        deadline: 30_000
      })
      let crossed = false
      const refused = yield* withinProviderResultDeadline(
        request,
        Effect.sync(() => {
          crossed = true
        })
      ).pipe(Effect.flip)
      expect(refused._tag).toBe("ProviderResultDeadlineElapsed")
      expect(crossed).toBe(false)
    })
  )
)

it.effect("initial verification outlives the correction allowance and technical errors keep their own identity", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const initial = yield* Schema.decodeUnknownEffect(ProviderResultResponseIntent)(initialIntent)
      const started = yield* Deferred.make<void>()
      const waiting = yield* withinProviderResultDeadline(
        initial,
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.sleep(Duration.millis(40_000))),
          Effect.as("verified")
        )
      ).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* TestClock.adjust(Duration.millis(30_000))
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust(Duration.millis(10_000))
      expect(yield* Fiber.join(waiting)).toBe("verified")
      const request = yield* Schema.decodeUnknownEffect(ProviderResultResponseIntent)({
        ...correction,
        intendedAt: 40_000,
        deadline: 70_000
      })
      expect(yield* withinProviderResultDeadline(request, Effect.fail("provider-unavailable")).pipe(Effect.flip)).toBe(
        "provider-unavailable"
      )
    })
  )
)

it.effect("retains the same correction allowance across Resume transport intent and refuses replenishment", () =>
  Effect.gen(function* () {
    const original = cycle([initialRejected, { _tag: "TurnObserved", intent: correction, turnId: "turn:correction" }])
    const resumed = yield* prepareProviderResultContinuation(
      original,
      ProviderResultRequestToken.make("resume:one"),
      ProviderResultInstantMilliseconds.make(20_000)
    )
    expect(resumed.responses).toEqual(original.responses)
    expect(resumed.cycleId).toBe(original.cycleId)
    expect(resumed.transportContinuations).toEqual([{ responseOrdinal: 2, token: "resume:one", intendedAt: 20_000 }])
    expect(providerResultCycleTransitionProblem(original, resumed)).toBeUndefined()
    expect(
      yield* prepareProviderResultContinuation(
        resumed,
        ProviderResultRequestToken.make("resume:two"),
        ProviderResultInstantMilliseconds.make(21_000)
      ).pipe(Effect.result)
    ).toMatchObject({ _tag: "Failure", failure: { reason: "ObservationStage" } })
    expect(
      yield* prepareProviderResultContinuation(
        original,
        ProviderResultRequestToken.make("late:resume"),
        ProviderResultInstantMilliseconds.make(40_000)
      ).pipe(Effect.result)
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "ProviderResultDeadlineElapsed", deadline: 40_000 } })
    expect(providerResultCycleTransitionProblem(resumed, original)).toContain("history cannot reset")
    const rewritten = {
      ...resumed,
      transportContinuations: [{ responseOrdinal: 2, token: "other:resume", intendedAt: 20_000 }]
    }
    expect(
      providerResultCycleTransitionProblem(resumed, Schema.decodeUnknownSync(ProviderResultCycle)(rewritten))
    ).toContain("ownership cannot change")
  })
)

it.effect("observes and rejects a resumed transport against its unchanged logical response", () =>
  Effect.gen(function* () {
    const original = cycle([initialRejected, { _tag: "TurnObserved", intent: correction, turnId: "turn:correction" }])
    const token = ProviderResultRequestToken.make("resume:owned")
    const resumed = yield* prepareProviderResultContinuation(
      original,
      token,
      ProviderResultInstantMilliseconds.make(20_000)
    )
    const observed = yield* observeProviderResultTurn(
      resumed,
      token,
      ProviderResultTurnId.make("turn:resume"),
      ProviderResultInstantMilliseconds.make(21_000)
    )
    expect(providerResultCycleTransitionProblem(resumed, observed)).toBeUndefined()
    expect(observed.responses).toEqual(original.responses)
    expect(
      yield* observeProviderResultTurn(
        observed,
        ProviderResultRequestToken.make(correction.token),
        ProviderResultTurnId.make("turn:correction"),
        ProviderResultInstantMilliseconds.make(22_000)
      ).pipe(Effect.result)
    ).toMatchObject({ _tag: "Failure", failure: { reason: "RequestToken" } })
    const rejected = yield* rejectProviderResultResponse(
      observed,
      token,
      ProviderResultTurnId.make("turn:resume"),
      ProviderResultInstantMilliseconds.make(23_000),
      "ResultEnvelopeInvalid"
    )
    expect(providerResultCycleTransitionProblem(observed, rejected)).toBeUndefined()
    expect(rejected.responses.at(-1)).toMatchObject({
      _tag: "ResponseRejected",
      intent: correction,
      turnId: "turn:correction"
    })
    expect(rejected.transportContinuations).toEqual(observed.transportContinuations)
    expect(rejected.responses).toHaveLength(2)
    expect(
      yield* observeProviderResultTurn(
        resumed,
        token,
        ProviderResultTurnId.make("late:turn"),
        ProviderResultInstantMilliseconds.make(40_000)
      ).pipe(Effect.result)
    ).toMatchObject({ _tag: "Failure", failure: { reason: "Expired" } })
  })
)

it("rejects reordered continuation history and unresolved predecessor transports", () => {
  const original = cycle([initialRejected, { _tag: "TurnObserved", intent: correction, turnId: "turn:correction" }])
  const decodeCycle = Schema.decodeUnknownOption(ProviderResultCycle)
  for (const transports of [
    [
      { responseOrdinal: 2, token: "resume:first", intendedAt: 20_000 },
      { responseOrdinal: 2, token: "resume:second", intendedAt: 21_000 }
    ],
    [
      { responseOrdinal: 2, token: "resume:first", intendedAt: 20_000, turnId: "resume:turn:first" },
      { responseOrdinal: 2, token: "resume:second", intendedAt: 19_000 }
    ],
    [
      { responseOrdinal: 2, token: "resume:first", intendedAt: 20_000, turnId: "resume:turn:first" },
      { responseOrdinal: 1, token: "resume:second", intendedAt: 21_000 }
    ]
  ])
    expect(Option.isNone(decodeCycle({ ...original, transportContinuations: transports }))).toBe(true)
  const pending = Schema.decodeUnknownSync(ProviderResultCycle)({
    ...original,
    transportContinuations: [{ responseOrdinal: 2, token: "resume:pending", intendedAt: 20_000 }]
  })
  const jumped = Schema.decodeUnknownSync(ProviderResultCycle)({
    ...pending,
    responses: [
      initialRejected,
      {
        _tag: "ResponseRejected",
        intent: correction,
        turnId: "turn:correction",
        reason: "ResultEnvelopeInvalid",
        responseObservedAt: 23_000
      }
    ],
    transportContinuations: [
      { responseOrdinal: 2, token: "resume:pending", intendedAt: 20_000, turnId: "resume:observed" }
    ]
  })
  expect(providerResultCycleTransitionProblem(pending, jumped)).toContain("before response facts change")
})
