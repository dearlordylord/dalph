import { Effect, Schema } from "effect"

const millisecondsPerSecond = 1_000
const secondsPerMinute = 60
const maximumMinutes = 90
const maximumOrdinaryMinutes = 10
// eslint-disable-next-line no-magic-numbers -- This is the fallback when no ordinary limit is configured.
const defaultLimitMilliseconds = 60_000 as const

/** Positive duration of one executor-private Codex tool item. */
export const CodexToolEffectLimitMilliseconds = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(millisecondsPerSecond),
  Schema.isLessThanOrEqualTo(maximumMinutes * secondsPerMinute * millisecondsPerSecond)
).pipe(Schema.brand("CodexToolEffectLimitMilliseconds"))
export type CodexToolEffectLimitMilliseconds = typeof CodexToolEffectLimitMilliseconds.Type

/** Configuration locator resolved to the exact owned worktree before turn/start. */
export const PlannedCodexWorktree = Schema.Struct({ _tag: Schema.Literal("PlannedWorktree") })
export type PlannedCodexWorktree = typeof PlannedCodexWorktree.Type

/** An exact command item admitted to run longer than the ordinary item limit. */
export const CodexLongCommandAllowance = Schema.Struct({
  command: Schema.NonEmptyString,
  cwd: Schema.Union([Schema.NonEmptyString, PlannedCodexWorktree]),
  limitMilliseconds: CodexToolEffectLimitMilliseconds
})
export type CodexLongCommandAllowance = typeof CodexLongCommandAllowance.Type

/** Private executor policy; command text and cwd are matched as complete strings. */
export const CodexToolEffectPolicy = Schema.Struct({
  defaultLimitMilliseconds: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(millisecondsPerSecond),
    Schema.isLessThanOrEqualTo(maximumOrdinaryMinutes * secondsPerMinute * millisecondsPerSecond)
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(defaultLimitMilliseconds))),
  longCommands: Schema.Array(CodexLongCommandAllowance).pipe(Schema.withDecodingDefaultKey(Effect.succeed([])))
}).check(
  Schema.makeFilter((policy) => {
    const keys = policy.longCommands.map((profile) => JSON.stringify([profile.cwd, profile.command]))
    return new Set(keys).size === keys.length ? undefined : "long command allowances must be unique"
  })
)
export type CodexToolEffectPolicy = typeof CodexToolEffectPolicy.Type

/** Freeze a reusable command profile to this attempt's exact worktree. */
export const bindCodexToolEffectPolicy = (policy: CodexToolEffectPolicy, worktree: string): CodexToolEffectPolicy =>
  CodexToolEffectPolicy.make({
    defaultLimitMilliseconds: policy.defaultLimitMilliseconds,
    longCommands: policy.longCommands.map((profile) => ({
      ...profile,
      cwd: typeof profile.cwd === "string" ? profile.cwd : worktree
    }))
  })

/** Only a decoded command-execution item may use a larger declared allowance. */
export interface CodexToolEffectStart {
  readonly kind: "commandExecution" | "fileChange" | "dynamicToolCall"
  readonly command?: string
  readonly cwd?: string
}

export const codexToolEffectLimit = (
  policy: CodexToolEffectPolicy,
  item: CodexToolEffectStart
): CodexToolEffectLimitMilliseconds => {
  if (item.kind !== "commandExecution" || item.command === undefined || item.cwd === undefined) {
    return CodexToolEffectLimitMilliseconds.make(policy.defaultLimitMilliseconds)
  }
  const matching = policy.longCommands.filter((profile) => profile.command === item.command && profile.cwd === item.cwd)
  const [single] = matching
  return matching.length === 1 && single !== undefined
    ? single.limitMilliseconds
    : CodexToolEffectLimitMilliseconds.make(policy.defaultLimitMilliseconds)
}
