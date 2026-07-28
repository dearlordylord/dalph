const second = 1000

export const quintGateSafetyTimeoutMilliseconds = 1380 * second
export const taskSessionModelBudgetMilliseconds = 100 * second
export const frontierModelWarningMilliseconds = 1080 * second
export const frontierModelBudgetMilliseconds = 1200 * second
export const quintGateRegressionBudgetMilliseconds =
  taskSessionModelBudgetMilliseconds + frontierModelBudgetMilliseconds
