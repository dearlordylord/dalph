export declare const assertRequiredWitnessesObserved: (
  output: string,
  requiredWitnesses: ReadonlyArray<string>
) => ReadonlyMap<string, number>
export declare const quintWitnessesFromCommandArgs: (args: ReadonlyArray<string>) => ReadonlyArray<string>
export declare const assertQuintSampledCommandWitnessesObserved: (args: {
  readonly args: ReadonlyArray<string>
  readonly name: string
  readonly output: string
}) => ReadonlyMap<string, number>
export declare const assertTaskFactReplacementTestCollected: (args: {
  readonly args: ReadonlyArray<string>
  readonly output: string
}) => void
export declare const validateQuintCommandOutput: (args: {
  readonly args: ReadonlyArray<string>
  readonly name: string
  readonly output: string
}) => ReadonlyMap<string, number> | undefined
