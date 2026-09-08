export interface QuintGatePlannedCommand {
  readonly name: string
  readonly args: ReadonlyArray<string>
}

export interface QuintGatePlannedFamily {
  readonly concurrency: number
  readonly serializedPrefix: number
  readonly commands: ReadonlyArray<QuintGatePlannedCommand>
}

export declare const plannedAttemptExecutorInitialFamily: QuintGatePlannedFamily
