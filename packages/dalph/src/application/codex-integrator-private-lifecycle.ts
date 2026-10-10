import { Schema } from "effect"
import { CodexOwnedTurnToken, CodexTurnId } from "./codex-attempt-store.js"
import { IntegratorResult, IntegratorRunCorrelation } from "@dalph/orchestrator"

const ordinalOf = (run: IntegratorRunCorrelation): number => Number(run.ordinal)

export const isInitialProviderRun = (run: IntegratorRunCorrelation): boolean => ordinalOf(run) === 1
export const isRetryProviderRun = (run: IntegratorRunCorrelation): boolean => ordinalOf(run) > 1
export const isSupportedProviderRun = (run: IntegratorRunCorrelation): boolean =>
  Number.isSafeInteger(ordinalOf(run)) && ordinalOf(run) > 0

/** The next contiguous ordinal, failing closed at representational exhaustion. */
export const expectedProviderRunOrdinalAt = (index: number): number | undefined =>
  Number.isSafeInteger(index) && index >= 0 && index < Number.MAX_SAFE_INTEGER ? index + 1 : undefined

const privateRunIdentityFields = { correlation: IntegratorRunCorrelation, token: CodexOwnedTurnToken }

/** One exact provider turn, whose variant carries only facts established at that chronological boundary. */
export const CodexIntegratorPrivateRun = Schema.TaggedUnion({
  IntentRecorded: privateRunIdentityFields,
  TurnBoundaryCrossing: privateRunIdentityFields,
  TurnObserved: { ...privateRunIdentityFields, turnId: CodexTurnId },
  CompletedTurnSealed: { ...privateRunIdentityFields, result: IntegratorResult, turnId: CodexTurnId },
  FailedTurnSealed: { ...privateRunIdentityFields, result: IntegratorResult.cases.NotPrepared, turnId: CodexTurnId }
})
export type CodexIntegratorPrivateRun = typeof CodexIntegratorPrivateRun.Type

/** Durable terminal provider evidence: the exact turn and its completed or failed Integrator result. */
export const CodexIntegratorSealedPrivateRun = Schema.Union([
  CodexIntegratorPrivateRun.cases.CompletedTurnSealed,
  CodexIntegratorPrivateRun.cases.FailedTurnSealed
])
export type CodexIntegratorSealedPrivateRun = typeof CodexIntegratorSealedPrivateRun.Type

export const isSealedPrivateRun = (
  run: CodexIntegratorPrivateRun | undefined
): run is CodexIntegratorSealedPrivateRun => run !== undefined && Schema.is(CodexIntegratorSealedPrivateRun)(run)

/** Non-empty exact provider history; record validation checks contiguous ordinals and sealed predecessors. */
export const CodexIntegratorPrivateRunHistory = Schema.NonEmptyArray(CodexIntegratorPrivateRun)
export type CodexIntegratorPrivateRunHistory = typeof CodexIntegratorPrivateRunHistory.Type

/** Non-empty cleanup history containing only sealed terminal evidence. */
export const CodexIntegratorSealedPrivateRunHistory = Schema.NonEmptyArray(CodexIntegratorSealedPrivateRun)
export type CodexIntegratorSealedPrivateRunHistory = typeof CodexIntegratorSealedPrivateRunHistory.Type

export const providerRunAdmissionError = (
  run: IntegratorRunCorrelation,
  hasSealedPredecessor: boolean
): string | undefined => {
  if (!isSupportedProviderRun(run)) return "provider run ordinal is not a positive safely representable integer"
  return isRetryProviderRun(run) && !hasSealedPredecessor ? "Retry has no sealed predecessor result" : undefined
}

/** Adds only the next canonical run, requiring sealed predecessor evidence before the Retry transition. */
export const appendPrivateRunHistory = (
  history: ReadonlyArray<CodexIntegratorPrivateRun>,
  run: CodexIntegratorPrivateRun
): CodexIntegratorPrivateRunHistory | undefined => {
  if (ordinalOf(run.correlation) !== expectedProviderRunOrdinalAt(history.length)) return undefined
  if (providerRunAdmissionError(run.correlation, history.every(isSealedPrivateRun)) !== undefined) return undefined
  const first = history[0]
  return CodexIntegratorPrivateRunHistory.make(first === undefined ? [run] : [first, ...history.slice(1), run])
}

/** Narrows a complete provider history to the cleanup-compatible sealed history shape. */
export const sealedPrivateRunHistoryFrom = (
  history: ReadonlyArray<CodexIntegratorPrivateRun>
): CodexIntegratorSealedPrivateRunHistory | undefined => {
  const first = history[0]
  if (!isSealedPrivateRun(first)) return undefined
  const remaining = history.slice(1)
  return remaining.every(isSealedPrivateRun)
    ? CodexIntegratorSealedPrivateRunHistory.make([first, ...remaining])
    : undefined
}

/** A new candidate may bind only run one; Retry needs a sealed predecessor record. */
export const newPrivateRecordRunError = (run: IntegratorRunCorrelation): string | undefined => {
  const admissionError = providerRunAdmissionError(run, false)
  /* v8 ignore next -- @preserve every supported non-initial run is an explicit Retry, and providerRunAdmissionError already rejects it when no sealed initial run exists. */
  return admissionError === undefined && !isInitialProviderRun(run)
    ? "Retry has no sealed predecessor result"
    : admissionError
}
