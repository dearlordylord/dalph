export type QuintGateBatchOutcome<A> =
  | { readonly status: "fulfilled"; readonly value: A }
  | { readonly status: "rejected"; readonly reason: unknown }

export type QuintGateBatchEntry<A> = QuintGateBatchOutcome<A> | undefined

export interface QuintGateFamilyRunArguments<Command, Result> {
  readonly commands: ReadonlyArray<Command>
  readonly concurrency?: number
  readonly run: (command: Command, signal: AbortSignal) => Promise<Result> | Result
}

export declare const quintGateFamilyConcurrency: 2
export declare const quintGateBatchResults: (
  failure: unknown
) => ReadonlyArray<QuintGateBatchEntry<unknown>> | undefined
export declare const runQuintGateFamily: <Command, Result>(
  args: QuintGateFamilyRunArguments<Command, Result>
) => Promise<ReadonlyArray<Result>>
