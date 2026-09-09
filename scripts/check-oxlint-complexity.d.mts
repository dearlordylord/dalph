export interface ComplexitySuppressionRegistry {
  readonly [filename: string]: {
    readonly complexity: {
      readonly count: number
      readonly justification?: string
    }
  }
}

export function suppressionPolicyViolations(input: {
  readonly baseline?: ComplexitySuppressionRegistry
  readonly current: ComplexitySuppressionRegistry
}): ReadonlyArray<string>

export function prunedSuppressionRegistry(input: {
  readonly counts: ReadonlyMap<string, number>
  readonly current: ComplexitySuppressionRegistry
}): ComplexitySuppressionRegistry

export function checkOxlintComplexity(): void
