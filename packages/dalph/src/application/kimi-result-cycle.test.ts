import { it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { expect } from "vitest"
import { KimiAcpPromptToken } from "./kimi-acp.js"
import { ProviderResultInstantMilliseconds } from "./provider-result-correction.js"
import { KimiResultCycle, kimiResultCycleTransitionProblem, prepareKimiResultCorrection } from "./kimi-result-cycle.js"

const initial = { _tag: "Initial", ordinal: 1, token: "initial", intendedAt: 0 }
const rejected = {
  _tag: "ResponseRejected",
  intent: initial,
  reason: "ResultEnvelopeInvalid",
  responseObservedAt: 1_000
}
const cycle = (responses: ReadonlyArray<unknown>) =>
  Schema.decodeUnknownSync(KimiResultCycle)({ cycleId: "kimi-cycle", plannedBaseSha: "1".repeat(40), responses })

it.effect(
  "retains original ACP correction deadline across decoding and refuses to replenish an unfinished request",
  () =>
    Effect.gen(function* () {
      const first = yield* prepareKimiResultCorrection(
        cycle([rejected]),
        KimiAcpPromptToken.make("correction"),
        ProviderResultInstantMilliseconds.make(2_000)
      )
      if (first._tag !== "CorrectionPrepared") return yield* Effect.die("expected correction intent")
      expect(first.request).toMatchObject({ ordinal: 2, intendedAt: 2_000, deadline: 32_000 })
      expect(kimiResultCycleTransitionProblem(cycle([rejected]), first.cycle)).toBeUndefined()
      const restored = yield* Schema.decodeUnknownEffect(KimiResultCycle)(JSON.parse(JSON.stringify(first.cycle)))
      const pending = yield* prepareKimiResultCorrection(
        restored,
        KimiAcpPromptToken.make("unused"),
        ProviderResultInstantMilliseconds.make(31_999)
      )
      expect(pending).toMatchObject({ _tag: "ReconcilePrompt", request: first.request })
      expect(
        yield* prepareKimiResultCorrection(
          restored,
          KimiAcpPromptToken.make("unused"),
          ProviderResultInstantMilliseconds.make(32_000)
        )
      ).toMatchObject({ _tag: "Deadline", request: first.request })
    })
)

it.effect("stops after three freshly acknowledged and rejected ACP responses", () =>
  Effect.gen(function* () {
    let current = cycle([rejected])
    for (const [index, token] of ["second", "third"].entries()) {
      const next = yield* prepareKimiResultCorrection(
        current,
        KimiAcpPromptToken.make(token),
        ProviderResultInstantMilliseconds.make(2_000 + index)
      )
      if (next._tag !== "CorrectionPrepared") return yield* Effect.die("expected bounded correction")
      const acknowledged = cycle([...current.responses, { _tag: "PromptAcknowledged", intent: next.request }])
      expect(kimiResultCycleTransitionProblem(next.cycle, acknowledged)).toBeUndefined()
      const rejectedNext = cycle([
        ...current.responses,
        {
          _tag: "ResponseRejected",
          intent: next.request,
          reason: "CandidateHeadMismatch",
          responseObservedAt: 2_000 + index
        }
      ])
      expect(kimiResultCycleTransitionProblem(acknowledged, rejectedNext)).toBeUndefined()
      current = rejectedNext
    }
    expect(
      yield* prepareKimiResultCorrection(
        current,
        KimiAcpPromptToken.make("fourth"),
        ProviderResultInstantMilliseconds.make(3_000)
      )
    ).toEqual({ _tag: "Exhausted" })
  })
)

it("rejects changed Base, cycle identity, acknowledgement reversal and direct pending rejection", () => {
  const pending = cycle([{ _tag: "RequestIntended", intent: initial }])
  const acknowledged = cycle([{ _tag: "PromptAcknowledged", intent: initial }])
  expect(kimiResultCycleTransitionProblem(pending, cycle([rejected]))).toContain("ownership")
  expect(kimiResultCycleTransitionProblem(acknowledged, pending)).toContain("ownership")
  expect(
    kimiResultCycleTransitionProblem(pending, {
      ...pending,
      cycleId: Schema.decodeUnknownSync(KimiResultCycle)({ ...pending, cycleId: "other" }).cycleId
    })
  ).toContain("identity")
  expect(
    kimiResultCycleTransitionProblem(pending, {
      ...pending,
      plannedBaseSha: Schema.decodeUnknownSync(KimiResultCycle)({ ...pending, plannedBaseSha: "2".repeat(40) })
        .plannedBaseSha
    })
  ).toContain("Base")
  expect(kimiResultCycleTransitionProblem(cycle([rejected]), pending)).toBeDefined()
})

it("rejects skipped ordinals, reused tokens and renewed correction allowances at the durable decoder", () => {
  const decode = Schema.decodeUnknownOption(KimiResultCycle)
  for (const intent of [
    { _tag: "Correction", ordinal: 3, token: "second", intendedAt: 2_000, deadline: 32_000 },
    { _tag: "Correction", ordinal: 2, token: "initial", intendedAt: 2_000, deadline: 32_000 },
    { _tag: "Correction", ordinal: 2, token: "second", intendedAt: 2_000, deadline: 32_001 }
  ])
    expect(
      Option.isNone(
        decode({
          cycleId: "kimi",
          plannedBaseSha: "1".repeat(40),
          responses: [rejected, { _tag: "RequestIntended", intent }]
        })
      )
    ).toBe(true)
})
