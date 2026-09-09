export function resolveQualityGateBase(input: {
  readonly candidateBase?: string
  readonly canonicalize?: (revision: string) => string
  readonly hostedBase?: string
  readonly isAncestor?: (base: string, head: string) => boolean
  readonly readHead?: () => string
  readonly resolveBase?: (requested?: string) => string
}): string
