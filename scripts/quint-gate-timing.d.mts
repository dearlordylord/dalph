export type QuintCommandKind = "typecheck" | "test" | "sampled-run" | "verify"

export interface QuintTimingRecord {
  readonly durationMilliseconds: number
  readonly kind: QuintCommandKind
  readonly name: string
}

export interface QuintTimingAggregate {
  readonly count: number
  readonly durationMilliseconds: number
}

export interface QuintGateTiming {
  readonly aggregates: () => Readonly<Record<QuintCommandKind, QuintTimingAggregate>>
  readonly measure: <A>(args: {
    readonly kind: QuintCommandKind
    readonly name: string
    readonly run: () => Promise<A> | A
  }) => Promise<A>
  readonly records: () => ReadonlyArray<QuintTimingRecord>
}

export declare const quintCommandKinds: ReadonlyArray<QuintCommandKind>
export declare const quintCommandKindForArgs: (args: ReadonlyArray<string>) => QuintCommandKind
export declare const formatQuintGateTimingReport: (timing: QuintGateTiming) => string
export declare const createQuintGateTiming: (options?: { readonly now?: () => number }) => QuintGateTiming
export declare const runWithQuintGateTiming: <A>(args: {
  readonly run: () => Promise<A> | A
  readonly timing: QuintGateTiming
  readonly write?: (report: string) => void
}) => Promise<A>
