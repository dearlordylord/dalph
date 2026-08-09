const second = 1000

export const quintGateSafetyTimeoutMilliseconds = 420 * second
// Six canonical models plus the task-fact and executor proof projections now
// include promotion, exact-choice, and command/reconciliation negative
// profiles. The complete gate measured 113 seconds after the executor proof
// projections; retain headroom below the separate 420-second safety timeout
// for supported ARM/x86 images.
export const quintGateRegressionBudgetMilliseconds = 300 * second
