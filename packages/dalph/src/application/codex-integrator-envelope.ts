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

/**
 * Providers may stream progress prose before their one terminal envelope.
 * Accept only a valid JSON object that reaches the end of the message; the
 * envelope decoder still rejects extra keys, wrong versions, and bad fields.
 */
const parseTerminalEnvelope = (text: string): Record<string, unknown> | undefined => {
  const trimmed = text.trim()
  for (let start = trimmed.lastIndexOf("{"); start >= 0; start = trimmed.lastIndexOf("{", start - 1)) {
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(start))
      if (isRecord(parsed) && hasEnvelopeShape(parsed)) return parsed
    } catch {
      continue
    }
  }
  return undefined
}

export const exactEnvelope = (
  turn: CodexTurnSnapshot,
  run: IntegratorRunCorrelation
): Effect.Effect<IntegratorResult> =>
  Effect.sync(() => {
    const messages = turn.items.filter(isAgentMessage)
    const finalMessage = messages.at(lastElementOffset)
    if (finalMessage === undefined) {
      return IntegratorResult.cases.NotPrepared.make({
        correlation: run,
        detail: IntegratorNotPreparedDetail.make("Codex returned no unique result envelope")
      })
    }
    const parsed = parseTerminalEnvelope(collectText(finalMessage))
    return parsed === undefined ? malformedEnvelope(run) : decodeEnvelopeObject(parsed, run)
  })
