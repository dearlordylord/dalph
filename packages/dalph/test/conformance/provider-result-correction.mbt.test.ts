import { corpusReplayFor } from "../../../../scripts/mbt-corpus-replay.mjs"
import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  ProviderResultCycle,
  ProviderResultInstantMilliseconds,
  ProviderResultRequestToken,
  ProviderResultTurnId,
  observeProviderResultTurn,
  prepareProviderResultCorrection,
  providerResultResponseExpired,
  rejectProviderResultResponse
} from "../../src/application/provider-result-correction.js"

const { quintIt, quintRun } = corpusReplayFor("packages/dalph/test/conformance/provider-result-correction.mbt.test.ts")

// Model ticks represent fifteen seconds; production retains absolute milliseconds.
const tickMilliseconds = 15_000
const lastResponseOffset = -1
const projection = Schema.Struct({
  state: Schema.Struct({
    phase: Schema.Unknown,
    responses: ITFBigInt,
    now: ITFBigInt,
    deadline: ITFBigInt,
    active: Schema.Boolean
  })
})

const makeCorrectionDriver = (replenishOnRecovery = false, onMutation: () => void = () => undefined) =>
  defineDriver(
    {
      init: {},
      recordInitialIntent: {},
      sendOwnedRequest: {},
      observeOwnedTurn: {},
      rejectResponse: {},
      recordCorrectionIntent: {},
      returnExhausted: {},
      advanceCorrectionTime: {},
      returnExpired: {},
      crash: {},
      recoverExactOwnedRequest: {},
      recoverUnresolvedRequest: {}
    },
    () => {
      let cycle: ProviderResultCycle | undefined
      let active = true
      let operatorRequired = false
      let now = 0
      const sent = new Set<number>()
      const current = () => {
        const response = cycle?.responses.at(lastResponseOffset)
        if (cycle === undefined || response === undefined) return undefined
        return { cycle, response }
      }
      const instant = () => ProviderResultInstantMilliseconds.make(now * tickMilliseconds)
      const turn = (ordinal: number) => ProviderResultTurnId.make(`turn:${ordinal}`)
      const token = (ordinal: number) => ProviderResultRequestToken.make(`token:${ordinal}`)
      const requireCurrent = () =>
        Effect.gen(function* () {
          const retained = current()
          if (retained === undefined) return yield* Effect.die("model action requires a durable response")
          return retained
        })
      return {
        init: () =>
          Effect.sync(() => {
            cycle = undefined
            active = true
            operatorRequired = false
            now = 0
            sent.clear()
          }),
        recordInitialIntent: () =>
          Schema.decodeUnknownEffect(ProviderResultCycle)({
            cycleId: "conformance-cycle",
            responses: [
              {
                _tag: "RequestIntended",
                intent: { _tag: "Initial", ordinal: 1, token: token(1), intendedAt: instant() }
              }
            ]
          }).pipe(
            Effect.tap((retained) =>
              Effect.sync(() => {
                cycle = retained
              })
            ),
            Effect.asVoid
          ),
        sendOwnedRequest: () =>
          Effect.gen(function* () {
            const { response } = yield* requireCurrent()
            expect(sent.has(response.intent.ordinal)).toBe(false)
            expect(providerResultResponseExpired(response.intent, instant())).toBe(false)
            sent.add(response.intent.ordinal)
          }),
        observeOwnedTurn: () =>
          Effect.gen(function* () {
            const retained = yield* requireCurrent()
            expect(sent.has(retained.response.intent.ordinal)).toBe(true)
            cycle = yield* observeProviderResultTurn(
              retained.cycle,
              retained.response.intent.token,
              turn(retained.response.intent.ordinal),
              instant()
            )
          }),
        rejectResponse: () =>
          Effect.gen(function* () {
            const retained = yield* requireCurrent()
            cycle = yield* rejectProviderResultResponse(
              retained.cycle,
              retained.response.intent.token,
              turn(retained.response.intent.ordinal),
              instant(),
              "ResultEnvelopeInvalid"
            )
          }),
        recordCorrectionIntent: () =>
          Effect.gen(function* () {
            const retained = yield* requireCurrent()
            const decision = yield* prepareProviderResultCorrection(
              retained.cycle,
              token(retained.cycle.responses.length + 1),
              instant()
            )
            if (decision._tag !== "CorrectionIntentPrepared") return yield* Effect.die("model correction was refused")
            cycle = decision.cycle
          }),
        returnExhausted: () =>
          Effect.gen(function* () {
            const retained = yield* requireCurrent()
            expect(
              yield* prepareProviderResultCorrection(
                retained.cycle,
                token(retained.cycle.responses.length + 1),
                instant()
              )
            ).toMatchObject({ _tag: "OperatorRequired", reason: "CorrectionExhausted" })
            operatorRequired = true
          }),
        advanceCorrectionTime: () =>
          Effect.sync(() => {
            now += 1
          }),
        returnExpired: () =>
          Effect.gen(function* () {
            const { response } = yield* requireCurrent()
            expect(providerResultResponseExpired(response.intent, instant())).toBe(true)
            operatorRequired = true
          }),
        crash: () =>
          Effect.sync(() => {
            active = false
          }),
        recoverExactOwnedRequest: () =>
          Effect.gen(function* () {
            const retained = yield* requireCurrent()
            // Decode the exact persisted cycle; substrate reconciliation identifies
            // the already-sent token instead of granting another response ordinal.
            cycle = yield* Schema.decodeUnknownEffect(ProviderResultCycle)(JSON.parse(JSON.stringify(retained.cycle)))
            active = true
            if (replenishOnRecovery && retained.response.intent._tag === "Correction") {
              onMutation()
              const intent = retained.response.intent
              cycle = yield* Schema.decodeUnknownEffect(ProviderResultCycle)({
                ...cycle,
                responses: [
                  ...cycle.responses.slice(0, lastResponseOffset),
                  {
                    ...retained.response,
                    intent: {
                      ...intent,
                      intendedAt: intent.intendedAt + tickMilliseconds,
                      deadline: intent.deadline + tickMilliseconds
                    }
                  }
                ]
              })
            }
            if (
              retained.response._tag !== "ResponseRejected" &&
              providerResultResponseExpired(retained.response.intent, instant())
            )
              operatorRequired = true
            else if (retained.response._tag === "RequestIntended" && sent.has(retained.response.intent.ordinal))
              cycle = yield* observeProviderResultTurn(
                cycle,
                retained.response.intent.token,
                turn(retained.response.intent.ordinal),
                instant()
              )
          }),
        recoverUnresolvedRequest: () =>
          Effect.sync(() => {
            active = true
            operatorRequired = true
          }),
        getState: () =>
          Effect.sync(() => {
            const response = current()?.response
            return {
              active,
              now,
              responses: cycle?.responses.length ?? 0,
              deadline: response?.intent._tag === "Correction" ? response.intent.deadline / tickMilliseconds : 0,
              phase: operatorRequired ? "OperatorRequired" : (response?._tag ?? "NoRequest")
            }
          })
      }
    }
  )

const correctionStateCheck = stateCheck(
  (raw) =>
    Schema.decodeUnknownEffect(projection)(raw).pipe(
      Effect.map(({ state }) => ({
        active: state.active,
        now: Number(state.now),
        responses: Number(state.responses),
        deadline: Number(state.deadline),
        phase:
          typeof state.phase === "object" && state.phase !== null && "tag" in state.phase
            ? String(state.phase.tag)
            : String(state.phase)
      }))
    ),
  (spec, actual) =>
    spec.active === actual.active &&
    spec.now === actual.now &&
    spec.responses === actual.responses &&
    spec.deadline === actual.deadline &&
    spec.phase === actual.phase
)

quintIt(
  it.effect,
  "replays bounded correction and crash recovery through production cycle functions",
  {
    backend: "typescript",
    spec: "specs/providerResultCorrection.qnt",
    driverFactory: makeCorrectionDriver(),
    nTraces: 30,
    maxSamples: 30,
    maxSteps: 20,
    seed: "428",
    stateCheck: correctionStateCheck
  },
  30_000
)

it.effect(
  "detects a replenished correction deadline on process recovery",
  () =>
    Effect.gen(function* () {
      const options = {
        backend: "typescript" as const,
        spec: "specs/providerResultCorrection.qnt",
        step: "recoveryDeadlineMbtStep",
        stateCheck: correctionStateCheck,
        nTraces: 1,
        maxSamples: 1,
        maxSteps: 10,
        seed: "428"
      }
      yield* quintRun({ ...options, driverFactory: makeCorrectionDriver() })
      let mutationObserved = false
      const result = yield* quintRun({
        backend: "typescript",
        spec: "specs/providerResultCorrection.qnt",
        step: "recoveryDeadlineMbtStep",
        driverFactory: makeCorrectionDriver(true, () => {
          mutationObserved = true
        }),
        stateCheck: correctionStateCheck,
        nTraces: 1,
        maxSamples: 1,
        maxSteps: 10,
        seed: "428"
      }).pipe(Effect.result)
      expect(mutationObserved).toBe(true)
      expect(result._tag).toBe("Failure")
    }),
  30_000
)
