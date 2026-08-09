const second = 1000

export const quintGateSafetyTimeoutMilliseconds = 420 * second
// Six independently compiled model profiles now include promotion plus the
// exact-choice and executor command/reconciliation negative profiles. The
// complete gate measured 245 seconds after #65; retain headroom below the
// separate 420-second safety timeout for supported ARM/x86 images.
export const quintGateRegressionBudgetMilliseconds = 300 * second
