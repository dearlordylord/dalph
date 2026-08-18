export interface EffectTsgoPlatformBinaryOptions {
  readonly architecture?: string
  readonly chmod?: (path: string, mode: number) => void
  readonly platform?: NodeJS.Platform
  readonly resolvePackageJson?: (platform: NodeJS.Platform, architecture: string) => string
}

export declare const ensureEffectTsgoPlatformBinaryExecutable: (
  options?: EffectTsgoPlatformBinaryOptions
) => void
