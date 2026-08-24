import { Effect, Option, Schema } from "effect"
import { type CodexTurnSnapshot } from "./codex-app-server.js"
import { collectText } from "./codex-planned-attempt-executor.js"
import {
  IntegratorCandidateText,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  type IntegratorRunCorrelation
} from "@dalph/orchestrator"

const lastElementOffset = -1

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isAgentMessage = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  return value["type"] === "agentMessage"
}

const malformedEnvelope = (run: IntegratorRunCorrelation): IntegratorResult =>
  IntegratorResult.cases.NotPrepared.make({
    correlation: run,
    detail: IntegratorNotPreparedDetail.make("Codex returned a malformed result envelope")
  })

const hasEnvelopeShape = (value: Record<string, unknown>): boolean =>
  ["candidate,outcome,version", "detail,outcome,version"].includes(Object.keys(value).sort().join(","))

const decodePreparedEnvelope = (value: Record<string, unknown>, run: IntegratorRunCorrelation): IntegratorResult => {
  const candidate = Schema.decodeUnknownOption(IntegratorCandidateText)(value["candidate"])
  return Option.isSome(candidate)
    ? IntegratorResult.cases.PreparedCandidate.make({ correlation: run, candidateText: candidate.value })
    : malformedEnvelope(run)
}

const decodeNotPreparedEnvelope = (value: Record<string, unknown>, run: IntegratorRunCorrelation): IntegratorResult => {
  const detail = Schema.decodeUnknownOption(IntegratorNotPreparedDetail)(value["detail"])
  return Option.isSome(detail)
    ? IntegratorResult.cases.NotPrepared.make({ correlation: run, detail: detail.value })
    : malformedEnvelope(run)
}

const decodeEnvelopeObject = (value: Record<string, unknown>, run: IntegratorRunCorrelation): IntegratorResult => {
  if (!hasEnvelopeShape(value) || value["version"] !== 1) return malformedEnvelope(run)
  if (value["outcome"] === "PreparedCandidate") return decodePreparedEnvelope(value, run)
  if (value["outcome"] === "NotPrepared") return decodeNotPreparedEnvelope(value, run)
  return malformedEnvelope(run)
}

export const exactEnvelope = (
  turn: CodexTurnSnapshot,
  run: IntegratorRunCorrelation
): Effect.Effect<IntegratorResult> =>
  Effect.gen(function* () {
    const messages = turn.items.filter(isAgentMessage)
    const finalMessage = messages.at(lastElementOffset)
    if (finalMessage === undefined) {
      return IntegratorResult.cases.NotPrepared.make({
        correlation: run,
        detail: IntegratorNotPreparedDetail.make("Codex returned no unique result envelope")
      })
    }
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(collectText(finalMessage)),
      catch: () => undefined
    }).pipe(Effect.option)
    if (Option.isNone(parsed) || !isRecord(parsed.value)) return malformedEnvelope(run)
    return decodeEnvelopeObject(parsed.value, run)
  })
