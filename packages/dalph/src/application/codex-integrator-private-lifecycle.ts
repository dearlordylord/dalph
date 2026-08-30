import type { IntegratorRunCorrelation } from "@dalph/orchestrator"

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

export const providerRunAdmissionError = (
  run: IntegratorRunCorrelation,
  hasSealedInitialRun: boolean
): string | undefined => {
  if (!isSupportedProviderRun(run)) return "provider run ordinal exceeds Retry"
  return isRetryProviderRun(run) && !hasSealedInitialRun ? "Retry run two has no sealed run-one result" : undefined
}

/** A new candidate may bind only run one; Retry needs a sealed predecessor record. */
export const newPrivateRecordRunError = (run: IntegratorRunCorrelation): string | undefined => {
  const admissionError = providerRunAdmissionError(run, false)
  return admissionError === undefined && !isInitialProviderRun(run)
    ? "Retry run two has no sealed run-one result"
    : admissionError
}
