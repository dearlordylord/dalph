const second = 1000

// Hosted reference: ubuntu-24.04-arm (4 CPUs), Node 24.15.0, Quint 0.32.0;
// cold run 33998647004 completed every check in 645.73s on 2026-09-05.
// Provisional regression budget: that sample +15%, rounded up to 30s.
// This replaces the 600s budget calibrated on an unspecified local ARM host.
// Safety stop: max(regression +25%, regression +120s), rounded up to 30s;
// it lets complete over-budget runs report timings without passing the gate.
export const quintGateSafetyTimeoutMilliseconds = 960 * second
export const quintGateRegressionBudgetMilliseconds = 750 * second
