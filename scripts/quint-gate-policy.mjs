const second = 1000

// Repeated Node 22/24 profiles are recorded in
// research/quint-hosted-equivalent-profile.md. The slowest complete profile
// took 572.29 seconds on 2026-08-24 (Quint 0.32.0, linux-aarch64) while other
// workspace lanes were active. Keep the provisional ten-minute internal bound
// to cover host variance and preserve a decreasing deadline that prevents a
// wedged process from consuming time beyond the gate budget. The hosted job
// reserves 16 minutes for this bound, frozen install, checkout/action setup,
// and an explicit margin.
export const quintGateRegressionBudgetMilliseconds = 600 * second
