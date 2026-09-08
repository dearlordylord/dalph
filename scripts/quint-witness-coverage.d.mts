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
