import { Schema } from "effect"
import { AttemptId, RunId } from "@dalph/contracts"
import {
  ProviderResultCycle,
  providerResultCycleTransitionProblem,
  sameProviderResultResponseIntent
} from "./provider-result-correction.js"

/** Application-allocated identity of one committed Continue permission; never supplied by a model. */
export const ProviderResultRecoveryAuthorizationId = Schema.Struct({
  nonce: Schema.NonEmptyString,
  runId: RunId,
  attemptId: AttemptId
}).pipe(Schema.brand("ProviderResultRecoveryAuthorizationId"))
export type ProviderResultRecoveryAuthorizationId = typeof ProviderResultRecoveryAuthorizationId.Type

/** Retains the complete predecessor response budget when an explicit permission opens a new cycle. */
export const ProviderResultRecoveryRecord = Schema.Struct({
  authorizationId: ProviderResultRecoveryAuthorizationId,
  predecessor: ProviderResultCycle,
  successorInitial: ProviderResultCycle
}).check(
  Schema.makeFilter((record) => {
    const before = record.predecessor
    const next = record.successorInitial
    if (before.cycleId === next.cycleId) return "recovery requires a distinct response cycle"
    if (before.plannedBaseSha === undefined || before.plannedBaseSha !== next.plannedBaseSha)
      return "retained-work recovery preserves its proven original planning Base"
    const initialProblem = providerResultCycleTransitionProblem(undefined, next)
    if (initialProblem !== undefined) return initialProblem
    const initial = next.responses[0]
    if (initial === undefined) return "recovery requires an initial response"
    const previousTokens = new Set(before.responses.map(({ intent }) => intent.token))
    if (previousTokens.has(initial.intent.token)) return "recovery requires a fresh owned request token"
    const latestFact = Math.max(
      ...before.responses.map((response) =>
        response._tag === "ResponseRejected" ? response.responseObservedAt : response.intent.intendedAt
      )
    )
    if (initial.intent.intendedAt < latestFact) return "recovery cannot precede its predecessor response facts"
    return undefined
  })
)
export type ProviderResultRecoveryRecord = typeof ProviderResultRecoveryRecord.Type

/** Immutable ordered permissions and full cycle snapshots; no counter substitutes for retained facts. */
export const ProviderResultRecoveryHistory = Schema.Array(ProviderResultRecoveryRecord).check(
  Schema.makeFilter((history) => {
    const nonces = new Set<string>()
    const cycles = new Set<string>()
    const tokenCycles = new Map<string, string>()
    const first = history[0]
    for (const [index, entry] of history.entries()) {
      if (nonces.has(entry.authorizationId.nonce)) return "one Continue permission cannot open another cycle"
      nonces.add(entry.authorizationId.nonce)
      for (const cycle of [entry.predecessor, entry.successorInitial]) {
        for (const { intent } of cycle.responses) {
          const owner = tokenCycles.get(intent.token)
          if (owner !== undefined && owner !== cycle.cycleId)
            return "an older cycle token cannot authorize a new request"
          tokenCycles.set(intent.token, cycle.cycleId)
        }
      }

      if (
        first !== undefined &&
        (entry.authorizationId.runId !== first.authorizationId.runId ||
          entry.authorizationId.attemptId !== first.authorizationId.attemptId)
      )
        return "recovery history belongs to one exact attempt"
      if (index === 0) cycles.add(entry.predecessor.cycleId)
      const previous = history[index - 1]
      if (previous !== undefined) {
        const previousInitial = previous.successorInitial.responses[0]
        const currentInitial = entry.predecessor.responses[0]
        if (previousInitial === undefined || currentInitial === undefined)
          return "recovery history requires retained initial responses"
        if (
          previous.successorInitial.cycleId !== entry.predecessor.cycleId ||
          previous.successorInitial.plannedBaseSha !== entry.predecessor.plannedBaseSha ||
          !sameProviderResultResponseIntent(previousInitial.intent, currentInitial.intent)
        )
          return "recovery predecessor must extend its previously recorded initial cycle"
      }
      if (cycles.has(entry.successorInitial.cycleId)) return "historical cycles cannot be reopened"
      cycles.add(entry.successorInitial.cycleId)
    }
    return undefined
  })
)
export type ProviderResultRecoveryHistory = typeof ProviderResultRecoveryHistory.Type

/** Ordinary writes retain every permission and snapshot; one explicit recovery may append one entry. */
export const providerResultRecoveryHistoryTransitionProblem = (
  previous: ProviderResultRecoveryHistory,
  next: ProviderResultRecoveryHistory
): string | undefined => {
  if (next.length < previous.length) return "retained recovery history cannot be removed"
  if (next.length > previous.length + 1) return "only one explicit recovery may be appended"
  const same = Schema.toEquivalence(ProviderResultRecoveryRecord)
  for (const [index, entry] of previous.entries()) {
    const successor = next[index]
    if (successor === undefined || !same(entry, successor))
      return "historical recovery permission and cycle facts are immutable"
  }
  return undefined
}
