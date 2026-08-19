import { Schema } from "effect"

/**
 * Test-only positions in one ambiguity-crossing chronology.
 *
 * P0 precedes the first boundary intent. P1 retains that intent. P2 retains a
 * separate provider-attempt intent when the protocol has one. P3 retains the
 * provider outcome or lost-response fact. P4 retains a reconciliation-read
 * intent. P5 retains its observation. P6 retains the accepted terminal fact.
 */
export const recoveryPrefixCutLabels = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"] as const
const RecoveryPrefixCutLabel = Schema.Literals(recoveryPrefixCutLabels)
export type RecoveryPrefixCutLabel = typeof RecoveryPrefixCutLabel.Type

/** Seven retained cuts executed once through each of the two journal stores. */
export const recoveryPrefixDualStoreExecutionCount = 14

export const recoveryPrefixCutMeaning: Record<RecoveryPrefixCutLabel, string> = {
  P0: "the record immediately before the first boundary intent",
  P1: "the first durable boundary intent",
  P2: "a separate durable provider-attempt intent",
  P3: "the provider outcome or recorded lost-response fact",
  P4: "a reconciliation-read intent after an uncertain outcome",
  P5: "the matching reconciliation observation",
  P6: "the boundary's accepted terminal fact"
}
