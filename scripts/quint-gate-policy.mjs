const second = 1000

// Ten canonical models and thirteen proof projections completed in 513.90s,
// 459.80s, and 467.77s on 2026-09-04 (Quint 0.32.0, linux-arm64). The
// regression budget is the slowest measurement plus 15%, rounded up to 30s.
// The safety timeout is the greater of regression plus 25% and regression plus
// 120s, also rounded up to 30s. Keep the regression threshold distinct from
// the safety stop so a complete over-budget gate can report stage timings.
export const quintGateSafetyTimeoutMilliseconds = 750 * second
export const quintGateRegressionBudgetMilliseconds = 600 * second
