import type { startInputObserver } from "./gate-input-observer.mjs"

export interface FormalToolchain {
  readonly version: number
  readonly platform: string
  readonly architecture: string
  readonly runtimePolicy?: string
  readonly runtimeRoots?: ReadonlyArray<string>
  readonly roots: ReadonlyArray<string>
  readonly allowedRoots: ReadonlyArray<string>
  readonly requiredRoots: ReadonlyArray<string>
  readonly pythonExecutable: string
  readonly nodeExecutable?: string
  readonly pnpmExecutable?: string
  readonly quintEntryPoint?: string
  readonly javaExecutable?: string
  readonly javaRoot?: string
  readonly javaUserHome: string
  readonly configPaths?: ReadonlyArray<string>
  readonly javaArguments?: ReadonlyArray<string>
  readonly evaluatorPath?: string
  readonly apalacheJar?: string
  readonly versions: Readonly<Record<string, string>>
}
export interface FormalInputIdentity {
  readonly version: number
  readonly observerVersion: number
  readonly host: { readonly hostname: string; readonly bootId: string }
  readonly worktree: string
  readonly sourceDigest: string
  readonly toolDigest: string
  readonly environmentDigest: string
  readonly profileDigest: string
  readonly inputDigest: string
  readonly sourceManifest: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly toolManifest: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly environmentDigests: Readonly<Record<string, unknown>>
  readonly toolchain: FormalToolchain
  readonly profile: unknown
}
export interface FormalInputObservation {
  readonly version: number
  readonly observerVersion: number
  readonly ready: true
  readonly drained: true
  readonly unchanged: true
  readonly inputDigest: string
}
export declare const formalInputPolicyVersion: number
export declare const resolveFormalExecutable: (
  name: string,
  environment: NodeJS.ProcessEnv,
  worktree: string
) => Promise<string>
export declare const createFormalEnvironment: (callerEnvironment?: NodeJS.ProcessEnv) => Record<string, string>
export declare const resolveFormalToolchain: (options: {
  readonly worktree: string
  readonly effectiveEnvironment: NodeJS.ProcessEnv
  readonly timeoutMilliseconds?: number
}) => Promise<FormalToolchain>
export declare const startFormalInputGuard: (options: {
  readonly worktree: string
  readonly effectiveEnvironment: NodeJS.ProcessEnv
  readonly profile: unknown
  readonly toolchain: FormalToolchain
  readonly setupTimeoutMilliseconds?: number
  readonly qualificationTimeoutMilliseconds?: number
  readonly startObserver?: typeof startInputObserver
}) => Promise<{
  readonly identity: FormalInputIdentity
  readonly timings: { readonly observerSetupMilliseconds: number; readonly initialSnapshotMilliseconds: number; readonly qualificationMilliseconds: ReadonlyArray<number> }
  readonly assertUnchanged: (options?: { readonly timeoutMilliseconds?: number }) => Promise<void>
  readonly finish: (options?: { readonly timeoutMilliseconds?: number }) => Promise<FormalInputObservation>
  readonly close: () => Promise<void>
}>

export declare const quintImportSources: (text: string, sourceLocation: string) => ReadonlyArray<string>
