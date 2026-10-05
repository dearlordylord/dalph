import type { KimiAcpPromptToken } from "./kimi-acp.js"
import { GitCommitSha } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import {
  ProviderResultCycleId,
  ProviderResultResponseIntent,
  ProviderResultInstantMilliseconds,
  providerResultResponseExpired,
  providerResultCorrectionMilliseconds,
  sameProviderResultResponseIntent
} from "./provider-result-correction.js"
import { ProviderResultRejectionReason } from "./provider-semantic-result.js"

/** ACP acknowledges the exact prompt RPC; it supplies no persistent provider turn ID. */
export const KimiResultResponse = Schema.TaggedUnion({
  RequestIntended: { intent: ProviderResultResponseIntent },
  PromptAcknowledged: { intent: ProviderResultResponseIntent },
  ResponseRejected: {
    intent: ProviderResultResponseIntent,
    reason: ProviderResultRejectionReason,
    responseObservedAt: ProviderResultInstantMilliseconds
  }
})
export type KimiResultResponse = typeof KimiResultResponse.Type
const lastResponseOffset = -1
const maximumResponses = 3

/** Same response allowances as Codex, with ACP acknowledgement as the ownership boundary. */
export const KimiResultCycle = Schema.Struct({
  cycleId: ProviderResultCycleId,
  plannedBaseSha: GitCommitSha,
  responses: Schema.Array(KimiResultResponse)
}).check(
  Schema.makeFilter((cycle) => {
    if (cycle.responses.length === 0 || cycle.responses.length > maximumResponses)
      return "one initial and at most two corrections"
    const tokens = new Set<string>()
    for (const [index, response] of cycle.responses.entries()) {
      if (response.intent.ordinal !== index + 1 || (index === 0) !== (response.intent._tag === "Initial"))
        return "response ordinals must remain contiguous"
      if (tokens.has(response.intent.token)) return "response request tokens cannot repeat"
      tokens.add(response.intent.token)
      const previous = cycle.responses[index - 1]
      if (
        previous !== undefined &&
        (previous._tag !== "ResponseRejected" || response.intent.intendedAt < previous.responseObservedAt)
      )
        return "correction requires a proven predecessor rejection"
      if (
        response._tag === "ResponseRejected" &&
        (response.responseObservedAt < response.intent.intendedAt ||
          providerResultResponseExpired(response.intent, response.responseObservedAt))
      )
        return "rejection must be observed within the original response allowance"
    }
    return undefined
  })
)
export type KimiResultCycle = typeof KimiResultCycle.Type

export const kimiResultCycleTransitionProblem = (
  previous: KimiResultCycle | undefined,
  next: KimiResultCycle
): string | undefined => {
  if (previous === undefined)
    return next.responses.length === 1 && next.responses[0]?._tag === "RequestIntended"
      ? undefined
      : "new cycle requires an initial intent"
  if (previous.cycleId !== next.cycleId || previous.plannedBaseSha !== next.plannedBaseSha)
    return "cycle identity and original Base require explicit recovery authorization"
  if (next.responses.length < previous.responses.length || next.responses.length > previous.responses.length + 1)
    return "response budget cannot reset or skip an intent"
  for (const [index, before] of previous.responses.entries()) {
    const after = next.responses[index]
    if (after === undefined || !sameProviderResultResponseIntent(before.intent, after.intent))
      return "original response intent cannot change"
    if (before._tag === after._tag) {
      if (
        before._tag === "ResponseRejected" &&
        after._tag === "ResponseRejected" &&
        (before.reason !== after.reason || before.responseObservedAt !== after.responseObservedAt)
      )
        return "rejection facts cannot change"
      continue
    }
    if (index !== previous.responses.length - 1 || next.responses.length !== previous.responses.length)
      return "historical response facts cannot change"
    if (
      !(
        (before._tag === "RequestIntended" && after._tag === "PromptAcknowledged") ||
        (before._tag === "PromptAcknowledged" && after._tag === "ResponseRejected")
      )
    )
      return "response ownership must be acknowledged before rejection"
  }
  if (
    next.responses.length > previous.responses.length &&
    next.responses.at(lastResponseOffset)?._tag !== "RequestIntended"
  )
    return "correction must begin with a durable request intent"
  return undefined
}

/** Reconstruct the next action from private observations without extending any deadline. */
export const prepareKimiResultCorrection = Effect.fn("KimiResultCycle.prepareCorrection")(function* (
  cycle: KimiResultCycle,
  token: KimiAcpPromptToken,
  now: ProviderResultInstantMilliseconds
) {
  const retained = yield* Schema.decodeUnknownEffect(KimiResultCycle)(cycle)
  const previous = retained.responses.at(lastResponseOffset)
  if (previous === undefined) return yield* Effect.die("validated response cycle has no initial intent")
  if (previous._tag !== "ResponseRejected")
    return {
      _tag: providerResultResponseExpired(previous.intent, now) ? ("Deadline" as const) : ("ReconcilePrompt" as const),
      request: previous.intent
    }
  if (retained.responses.length === maximumResponses) return { _tag: "Exhausted" as const }
  const request = yield* Schema.decodeUnknownEffect(ProviderResultResponseIntent)({
    _tag: "Correction",
    ordinal: retained.responses.length + 1,
    token,
    intendedAt: now,
    deadline: now + providerResultCorrectionMilliseconds
  })
  const next = yield* Schema.decodeUnknownEffect(KimiResultCycle)({
    ...retained,
    responses: [...retained.responses, { _tag: "RequestIntended", intent: request }]
  })
  return { _tag: "CorrectionPrepared" as const, cycle: next, request }
})
