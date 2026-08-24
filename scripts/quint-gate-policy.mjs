const second = 1000

// The previous complete recovery profile measured about 340 seconds locally
// on 2026-08-09 (Quint 0.32.0, linux-aarch64). A fresh 2026-08-24 run on the
// shared ARM host reached integration finality after the 420-second deadline
// while other repository lanes were active, so retain a measured larger bound
// until a quiet hosted profile can replace it. Ten minutes leaves two minutes
// inside the 12-minute hosted job timeout while the decreasing deadline still
// prevents a wedged process from consuming time beyond the gate budget.
export const quintGateRegressionBudgetMilliseconds = 600 * second
