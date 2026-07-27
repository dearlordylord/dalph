const second = 1000

export const quintGateSafetyTimeoutMilliseconds = 420 * second
export const taskSessionModelBudgetMilliseconds = 100 * second
export const frontierModelWarningMilliseconds = 270 * second
export const frontierModelBudgetMilliseconds = 300 * second
export const quintGateRegressionBudgetMilliseconds =
  taskSessionModelBudgetMilliseconds + frontierModelBudgetMilliseconds
