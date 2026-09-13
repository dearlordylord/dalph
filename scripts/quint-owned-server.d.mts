export interface OwnedQuintSocket {
  readonly family: string
  readonly address: string
  readonly inode: string
}

/** A profile-complete stop is recorded before signalling the exact server group. */
export interface OwnedQuintServerStop {
  readonly version: 1
  readonly runId: string
  readonly obligationId: string
  readonly processGroup: number
  readonly serverEndpoint: string
  readonly disposition: "profile-complete"
  readonly requestedAt: string
}

/** Monotonic phase durations report execution cost; they do not identify inputs. */
export interface OwnedQuintServerTiming {
  readonly launchToOwnedSocketMilliseconds: number
  readonly reflectionReadinessMilliseconds: number
  readonly launchToReadyMilliseconds: number
  readonly plannedStopToProvenAbsenceMilliseconds: number
}

export interface OwnedQuintServerEvidence {
  readonly obligationId: string
  readonly processGroup: number
  readonly serverEndpoint: string
  readonly receiptPath: string
  readonly receipt: Readonly<Record<string, unknown>>
  readonly stopPath: string
  readonly stop: OwnedQuintServerStop
  readonly ownedSockets: ReadonlyArray<OwnedQuintSocket>
  readonly timing: OwnedQuintServerTiming
}

export interface OwnedQuintProfileContext {
  readonly serverEndpoint: string
  readonly environment: NodeJS.ProcessEnv
  readonly remainingExecutionMilliseconds: (name: string) => number
  readonly signal: AbortSignal
}

export declare const quintOwnedServerEnvironmentName: "DALPH_QUINT_OWNED_SERVER_ENDPOINT"
export declare const quintJavaExecutableEnvironmentName: "DALPH_QUINT_JAVA_EXECUTABLE"
export declare const quintJavaUserHomeEnvironmentName: "DALPH_QUINT_JAVA_USER_HOME"
export declare const ownedQuintServerEnvironment: (
  environment: NodeJS.ProcessEnv,
  serverEndpoint: string,
  java: { readonly javaExecutable: string; readonly javaUserHome: string }
) => NodeJS.ProcessEnv
export declare const ownedQuintListeningSockets: (port: number) => Array<OwnedQuintSocket>
export declare const withOwnedQuintServer: <Result>(options: {
  readonly javaExecutable: string
  readonly javaUserHome: string
  readonly apalacheJar: string
  readonly javaArguments: ReadonlyArray<string>
  readonly environment: NodeJS.ProcessEnv
  readonly remainingExecutionMilliseconds: (name: string) => number
  readonly runProfile: (context: OwnedQuintProfileContext) => Promise<Result>
  readonly signal?: AbortSignal
  readonly terminationGraceMilliseconds?: number
  readonly processGroupAbsenceTimeoutMilliseconds?: number
}) => Promise<{ readonly profileResult: Result; readonly serverEvidence: OwnedQuintServerEvidence }>
