/* eslint-disable import/no-nodejs-modules -- This module validates native provider-home locators. */
import nodePath from "node:path"
import { Schema } from "effect"

/** Realpath-resolved provider home, bound before any owned process starts. */
export const CodexProviderHomeNamespace = Schema.NonEmptyString.check(
  Schema.makeFilter<string>((value) =>
    nodePath.isAbsolute(value) && nodePath.normalize(value) === value
      ? undefined
      : "provider-home namespace must be an absolute normalized path"
  )
).pipe(Schema.brand("CodexProviderHomeNamespace"))
export type CodexProviderHomeNamespace = typeof CodexProviderHomeNamespace.Type

/** Identifies one startup intent independently of its recoverable process incarnation. */
export const CodexServerStartupId = Schema.NonEmptyString.pipe(Schema.brand("CodexServerStartupId"))
export type CodexServerStartupId = typeof CodexServerStartupId.Type

/** Absolute epoch milliseconds observed at the startup boundary. */
export const CodexStartupInstantMilliseconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("CodexStartupInstantMilliseconds")
)
export type CodexStartupInstantMilliseconds = typeof CodexStartupInstantMilliseconds.Type

/** Original absolute queue-plus-initialize deadline; recovery cannot replenish it. */
export const CodexStartupDeadlineMilliseconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("CodexStartupDeadlineMilliseconds")
)
export type CodexStartupDeadlineMilliseconds = typeof CodexStartupDeadlineMilliseconds.Type

/** Accepted combined queue and initialization duration. */
const CodexStartupLimitMilliseconds = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CodexStartupLimitMilliseconds")
)
// eslint-disable-next-line no-magic-numbers -- The accepted startup deadline is thirty seconds.
export const codexStartupLimitMilliseconds = CodexStartupLimitMilliseconds.make(30_000)

const intentFields = {
  startupId: CodexServerStartupId,
  home: CodexProviderHomeNamespace,
  intendedAtMilliseconds: CodexStartupInstantMilliseconds,
  deadlineMilliseconds: CodexStartupDeadlineMilliseconds
} as const

/** Durable startup intent and its distinct observed initialization, outside workflow history. */
export const CodexServerStartupRecord = Schema.TaggedUnion({
  Pending: intentFields,
  Initialized: { ...intentFields, initializedAtMilliseconds: CodexStartupInstantMilliseconds }
}).check(
  Schema.makeFilter((record) =>
    record.deadlineMilliseconds - record.intendedAtMilliseconds !== codexStartupLimitMilliseconds
      ? "startup must retain the original thirty-second deadline"
      : record._tag === "Initialized" &&
          (record.initializedAtMilliseconds < record.intendedAtMilliseconds ||
            record.initializedAtMilliseconds > record.deadlineMilliseconds)
        ? "initialization must be observed inside its original deadline"
        : undefined
  )
)
export type CodexServerStartupRecord = typeof CodexServerStartupRecord.Type

/** A pending intent is immutable; only observed initialization permits a distinct later startup. */
export const startupTransitionProblem = (
  previous: CodexServerStartupRecord | undefined,
  next: CodexServerStartupRecord
): string | undefined => {
  if (previous === undefined) return next._tag === "Pending" ? undefined : "startup observation has no intent"
  if (previous.home !== next.home) return "retained provider-home namespace changed"
  if (previous.startupId !== next.startupId) {
    return previous._tag === "Initialized" && next._tag === "Pending"
      ? undefined
      : "unresolved startup cannot be replaced or receive another deadline"
  }
  if (
    previous.intendedAtMilliseconds !== next.intendedAtMilliseconds ||
    previous.deadlineMilliseconds !== next.deadlineMilliseconds
  ) {
    return "original startup deadline changed"
  }
  if (previous._tag === "Initialized") {
    return next._tag === "Initialized" && previous.initializedAtMilliseconds === next.initializedAtMilliseconds
      ? undefined
      : "observed initialization cannot be reversed or rewritten"
  }
  return undefined
}
