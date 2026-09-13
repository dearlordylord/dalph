export declare const inputObserverScript: string
export declare const startInputObserver: (options: {
  readonly roots: ReadonlyArray<string>
  readonly excludedRoots?: ReadonlyArray<string>
  readonly protectedRoots?: ReadonlyArray<string>
  readonly pythonExecutable?: string
  readonly pythonArguments?: ReadonlyArray<string>
  readonly environment?: NodeJS.ProcessEnv
  readonly timeoutMilliseconds?: number
  readonly signal?: AbortSignal
}) => Promise<{
  readonly assertUnchanged: () => Promise<void>
  readonly protect: (paths: ReadonlyArray<string>) => Promise<void>
  readonly pause: () => Promise<void>
  readonly processId: number | undefined
  readonly close: () => Promise<void>
}>
