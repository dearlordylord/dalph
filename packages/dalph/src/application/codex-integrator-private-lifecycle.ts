import type { IntegratorRunCorrelation } from "@dalph/orchestrator"
import {
  type CodexIntegratorPrivateRecord,
  privateRuns,
  runCorrelationEquals
} from "./codex-integrator-private-store.js"

const maximumProviderRunOrdinal = 2

const cleanupDispositionError = (record: CodexIntegratorPrivateRecord): string | undefined => {
  if (record._tag === "Removed") return "private candidate record is tombstoned"
  return record._tag === "RemovalIntentRecorded"
    ? "private candidate cleanup disposition forbids provider preparation"
    : undefined
}

const sealedInitialRunAllowsRetry = (
  record: CodexIntegratorPrivateRecord,
  requestedRun: IntegratorRunCorrelation
): boolean => {
  if (Number(requestedRun.ordinal) !== maximumProviderRunOrdinal) return false
  const first = privateRuns(record)[0]
  return first?._tag === "CompletedTurnSealed" || first?._tag === "FailedTurnSealed"
}

/** Rejects preparation that would rewind cleanup or cross into a different, unauthorized provider run. */
export const providerPreparationError = (
  record: CodexIntegratorPrivateRecord,
  requestedRun: IntegratorRunCorrelation
): string | undefined => {
  const cleanupError = cleanupDispositionError(record)
  if (cleanupError !== undefined) return cleanupError
  if (privateRuns(record).some((run) => runCorrelationEquals(run.correlation, requestedRun))) return undefined
  return runCorrelationEquals(record.initialRun, requestedRun) || sealedInitialRunAllowsRetry(record, requestedRun)
    ? undefined
    : "private candidate is durably bound to another provider run"
}

/** A new candidate may bind only run one; Retry needs a sealed predecessor record. */
export const newPrivateRecordRunError = (run: IntegratorRunCorrelation): string | undefined =>
  Number(run.ordinal) > maximumProviderRunOrdinal
    ? "provider run ordinal exceeds Retry"
    : Number(run.ordinal) === 1
      ? undefined
      : "Retry run two has no sealed run-one result"
