import type { QuintEffectiveProfile } from "./quint-effective-profile.mjs"

export const quintHostedShardCount: 2
export const quintHostedModelFamilies: ReadonlyArray<{
  readonly name: string
  readonly first: number
  readonly last: number
  readonly shard: number
}>
export function quintHostedProfileDigest(profile: QuintEffectiveProfile): string
export interface QuintHostedShard {
  readonly version: 1
  readonly shard: number
  readonly shardCount: number
  readonly profileDigest: string
  readonly positions: ReadonlyArray<number>
  readonly steps: ReadonlyArray<unknown>
}
export function createQuintHostedShard(profile: QuintEffectiveProfile, shard: number): QuintHostedShard
export function assertCompleteQuintHostedPartition(profile: QuintEffectiveProfile): ReadonlyArray<QuintHostedShard>
export function assertQuintHostedCommandCustody(report: unknown): ReadonlyArray<string>
export function readQuintHostedShardBinding(
  environment?: NodeJS.ProcessEnv,
  runtimeNodeVersion?: string
): Readonly<{ runId: string; runAttempt: string; commitSha: string; nodeVersion: string }>
