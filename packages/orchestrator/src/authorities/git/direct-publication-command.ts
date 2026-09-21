import { GitRepositoryLocator, RemotePublicationEndpoint, type RemotePublicationTarget } from "@dalph/contracts"
import { Duration, Effect, Option, Schema } from "effect"
import type { GitCommandCustodySubject } from "./sender-custody.js"
import {
  GitCommandInterrupted,
  GitCommandResponseDeadline,
  GitCommandSenderStopUnproven,
  type GitCommandBoundedFailure,
  type GitCommandResult,
  type GitCommandService
} from "./command.js"
import {
  RemotePublicationObservationFailure,
  type RemotePublicationObservationFailureReason,
  RemotePublicationPushFailure,
  type RemotePublicationPushFailureReason,
  type RemotePublicationGitRequest
} from "../../workflow/protocols/direct-publication/events.js"

export const remoteObservationTimeout: Duration.Input = "30 seconds"
export const remotePushTimeout: Duration.Input = "120 seconds"

const gitConfigRewritePattern = "^url\\..*\\.(insteadOf|pushInsteadOf)$"
const urlConfigKeyPrefixLength = 4

type RewriteKind = "read" | "push"

interface RewriteRule {
  readonly kind: RewriteKind
  readonly prefix: string
  readonly replacement: string
}

export class EndpointMappingUnstable extends Schema.TaggedError<EndpointMappingUnstable>()(
  "EndpointMappingUnstable",
  {}
) {}

export type EndpointResolutionFailure = EndpointMappingUnstable | GitCommandBoundedFailure

export type RemoteOperationDeadline = number

export const operationDeadline = (budget: Duration.Input): Effect.Effect<RemoteOperationDeadline> =>
  Effect.clockWith((clock) => clock.currentTimeMillis).pipe(
    Effect.map((startedAt) => startedAt + Duration.toMillis(budget))
  )

const remainingOperationTimeout = (
  deadline: RemoteOperationDeadline
): Effect.Effect<Duration.Duration, GitCommandResponseDeadline> =>
  Effect.clockWith((clock) => clock.currentTimeMillis).pipe(
    Effect.flatMap((now) => {
      const remaining = deadline - now
      return remaining <= 0 ? Effect.fail(new GitCommandResponseDeadline()) : Effect.succeed(Duration.millis(remaining))
    })
  )

export const failureReasonForCommand = (
  failure: GitCommandBoundedFailure,
  unavailable: RemotePublicationObservationFailureReason
): RemotePublicationObservationFailureReason => {
  if (failure instanceof GitCommandResponseDeadline) return "ResponseDeadline"
  if (failure instanceof GitCommandSenderStopUnproven || failure instanceof GitCommandInterrupted) {
    return "SenderStopUnproven"
  }
  return unavailable
}

const pushFailureReasonForCommand = (failure: GitCommandBoundedFailure): RemotePublicationPushFailureReason => {
  if (failure instanceof GitCommandResponseDeadline) return "ResponseDeadline"
  if (failure instanceof GitCommandSenderStopUnproven || failure instanceof GitCommandInterrupted) {
    return "SenderStopUnproven"
  }
  return "TransportUnavailable"
}

export const repositoryFromRequest = (
  request: RemotePublicationGitRequest,
  configured: GitRepositoryLocator | undefined
): GitRepositoryLocator | undefined => {
  if (configured !== undefined) return configured
  if (!("repository" in request)) return undefined
  const candidate: unknown = request.repository
  return Option.getOrUndefined(Schema.decodeUnknownOption(GitRepositoryLocator)(candidate))
}

const parseRewriteRules = (stdout: string): ReadonlyArray<RewriteRule> | undefined => {
  if (stdout.length === 0) return []
  const rules: Array<RewriteRule> = []
  for (const entry of stdout.split("\u0000")) {
    if (entry.length === 0) continue
    const separator = entry.indexOf("\n")
    if (separator < 1) return undefined
    const key = entry.slice(0, separator)
    const value = entry.slice(separator + 1)
    const lowerKey = key.toLowerCase()
    const suffix = lowerKey.endsWith(".pushinsteadof") ? ".pushinsteadof" : ".insteadof"
    if (!lowerKey.startsWith("url.") || !lowerKey.endsWith(suffix)) return undefined
    const replacement = key.slice(urlConfigKeyPrefixLength, key.length - suffix.length)
    if (replacement.length === 0 || value.length === 0) return undefined
    rules.push({ kind: suffix === ".pushinsteadof" ? "push" : "read", prefix: value, replacement })
  }
  return rules
}

const rewrite = (endpoint: string, rules: ReadonlyArray<RewriteRule>, kind: RewriteKind): string | undefined => {
  const candidates = rules.filter((rule) => rule.kind === kind && endpoint.startsWith(rule.prefix))
  if (candidates.length === 0) return endpoint
  const longest = Math.max(...candidates.map((rule) => rule.prefix.length))
  const matches = candidates.filter((rule) => rule.prefix.length === longest)
  if (matches.length !== 1) return undefined
  const match = matches[0]
  if (match === undefined) return undefined
  return `${match.replacement}${endpoint.slice(match.prefix.length)}`
}

const endpointFromRewrite = (value: string): RemotePublicationEndpoint | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(RemotePublicationEndpoint)(value))

const pinnedCommandPrefix = (endpoint: RemotePublicationEndpoint): ReadonlyArray<string> | undefined => {
  // Git's -c key grammar treats an unescaped '=' as the key/value separator;
  // an endpoint containing it cannot receive a command-local self mapping.
  // Reject it rather than allow a global rewrite to change the destination.
  if (endpoint.includes("=")) return undefined
  return ["-c", `url.${endpoint}.insteadOf=${endpoint}`, "-c", `url.${endpoint}.pushInsteadOf=${endpoint}`]
}

const parseConfigRules = (
  commands: GitCommandService,
  repository: GitRepositoryLocator,
  timeout: Duration.Input
): Effect.Effect<ReadonlyArray<RewriteRule>, EndpointResolutionFailure> => {
  const bounded = commands.runBoundedInRepository
  if (bounded === undefined) return Effect.fail(new GitCommandSenderStopUnproven())
  return bounded(repository, ["config", "--null", "--get-regexp", gitConfigRewritePattern], timeout).pipe(
    Effect.flatMap((result) => {
      if (result.exitCode === 1) return Effect.succeed<ReadonlyArray<RewriteRule>>([])
      if (result.exitCode !== 0) return Effect.fail(new EndpointMappingUnstable())
      const rules = parseRewriteRules(result.stdout)
      return rules === undefined ? Effect.fail(new EndpointMappingUnstable()) : Effect.succeed(rules)
    })
  )
}

export const resolvePinnedEndpoint = (
  commands: GitCommandService,
  repository: GitRepositoryLocator,
  target: RemotePublicationTarget,
  deadline: RemoteOperationDeadline
): Effect.Effect<ReadonlyArray<string>, EndpointResolutionFailure> =>
  Effect.gen(function* () {
    const timeout = yield* remainingOperationTimeout(deadline)
    const rules = yield* parseConfigRules(commands, repository, timeout)
    const readEndpoint = rewrite(target.endpoint, rules, "read")
    const pushEndpoint = rules.some((rule) => rule.kind === "push")
      ? rewrite(target.endpoint, rules, "push")
      : rewrite(target.endpoint, rules, "read")
    if (readEndpoint === undefined || pushEndpoint === undefined || readEndpoint !== pushEndpoint) {
      return yield* new EndpointMappingUnstable()
    }
    const resolved = endpointFromRewrite(readEndpoint)
    if (resolved === undefined || resolved !== target.endpoint) return yield* new EndpointMappingUnstable()
    const prefix = pinnedCommandPrefix(resolved)
    if (prefix === undefined) return yield* new EndpointMappingUnstable()
    return prefix
  })

export const runBounded = (
  commands: GitCommandService,
  repository: GitRepositoryLocator,
  args: ReadonlyArray<string>,
  deadline: RemoteOperationDeadline,
  subject?: GitCommandCustodySubject
): Effect.Effect<GitCommandResult, GitCommandBoundedFailure> =>
  remainingOperationTimeout(deadline).pipe(
    Effect.flatMap((timeout) => {
      const bounded = commands.runBoundedInRepository
      return bounded === undefined
        ? Effect.fail(new GitCommandSenderStopUnproven())
        : bounded(repository, args, timeout, subject)
    })
  )

export const observationFailure = (
  target: RemotePublicationTarget,
  failure: EndpointResolutionFailure,
  fallback: RemotePublicationObservationFailureReason
): RemotePublicationObservationFailure =>
  new RemotePublicationObservationFailure({
    reason:
      failure instanceof EndpointMappingUnstable
        ? "EndpointMappingChanged"
        : failureReasonForCommand(failure, fallback),
    target
  })

export const pushFailure = (
  target: RemotePublicationTarget,
  failure: EndpointResolutionFailure
): RemotePublicationPushFailure =>
  new RemotePublicationPushFailure({
    reason:
      failure instanceof EndpointMappingUnstable ? "EndpointMappingChanged" : pushFailureReasonForCommand(failure),
    target
  })
