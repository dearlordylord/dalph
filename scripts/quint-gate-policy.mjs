const second = 1000

export const quintGateSafetyTimeoutMilliseconds = 420 * second
// Seven canonical models plus the task-fact and executor proof projections
// include Run activation, promotion, exact-choice, and command/reconciliation
// negative profiles. After adding the seventh canonical model, the complete
// finite gate measured 281.63 seconds on 2026-08-09 (Quint 0.32.0,
// linux-aarch64). Keep its regression budget distinct from the 420-second
// safety timeout used to stop a wedged process on supported ARM/x86 images.
export const quintGateRegressionBudgetMilliseconds = 300 * second
