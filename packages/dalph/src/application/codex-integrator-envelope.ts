import { Effect, Option, Schema } from "effect"
import { type CodexTurnSnapshot } from "./codex-app-server.js"
import { collectText } from "./codex-planned-attempt-executor.js"
import {
  IntegratorCandidateText,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  type IntegratorRunCorrelation
} from "@dalph/orchestrator"

/** Model-owned integration proposal; fixed session/run identities are bound by the provider adapter. */
const PreparedIntegrationSemanticResult = Schema.Struct({
  version: Schema.Literal(1),
  outcome: Schema.Literal("PreparedCandidate"),
  candidate: IntegratorCandidateText
})

const NotPreparedIntegrationSemanticResult = Schema.Struct({
  version: Schema.Literal(1),
  outcome: Schema.Literal("NotPrepared"),
  detail: IntegratorNotPreparedDetail
})

const IntegratorSemanticResult = Schema.Union([PreparedIntegrationSemanticResult, NotPreparedIntegrationSemanticResult])

const lastElementOffset = -1
const escapeParity = 2

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

const quoteIsEscaped = (text: string, index: number): boolean => {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) backslashes += 1
  return backslashes % escapeParity === 1
}

/** Finds the one balanced JSON object ending at the message boundary in one reverse scan. */
const terminalObjectStart = (text: string): number | undefined => {
  if (!text.endsWith("}")) return undefined
  let depth = 0
  let inString = false
  for (let cursor = text.length - 1; cursor >= 0; cursor -= 1) {
    const character = text[cursor]
    if (character === '"' && !quoteIsEscaped(text, cursor)) {
      inString = !inString
    } else if (!inString && character === "}") {
      depth += 1
    } else if (!inString && character === "{") {
      depth -= 1
      if (depth === 0) return cursor
      if (depth < 0) return undefined
    }
  }
  return undefined
}

const decodeEnvelopeObject = (value: Record<string, unknown>, run: IntegratorRunCorrelation): IntegratorResult => {
  const semantic = Schema.decodeUnknownOption(IntegratorSemanticResult)(value, { onExcessProperty: "error" })
  if (Option.isNone(semantic)) return malformedEnvelope(run)
  return semantic.value.outcome === "PreparedCandidate"
    ? IntegratorResult.cases.PreparedCandidate.make({ correlation: run, candidateText: semantic.value.candidate })
    : IntegratorResult.cases.NotPrepared.make({ correlation: run, detail: semantic.value.detail })
}

/**
 * Providers may stream progress prose before their one terminal envelope.
 * Accept only a valid JSON object that reaches the end of the message; the
 * envelope decoder still rejects extra keys, wrong versions, and bad fields.
 */
export const parseTerminalEnvelope = (text: string): Record<string, unknown> | undefined => {
  const trimmed = text.trim()
  const start = terminalObjectStart(trimmed)
  if (start === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start))
    return isRecord(parsed) && hasEnvelopeShape(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Decode only after the caller has reconciled the exact owned provider thread and turn. */
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
