import { Schema } from "effect"
import { CodexOwnedTurnToken, CodexTurnId } from "./codex-attempt-store.js"
import { IntegratorResult, IntegratorRunCorrelation } from "@dalph/orchestrator"

/** The provider run ordinal accepted for initial Integrator work. */
const initialProviderRunOrdinal = 1

/** The only provider run ordinal accepted for an Operator-authorized Retry. */
const retryProviderRunOrdinal = 2

/** The complete ordered provider-run lifecycle: initial work, then one Operator-authorized Retry. */
export const codexIntegratorProviderRunOrdinals = [initialProviderRunOrdinal, retryProviderRunOrdinal] as const
type CodexIntegratorProviderRunOrdinal = (typeof codexIntegratorProviderRunOrdinals)[number]

const ordinalOf = (run: IntegratorRunCorrelation): number => Number(run.ordinal)

export const isInitialProviderRun = (run: IntegratorRunCorrelation): boolean =>
  ordinalOf(run) === codexIntegratorProviderRunOrdinals[0]

export const isRetryProviderRun = (run: IntegratorRunCorrelation): boolean =>
  ordinalOf(run) === codexIntegratorProviderRunOrdinals[1]

export const isSupportedProviderRun = (run: IntegratorRunCorrelation): boolean =>
  codexIntegratorProviderRunOrdinals.some((ordinal) => ordinal === ordinalOf(run))

export const expectedProviderRunOrdinalAt = (index: number): CodexIntegratorProviderRunOrdinal | undefined =>
  codexIntegratorProviderRunOrdinals[index]

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

type ProviderRunHistory<
  Item,
  Ordinals extends ReadonlyArray<number> = typeof codexIntegratorProviderRunOrdinals,
  Prefix extends ReadonlyArray<Item> = readonly []
> = Ordinals extends readonly [number, ...infer Remaining extends ReadonlyArray<number>]
  ? readonly [...Prefix, Item] | ProviderRunHistory<Item, Remaining, readonly [...Prefix, Item]>
  : never

const boundedProviderRunHistory = <S extends Schema.Constraint>(item: S) =>
  Schema.NonEmptyArray(item).pipe(
    Schema.refine(
      (runs): runs is ProviderRunHistory<S["Type"]> => runs.length <= codexIntegratorProviderRunOrdinals.length,
      { message: "private record contains more than the initial and retry provider runs" }
    )
  )

/** Non-empty provider history bounded by the complete canonical run policy. */
export const CodexIntegratorPrivateRunHistory = boundedProviderRunHistory(CodexIntegratorPrivateRun)
export type CodexIntegratorPrivateRunHistory = typeof CodexIntegratorPrivateRunHistory.Type

/** Non-empty cleanup history containing only sealed terminal evidence and bounded by the run policy. */
export const CodexIntegratorSealedPrivateRunHistory = boundedProviderRunHistory(CodexIntegratorSealedPrivateRun)
export type CodexIntegratorSealedPrivateRunHistory = typeof CodexIntegratorSealedPrivateRunHistory.Type

export const providerRunAdmissionError = (
  run: IntegratorRunCorrelation,
  hasSealedInitialRun: boolean
): string | undefined => {
  if (!isSupportedProviderRun(run)) return "provider run ordinal exceeds Retry"
  return isRetryProviderRun(run) && !hasSealedInitialRun ? "Retry run two has no sealed run-one result" : undefined
}

/** Adds only the next canonical run, requiring sealed run-one evidence before the Retry transition. */
export const appendPrivateRunHistory = (
  history: ReadonlyArray<CodexIntegratorPrivateRun>,
  run: CodexIntegratorPrivateRun
): CodexIntegratorPrivateRunHistory | undefined => {
  if (ordinalOf(run.correlation) !== expectedProviderRunOrdinalAt(history.length)) return undefined
  if (providerRunAdmissionError(run.correlation, isSealedPrivateRun(history[0])) !== undefined) return undefined
  const first = history[0]
  return CodexIntegratorPrivateRunHistory.make(first === undefined ? [run] : [first, ...history.slice(1), run])
}

/** Narrows a complete provider history to the cleanup-compatible sealed history shape. */
export const sealedPrivateRunHistoryFrom = (
  history: ReadonlyArray<CodexIntegratorPrivateRun>
): CodexIntegratorSealedPrivateRunHistory | undefined => {
  const first = history[0]
  if (!isSealedPrivateRun(first) || history.length > codexIntegratorProviderRunOrdinals.length) return undefined
  const remaining = history.slice(1)
  return remaining.every(isSealedPrivateRun)
    ? CodexIntegratorSealedPrivateRunHistory.make([first, ...remaining])
    : undefined
}

/** A new candidate may bind only run one; Retry needs a sealed predecessor record. */
export const newPrivateRecordRunError = (run: IntegratorRunCorrelation): string | undefined => {
  const admissionError = providerRunAdmissionError(run, false)
  /* v8 ignore next -- @preserve the only supported non-initial run is Retry run two, and providerRunAdmissionError already rejects it when no sealed initial run exists. */
  return admissionError === undefined && !isInitialProviderRun(run)
    ? "Retry run two has no sealed run-one result"
    : admissionError
}
