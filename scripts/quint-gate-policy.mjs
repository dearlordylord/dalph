const second = 1000

export const quintGateSafetyTimeoutMilliseconds = 420 * second
// Six independently compiled model profiles now include the full promotion
// intent/read/CAS/reconciliation state space. Keep the gate bounded while
// allowing the complete finite checks to run on the supported ARM/x86 image.
export const quintGateRegressionBudgetMilliseconds = 150 * second
