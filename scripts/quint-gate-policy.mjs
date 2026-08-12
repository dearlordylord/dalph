const second = 1000

export const quintGateSafetyTimeoutMilliseconds = 480 * second
// Eight canonical models plus the task-fact, executor, and application Exit
// proof projections include Run activation, promotion, exact-choice,
// command/reconciliation, cutoff, and lifecycle negative profiles. The prior
// seven-model gate measured 281.63 seconds on 2026-08-09 (Quint 0.32.0,
// linux-aarch64); the application Exit checks add about 30 seconds locally.
// Keep the regression budget distinct from the safety timeout used to stop a
// wedged process on supported ARM/x86 images.
export const quintGateRegressionBudgetMilliseconds = 360 * second
