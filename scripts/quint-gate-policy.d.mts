export declare const quintGateRegressionBudgetMilliseconds: number
export declare const quintHostedJobTimeoutMinutes: number
export declare const quintHostedReserveMilliseconds: number
export declare const quintGateTerminationGraceMilliseconds: number
export declare const quintGateProcessGroupAbsenceTimeoutMilliseconds: number
export declare const quintGateSafetyTimeoutMilliseconds: number
export declare const assertQuintHostedDeadlineContract: (workflow: string) => void
export declare const createQuintGateDeadline: (options?: {
  readonly now?: () => number
  readonly startedAt?: number
}) => (name: string) => number
