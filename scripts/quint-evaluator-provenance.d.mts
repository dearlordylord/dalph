export interface QuintEvaluatorProvenance {
  readonly architecture: string
  readonly bytes: number
  readonly evaluatorPath: string
  readonly evaluatorVersion: string
  readonly platform: NodeJS.Platform
  readonly quintPackageVersion: string
  readonly sha256: string
}

export declare const readQuintEvaluatorProvenance: (
  evaluatorPath?: string
) => Promise<Readonly<QuintEvaluatorProvenance>>
export declare const renderQuintEvaluatorProvenance: (provenance: QuintEvaluatorProvenance) => string
